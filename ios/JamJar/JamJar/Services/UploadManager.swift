import Foundation
import UserNotifications
import Observation

@Observable
class UploadManager: NSObject {
    private let apiClient: APIClient
    private let store: RecordingStore
    private let keychain: KeychainHelper
    private let keychainService: String
    private let networkMonitor: NetworkMonitor

    @ObservationIgnored
    private var _backgroundSession: URLSession?
    @ObservationIgnored
    private var _wifiOnly: Bool
    @ObservationIgnored
    private var _autoClean: Bool
    private var backgroundSession: URLSession {
        if let session = _backgroundSession { return session }
        let config = URLSessionConfiguration.background(withIdentifier: "com.jamjar.upload")
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        config.allowsCellularAccess = !_wifiOnly
        config.allowsExpensiveNetworkAccess = !_wifiOnly
        config.allowsConstrainedNetworkAccess = !_wifiOnly
        let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        _backgroundSession = session
        return session
    }

    private var activeUploads: [Int: UUID] = [:]
    private var pendingCompletions: [UUID: (jobId: String, sessionId: Int)] = [:]
    private(set) var isProcessing = false

    static let maxRetries = 3

    init(apiClient: APIClient, store: RecordingStore, keychain: KeychainHelper, keychainService: String, networkMonitor: NetworkMonitor, wifiOnly: Bool, autoClean: Bool) {
        self.apiClient = apiClient
        self.store = store
        self.keychain = keychain
        self.keychainService = keychainService
        self.networkMonitor = networkMonitor
        self._wifiOnly = wifiOnly
        self._autoClean = autoClean
        super.init()
    }

    func updateWifiOnly(_ wifiOnly: Bool) {
        guard wifiOnly != _wifiOnly else { return }
        _wifiOnly = wifiOnly
        _backgroundSession?.invalidateAndCancel()
        _backgroundSession = nil
    }

    func updateAutoClean(_ autoClean: Bool) {
        _autoClean = autoClean
    }

    // MARK: Public

    static func shouldRetry(_ recording: Recording) -> Bool {
        (recording.uploadState == .pending || recording.uploadState == .failed)
            && recording.retryCount < maxRetries
    }

    static func retryDelay(attempt: Int) -> TimeInterval {
        pow(2.0, Double(attempt + 1))
    }

    func processQueue() async {
        guard !isProcessing else { return }

        // Enforce WiFi-only at the queue level, not just at the call site
        if _wifiOnly && !networkMonitor.isConnectedViaWiFi { return }

        isProcessing = true
        defer { isProcessing = false }

        guard let jwt = try? keychain.read(service: keychainService, account: "jwt") else { return }

        for recording in store.pendingUploads {
            guard Self.shouldRetry(recording) else { continue }

            // Re-check WiFi before each upload in case connectivity changed mid-loop
            if _wifiOnly && !networkMonitor.isConnectedViaWiFi { break }

            store.updateUploadState(id: recording.id, state: .uploading)

            do {
                let initResponse = try await apiClient.uploadInit(
                    filename: recording.uploadFilename, groupId: recording.groupId, jwt: jwt
                )
                store.updateJobInfo(
                    id: recording.id,
                    jobId: initResponse.job.id,
                    sessionId: initResponse.session_id
                )
                pendingCompletions[recording.id] = (
                    jobId: initResponse.job.id, sessionId: initResponse.session_id
                )

                if let uploadURLString = initResponse.upload_url,
                   let uploadURL = URL(string: uploadURLString) {
                    let fileURL = store.directory.appendingPathComponent(recording.filename)
                    let request = apiClient.buildPresignedPutRequest(url: uploadURL, fileURL: fileURL)
                    let task = backgroundSession.uploadTask(with: request, fromFile: fileURL)
                    activeUploads[task.taskIdentifier] = recording.id
                    task.resume()
                }
            } catch {
                store.updateUploadState(id: recording.id, state: .failed)
                store.incrementRetry(id: recording.id)
            }
        }
    }

    func retryRecording(id: UUID) async {
        store.resetForRetry(id: id)
        await processQueue()
    }

    // MARK: Notifications

    func sendLocalNotification(title: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }
}

// MARK: - URLSessionTaskDelegate

extension UploadManager: URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64, totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        guard let recordingId = activeUploads[task.taskIdentifier],
              totalBytesExpectedToSend > 0 else { return }
        let progress = Double(totalBytesSent) / Double(totalBytesExpectedToSend)
        DispatchQueue.main.async {
            self.store.updateUploadProgress(id: recordingId, progress: progress)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let recordingId = activeUploads.removeValue(forKey: task.taskIdentifier) else { return }

        if let error {
            DispatchQueue.main.async {
                self.store.updateUploadState(id: recordingId, state: .failed)
                self.store.incrementRetry(id: recordingId)
            }
            return
        }

        guard let completion = pendingCompletions.removeValue(forKey: recordingId) else { return }

        Task {
            do {
                guard let jwt = try keychain.read(service: keychainService, account: "jwt") else { return }
                _ = try await apiClient.uploadComplete(
                    jobId: completion.jobId, sessionId: completion.sessionId, jwt: jwt
                )
                await MainActor.run {
                    self.store.updateUploadState(id: recordingId, state: .completed)
                    if self._autoClean {
                        self.store.deleteWithFile(id: recordingId)
                    }
                    self.sendLocalNotification(
                        title: "Recording Uploaded",
                        body: "Your jam session recording is being processed."
                    )
                }
            } catch {
                await MainActor.run {
                    self.store.updateUploadState(id: recordingId, state: .failed)
                    self.store.incrementRetry(id: recordingId)
                }
            }
        }
    }
}
