import Foundation
import Observation

@Observable
class RecordingStore {
    let directory: URL
    private(set) var recordings: [Recording] = []
    private let storePath: URL

    init(directory: URL) {
        self.directory = directory
        self.storePath = directory.appendingPathComponent("recordings.json")
        self.recordings = Self.load(from: storePath)
    }

    var pendingUploads: [Recording] {
        recordings.filter { $0.uploadState == .pending || $0.uploadState == .failed }
    }

    var diskUsageBytes: Int64 {
        recordings.reduce(0) { total, rec in
            let fileURL = directory.appendingPathComponent(rec.filename)
            let size = (try? FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? Int64) ?? 0
            return total + size
        }
    }

    func add(_ recording: Recording) {
        recordings.append(recording)
        save()
    }

    func delete(id: UUID) {
        recordings.removeAll { $0.id == id }
        save()
    }

    func updateName(id: UUID, name: String) {
        guard let index = recordings.firstIndex(where: { $0.id == id }) else { return }
        recordings[index].name = name
        save()
    }

    func updateUploadState(id: UUID, state: UploadState) {
        guard let index = recordings.firstIndex(where: { $0.id == id }) else { return }
        recordings[index].uploadState = state
        save()
    }

    func updateJobInfo(id: UUID, jobId: String, sessionId: Int) {
        guard let index = recordings.firstIndex(where: { $0.id == id }) else { return }
        recordings[index].jobId = jobId
        recordings[index].sessionId = sessionId
        save()
    }

    func updateJobStatus(id: UUID, status: String) {
        guard let index = recordings.firstIndex(where: { $0.id == id }) else { return }
        recordings[index].jobStatus = status
        save()
    }

    func incrementRetry(id: UUID) {
        guard let index = recordings.firstIndex(where: { $0.id == id }) else { return }
        recordings[index].retryCount += 1
        save()
    }

    func updateUploadProgress(id: UUID, progress: Double) {
        guard let index = recordings.firstIndex(where: { $0.id == id }) else { return }
        recordings[index].uploadProgress = progress
        // Don't save() here — progress is transient and updates frequently
    }

    func deleteWithFile(id: UUID) {
        guard let recording = recordings.first(where: { $0.id == id }) else { return }
        let fileURL = directory.appendingPathComponent(recording.filename)
        try? FileManager.default.removeItem(at: fileURL)
        recordings.removeAll { $0.id == id }
        save()
    }

    func resetForRetry(id: UUID) {
        guard let index = recordings.firstIndex(where: { $0.id == id }) else { return }
        recordings[index].uploadState = .pending
        recordings[index].retryCount = 0
        recordings[index].jobId = nil
        recordings[index].sessionId = nil
        recordings[index].jobStatus = nil
        save()
    }

    // MARK: Persistence

    private func save() {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(recordings) else { return }
        try? data.write(to: storePath, options: .atomic)
    }

    private static func load(from url: URL) -> [Recording] {
        guard let data = try? Data(contentsOf: url) else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return (try? decoder.decode([Recording].self, from: data)) ?? []
    }
}
