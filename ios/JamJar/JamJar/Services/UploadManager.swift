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

    // Thread-safe access to shared dictionaries
    private let lock = NSLock()
    private var _activeUploads: [Int: UUID] = [:]
    private var _pendingCompletions: [UUID: (jobId: String, sessionId: Int)] = [:]

    private(set) var isProcessing = false

    static let maxRetries = 3
    static let maxConcurrentUploads = 3

    private var mappingURL: URL {
        store.directory.appendingPathComponent("upload_mappings.json")
    }

    init(apiClient: APIClient, store: RecordingStore, keychain: KeychainHelper, keychainService: String, networkMonitor: NetworkMonitor, wifiOnly: Bool, autoClean: Bool) {
        self.apiClient = apiClient
        self.store = store
        self.keychain = keychain
        self.keychainService = keychainService
        self.networkMonitor = networkMonitor
        self._wifiOnly = wifiOnly
        self._autoClean = autoClean
        super.init()

        restoreMappings()
        requestNotificationPermission()
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

        // Enforce WiFi-only at the queue level
        if _wifiOnly && !networkMonitor.isConnectedViaWiFi { return }

        isProcessing = true
        defer { isProcessing = false }

        guard let jwt = try? keychain.read(service: keychainService, account: "jwt") else { return }

        let pending = store.pendingUploads.filter { Self.shouldRetry($0) }

        // Process uploads in batches for concurrency
        let batchSize = Self.maxConcurrentUploads
        for batchStart in stride(from: 0, to: pending.count, by: batchSize) {
            // Re-check WiFi before each batch
            if _wifiOnly && !networkMonitor.isConnectedViaWiFi { break }

            let batchEnd = min(batchStart + batchSize, pending.count)
            let batch = Array(pending[batchStart..<batchEnd])

            await withTaskGroup(of: Void.self) { group in
                for recording in batch {
                    group.addTask {
                        await self.initiateUpload(recording, jwt: jwt)
                    }
                }
            }
        }
    }

    func retryRecording(id: UUID) async {
        store.resetForRetry(id: id)
        await processQueue()
    }

    // MARK: Upload Flow

    private func initiateUpload(_ recording: Recording, jwt: String) async {
        // Re-check WiFi
        if _wifiOnly && !networkMonitor.isConnectedViaWiFi { return }

        await MainActor.run {
            store.updateUploadState(id: recording.id, state: .uploading)
        }

        do {
            let initResponse = try await apiClient.uploadInit(
                filename: recording.uploadFilename, groupId: recording.groupId, jwt: jwt
            )

            await MainActor.run {
                store.updateJobInfo(
                    id: recording.id,
                    jobId: initResponse.job.id,
                    sessionId: initResponse.session_id
                )
            }

            guard let uploadURLString = initResponse.upload_url,
                  let uploadURL = URL(string: uploadURLString) else {
                // No presigned URL — server not configured for R2 or unexpected response
                await MainActor.run {
                    store.updateUploadState(id: recording.id, state: .failed)
                    store.incrementRetry(id: recording.id)
                }
                return
            }

            let fileURL = store.directory.appendingPathComponent(recording.filename)
            let request = apiClient.buildPresignedPutRequest(url: uploadURL, fileURL: fileURL)
            let task = backgroundSession.uploadTask(with: request, fromFile: fileURL)

            setActiveUpload(taskId: task.taskIdentifier, recordingId: recording.id)
            setPendingCompletion(
                recordingId: recording.id,
                jobId: initResponse.job.id,
                sessionId: initResponse.session_id
            )
            persistMappings()

            task.resume()
        } catch APIError.httpError(401) {
            // JWT expired — stop processing, user needs to re-login
            await MainActor.run {
                store.updateUploadState(id: recording.id, state: .failed)
            }
        } catch {
            await MainActor.run {
                store.updateUploadState(id: recording.id, state: .failed)
                store.incrementRetry(id: recording.id)
            }
        }
    }

    // MARK: Thread-Safe Dictionary Access

    private func setActiveUpload(taskId: Int, recordingId: UUID) {
        lock.lock()
        _activeUploads[taskId] = recordingId
        lock.unlock()
    }

    private func removeActiveUpload(taskId: Int) -> UUID? {
        lock.lock()
        defer { lock.unlock() }
        return _activeUploads.removeValue(forKey: taskId)
    }

    private func getActiveUpload(taskId: Int) -> UUID? {
        lock.lock()
        defer { lock.unlock() }
        return _activeUploads[taskId]
    }

    private func setPendingCompletion(recordingId: UUID, jobId: String, sessionId: Int) {
        lock.lock()
        _pendingCompletions[recordingId] = (jobId: jobId, sessionId: sessionId)
        lock.unlock()
    }

    private func removePendingCompletion(recordingId: UUID) -> (jobId: String, sessionId: Int)? {
        lock.lock()
        defer { lock.unlock() }
        return _pendingCompletions.removeValue(forKey: recordingId)
    }

    // MARK: Mapping Persistence

    private struct UploadMapping: Codable {
        let taskId: Int
        let recordingId: UUID
        let jobId: String
        let sessionId: Int
    }

    private func persistMappings() {
        lock.lock()
        let mappings = _activeUploads.compactMap { taskId, recordingId -> UploadMapping? in
            guard let completion = _pendingCompletions[recordingId] else { return nil }
            return UploadMapping(
                taskId: taskId,
                recordingId: recordingId,
                jobId: completion.jobId,
                sessionId: completion.sessionId
            )
        }
        lock.unlock()

        guard let data = try? JSONEncoder().encode(mappings) else { return }
        try? data.write(to: mappingURL, options: .atomic)
    }

    private func restoreMappings() {
        guard let data = try? Data(contentsOf: mappingURL) else { return }
        guard let mappings = try? JSONDecoder().decode([UploadMapping].self, from: data) else { return }

        lock.lock()
        for mapping in mappings {
            _activeUploads[mapping.taskId] = mapping.recordingId
            _pendingCompletions[mapping.recordingId] = (jobId: mapping.jobId, sessionId: mapping.sessionId)
        }
        lock.unlock()

        // Clean up the file — mappings have been restored
        try? FileManager.default.removeItem(at: mappingURL)
    }

    private func clearPersistedMappings() {
        try? FileManager.default.removeItem(at: mappingURL)
    }

    // MARK: Notifications

    private func requestNotificationPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

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
        guard let recordingId = getActiveUpload(taskId: task.taskIdentifier),
              totalBytesExpectedToSend > 0 else { return }
        let progress = Double(totalBytesSent) / Double(totalBytesExpectedToSend)
        DispatchQueue.main.async {
            self.store.updateUploadProgress(id: recordingId, progress: progress)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let recordingId = removeActiveUpload(taskId: task.taskIdentifier) else { return }

        if let error {
            DispatchQueue.main.async {
                self.store.updateUploadState(id: recordingId, state: .failed)
                self.store.incrementRetry(id: recordingId)
            }
            persistMappings()
            return
        }

        guard let completion = removePendingCompletion(recordingId: recordingId) else { return }
        persistMappings()

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

            // Clear persisted mappings if nothing is in flight
            lock.lock()
            let empty = _activeUploads.isEmpty && _pendingCompletions.isEmpty
            lock.unlock()
            if empty { clearPersistedMappings() }
        }
    }
}
