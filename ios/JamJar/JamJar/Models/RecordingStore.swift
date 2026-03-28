import Foundation
import Observation

@Observable
class RecordingStore {
    let directory: URL
    private(set) var recordings: [Recording] = []
    private let storePath: URL
    private var pendingSave: DispatchWorkItem?
    private var cachedDiskUsage: Int64?

    init(directory: URL) {
        self.directory = directory
        self.storePath = directory.appendingPathComponent("recordings.json")
        self.recordings = Self.load(from: storePath)
    }

    var pendingUploads: [Recording] {
        recordings.filter { $0.uploadState == .pending || $0.uploadState == .failed }
    }

    var diskUsageBytes: Int64 {
        if let cached = cachedDiskUsage { return cached }
        let result = recordings.reduce(into: Int64(0)) { total, rec in
            let fileURL = directory.appendingPathComponent(rec.filename)
            let size = (try? FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? Int64) ?? 0
            total += size
        }
        cachedDiskUsage = result
        return result
    }

    func add(_ recording: Recording) {
        recordings.append(recording)
        invalidateDiskCache()
        saveNow()
    }

    func delete(id: UUID) {
        recordings.removeAll { $0.id == id }
        invalidateDiskCache()
        saveNow()
    }

    func updateName(id: UUID, name: String) {
        guard let index = recordings.firstIndex(where: { $0.id == id }) else { return }
        recordings[index].name = name
        saveSoon()
    }

    func updateUploadState(id: UUID, state: UploadState) {
        guard let index = recordings.firstIndex(where: { $0.id == id }) else { return }
        recordings[index].uploadState = state
        saveSoon()
    }

    func updateJobInfo(id: UUID, jobId: String, sessionId: Int) {
        guard let index = recordings.firstIndex(where: { $0.id == id }) else { return }
        recordings[index].jobId = jobId
        recordings[index].sessionId = sessionId
        saveSoon()
    }

    func updateJobStatus(id: UUID, status: String) {
        guard let index = recordings.firstIndex(where: { $0.id == id }) else { return }
        recordings[index].jobStatus = status
        saveSoon()
    }

    func incrementRetry(id: UUID) {
        guard let index = recordings.firstIndex(where: { $0.id == id }) else { return }
        recordings[index].retryCount += 1
        saveSoon()
    }

    func updateUploadProgress(id: UUID, progress: Double) {
        guard let index = recordings.firstIndex(where: { $0.id == id }) else { return }
        recordings[index].uploadProgress = progress
        // Don't save — progress is transient and updates frequently
    }

    func deleteWithFile(id: UUID) {
        guard let recording = recordings.first(where: { $0.id == id }) else { return }
        let fileURL = directory.appendingPathComponent(recording.filename)
        try? FileManager.default.removeItem(at: fileURL)
        recordings.removeAll { $0.id == id }
        invalidateDiskCache()
        saveNow()
    }

    func resetForRetry(id: UUID) {
        guard let index = recordings.firstIndex(where: { $0.id == id }) else { return }
        recordings[index].uploadState = .pending
        recordings[index].retryCount = 0
        recordings[index].jobId = nil
        recordings[index].sessionId = nil
        recordings[index].jobStatus = nil
        saveSoon()
    }

    /// Reset all failed recordings that have a valid group for retry.
    func resetFailedForRetry(validGroupIds: Set<Int>) {
        var changed = false
        for index in recordings.indices where recordings[index].uploadState == .failed {
            guard validGroupIds.contains(recordings[index].groupId) else { continue }
            recordings[index].uploadState = .pending
            recordings[index].retryCount = 0
            recordings[index].jobId = nil
            recordings[index].sessionId = nil
            recordings[index].jobStatus = nil
            changed = true
        }
        if changed { saveSoon() }
    }

    /// Remove orphaned audio files not referenced by any recording.
    func cleanOrphanedFiles() {
        let knownFilenames = Set(recordings.map(\.filename))
        guard let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return }
        for file in files {
            let name = file.lastPathComponent
            if name.hasSuffix(".m4a") && !knownFilenames.contains(name) {
                try? FileManager.default.removeItem(at: file)
            }
        }
        invalidateDiskCache()
    }

    // MARK: Persistence

    /// Immediate save for critical mutations (add, delete).
    private func saveNow() {
        pendingSave?.cancel()
        pendingSave = nil
        performSave()
    }

    /// Debounced save for rapid sequential mutations.
    private func saveSoon() {
        pendingSave?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.performSave()
        }
        pendingSave = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: work)
    }

    private func performSave() {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(recordings) else { return }
        try? data.write(to: storePath, options: .atomic)
    }

    private func invalidateDiskCache() {
        cachedDiskUsage = nil
    }

    private static func load(from url: URL) -> [Recording] {
        guard let data = try? Data(contentsOf: url) else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return (try? decoder.decode([Recording].self, from: data)) ?? []
    }
}
