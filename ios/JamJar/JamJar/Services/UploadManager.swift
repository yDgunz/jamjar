import Foundation
import UserNotifications
import Observation

@Observable
class UploadManager: NSObject {
    private let apiClient: APIClient
    private let store: RecordingStore
    private let keychain: KeychainHelper
    private let keychainService: String

    @ObservationIgnored
    private var _backgroundSession: URLSession?
    private var backgroundSession: URLSession {
        if let session = _backgroundSession { return session }
        let config = URLSessionConfiguration.background(withIdentifier: "com.jamjar.upload")
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        _backgroundSession = session
        return session
    }

    private var activeUploads: [Int: UUID] = [:]
    private var pendingCompletions: [UUID: (jobId: String, sessionId: Int)] = [:]
    private(set) var isProcessing = false

    static let maxRetries = 3

    init(apiClient: APIClient, store: RecordingStore, keychain: KeychainHelper, keychainService: String) {
        self.apiClient = apiClient
        self.store = store
        self.keychain = keychain
        self.keychainService = keychainService
        super.init()
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
        isProcessing = true
        defer { isProcessing = false }

        guard let jwt = try? keychain.read(service: keychainService, account: "jwt") else { return }

        for recording in store.pendingUploads {
            guard Self.shouldRetry(recording) else { continue }

            store.updateUploadState(id: recording.id, state: .uploading)

            do {
                let initResponse = try await apiClient.uploadInit(
                    filename: recording.filename, groupId: recording.groupId, jwt: jwt
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

    func pollJobStatuses() async {
        guard let jwt = try? keychain.read(service: keychainService, account: "jwt") else { return }

        for recording in store.recordings where recording.jobId != nil && recording.uploadState == .completed {
            guard let jobId = recording.jobId, recording.jobStatus != "completed" && recording.jobStatus != "failed" else {
                continue
            }
            if let job = try? await apiClient.getJobStatus(jobId: jobId, jwt: jwt) {
                store.updateJobStatus(id: recording.id, status: job.status)
            }
        }
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
