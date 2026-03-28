import SwiftUI

@main
struct JamJarApp: App {
    static let keychainService = "com.jamjar.app"
    private let apiClient = APIClient()

    @State private var wifiOnly: Bool = UserDefaults.standard.object(forKey: "wifiOnly") as? Bool ?? true
    @State private var autoClean: Bool = UserDefaults.standard.object(forKey: "autoClean") as? Bool ?? false
    @State private var user: UserResponse?
    @State private var jwt: String?
    @State private var selectedGroupId: Int?

    private let keychain = KeychainHelper()
    @State private var recorder = AudioRecorder()
    @State private var store: RecordingStore
    @State private var networkMonitor = NetworkMonitor()
    @State private var uploadManager: UploadManager?

    init() {
        let documentsDir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let recordingsDir = documentsDir.appendingPathComponent("recordings")
        try? FileManager.default.createDirectory(at: recordingsDir, withIntermediateDirectories: true)
        _store = State(initialValue: RecordingStore(directory: recordingsDir))
    }

    var body: some Scene {
        WindowGroup {
            TabView {
                RecordView(
                    recorder: recorder,
                    store: store,
                    user: user,
                    selectedGroupId: $selectedGroupId,
                    onRecordingStopped: {
                        Task { @MainActor in
                            let shouldUpload = wifiOnly ? networkMonitor.isConnectedViaWiFi : true
                            if shouldUpload, jwt != nil {
                                let manager = getOrCreateUploadManager()
                                await manager.processQueue()
                            }
                        }
                    },
                    onRetryUpload: { recordingId in
                        Task { @MainActor in
                            let manager = getOrCreateUploadManager()
                            await manager.retryRecording(id: recordingId)
                        }
                    },
                    onDeleteRecording: { recordingId in
                        store.deleteWithFile(id: recordingId)
                    },
                    onRenameRecording: { recordingId, newName in
                        store.updateName(id: recordingId, name: newName)
                    },
                    uploadsPaused: wifiOnly && !networkMonitor.isConnectedViaWiFi && store.pendingUploads.count > 0
                )
                .tabItem {
                    Label("Record", systemImage: "record.circle")
                }
                BrowseView(serverURL: APIClient.defaultBaseURL.absoluteString, jwt: jwt)
                    .tabItem {
                        Label("Browse", systemImage: "globe")
                    }
                SettingsView(
                    apiClient: apiClient,
                    keychain: keychain,
                    keychainService: Self.keychainService,
                    user: $user,
                    jwt: $jwt,
                    wifiOnly: $wifiOnly,
                    autoClean: $autoClean,
                    store: store
                )
                .tabItem {
                    Label("Settings", systemImage: "gearshape")
                }
            }
            .onChange(of: wifiOnly) { _, newValue in
                UserDefaults.standard.set(newValue, forKey: "wifiOnly")
                uploadManager?.updateWifiOnly(newValue)
            }
            .onChange(of: autoClean) { _, newValue in
                UserDefaults.standard.set(newValue, forKey: "autoClean")
                uploadManager?.updateAutoClean(newValue)
            }
            .onChange(of: user) { oldUser, newUser in
                if let groups = newUser?.groups, let first = groups.first {
                    selectedGroupId = first.id
                }
                // On login: sweep failed recordings for retry and clean orphaned files
                if oldUser == nil, let newUser {
                    let validGroupIds = Set(newUser.groups.map(\.id))
                    store.resetFailedForRetry(validGroupIds: validGroupIds)
                    store.cleanOrphanedFiles()
                    Task { @MainActor in
                        let shouldUpload = wifiOnly ? networkMonitor.isConnectedViaWiFi : true
                        if shouldUpload, jwt != nil {
                            let manager = getOrCreateUploadManager()
                            await manager.processQueue()
                        }
                    }
                }
            }
            .task {
                await restoreSession()
                // Clean orphaned files on launch
                store.cleanOrphanedFiles()
                recorder.onInterruptionStopped = { result in
                    saveInterruptedRecording(result: result)
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)) { _ in
                Task { @MainActor in await onForeground() }
            }
        }
    }

    private func saveInterruptedRecording(result: (url: URL, duration: TimeInterval)) {
        let groupId = selectedGroupId ?? user?.groups.first?.id ?? 0
        let groupName = user?.groups.first(where: { $0.id == groupId })?.name ?? "Unknown"
        let fileBaseName = (result.url.lastPathComponent as NSString).deletingPathExtension
        let recording = Recording(
            id: UUID(),
            filename: result.url.lastPathComponent,
            groupId: groupId,
            groupName: groupName,
            createdAt: Date(),
            durationSec: result.duration,
            name: fileBaseName,
            uploadState: user != nil ? .pending : .failed
        )
        store.add(recording)
        if user != nil {
            Task { @MainActor in
                let shouldUpload = wifiOnly ? networkMonitor.isConnectedViaWiFi : true
                if shouldUpload {
                    let manager = getOrCreateUploadManager()
                    await manager.processQueue()
                }
            }
        }
    }

    private func restoreSession() async {
        guard let savedJWT = try? keychain.read(service: Self.keychainService, account: "jwt") else { return }
        if let me = try? await apiClient.getMe(jwt: savedJWT) {
            jwt = savedJWT
            user = me
        } else {
            // JWT is invalid or expired — clear it
            try? keychain.delete(service: Self.keychainService, account: "jwt")
        }
    }

    @MainActor
    private func onForeground() async {
        // Re-validate JWT on foreground
        if let currentJWT = jwt {
            if (try? await apiClient.getMe(jwt: currentJWT)) == nil {
                // JWT expired — clear session
                try? keychain.delete(service: Self.keychainService, account: "jwt")
                jwt = nil
                user = nil
                return
            }
        }

        let shouldUpload = wifiOnly ? networkMonitor.isConnectedViaWiFi : true
        if shouldUpload, jwt != nil {
            let manager = getOrCreateUploadManager()
            await manager.processQueue()
        }
    }

    @MainActor
    private func getOrCreateUploadManager() -> UploadManager {
        if let existing = uploadManager { return existing }
        let manager = UploadManager(
            apiClient: apiClient,
            store: store,
            keychain: keychain,
            keychainService: Self.keychainService,
            networkMonitor: networkMonitor,
            wifiOnly: wifiOnly,
            autoClean: autoClean
        )
        uploadManager = manager
        return manager
    }
}
