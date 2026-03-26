import SwiftUI
import UserNotifications

@main
struct JamJarApp: App {
    static let keychainService = "com.jamjar.app"

    @State private var serverURL: String = UserDefaults.standard.string(forKey: "serverURL") ?? ""
    @State private var wifiOnly: Bool = UserDefaults.standard.object(forKey: "wifiOnly") as? Bool ?? true
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
                        Task {
                            let shouldUpload = wifiOnly ? networkMonitor.isConnectedViaWiFi : true
                            if shouldUpload, jwt != nil {
                                let manager = getOrCreateUploadManager()
                                await manager.processQueue()
                            }
                        }
                    }
                )
                .tabItem {
                    Label("Record", systemImage: "record.circle")
                }
                BrowseView(serverURL: serverURL, jwt: jwt)
                    .tabItem {
                        Label("Browse", systemImage: "globe")
                    }
                SettingsView(
                    apiClient: makeAPIClient(),
                    keychain: keychain,
                    keychainService: Self.keychainService,
                    serverURL: $serverURL,
                    user: $user,
                    jwt: $jwt,
                    wifiOnly: $wifiOnly,
                    store: store
                )
                .tabItem {
                    Label("Settings", systemImage: "gearshape")
                }
            }
            .onChange(of: serverURL) { _, newValue in
                UserDefaults.standard.set(newValue, forKey: "serverURL")
            }
            .onChange(of: wifiOnly) { _, newValue in
                UserDefaults.standard.set(newValue, forKey: "wifiOnly")
            }
            .onChange(of: user) { _, newUser in
                if let groups = newUser?.groups, groups.count == 1 {
                    selectedGroupId = groups[0].id
                }
            }
            .task {
                await restoreSession()
            }
            .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)) { _ in
                Task { await onForeground() }
            }
        }
    }

    private func makeAPIClient() -> APIClient {
        let url = URL(string: serverURL) ?? URL(string: "http://localhost")!
        return APIClient(baseURL: url)
    }

    private func restoreSession() async {
        guard let savedJWT = try? keychain.read(service: Self.keychainService, account: "jwt"),
              !serverURL.isEmpty else { return }
        let client = makeAPIClient()
        if let me = try? await client.getMe(jwt: savedJWT) {
            jwt = savedJWT
            user = me
        } else {
            try? keychain.delete(service: Self.keychainService, account: "jwt")
        }
    }

    private func onForeground() async {
        let shouldUpload = wifiOnly ? networkMonitor.isConnectedViaWiFi : true
        if shouldUpload, jwt != nil {
            let manager = getOrCreateUploadManager()
            await manager.processQueue()
        }
        if let manager = uploadManager {
            await manager.pollJobStatuses()
        }
    }

    private func getOrCreateUploadManager() -> UploadManager {
        if let existing = uploadManager { return existing }
        let manager = UploadManager(
            apiClient: makeAPIClient(),
            store: store,
            keychain: keychain,
            keychainService: Self.keychainService
        )
        uploadManager = manager
        return manager
    }
}
