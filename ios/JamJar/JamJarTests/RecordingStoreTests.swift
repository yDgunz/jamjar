import Testing
import Foundation
@testable import JamJar

struct RecordingStoreTests {
    func makeStore() -> RecordingStore {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
        try! FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return RecordingStore(directory: dir)
    }

    @Test func emptyStoreHasNoRecordings() {
        let store = makeStore()
        #expect(store.recordings.isEmpty)
    }

    @Test func addRecordingPersists() {
        let store = makeStore()
        let rec = Recording(
            id: UUID(),
            filename: "2026-03-25_140000.m4a",
            groupId: 1,
            groupName: "Test Band",
            createdAt: Date(),
            durationSec: 3600.0,
            uploadState: .pending
        )
        store.add(rec)
        #expect(store.recordings.count == 1)
        #expect(store.recordings[0].filename == "2026-03-25_140000.m4a")

        let store2 = RecordingStore(directory: store.directory)
        #expect(store2.recordings.count == 1)
        #expect(store2.recordings[0].id == rec.id)
    }

    @Test func updateRecordingState() {
        let store = makeStore()
        let id = UUID()
        let rec = Recording(
            id: id, filename: "test.m4a", groupId: 1, groupName: "Band",
            createdAt: Date(), durationSec: 60.0, uploadState: .pending
        )
        store.add(rec)
        store.updateUploadState(id: id, state: .uploading)
        #expect(store.recordings[0].uploadState == .uploading)
    }

    @Test func updateJobInfo() {
        let store = makeStore()
        let id = UUID()
        let rec = Recording(
            id: id, filename: "test.m4a", groupId: 1, groupName: "Band",
            createdAt: Date(), durationSec: 60.0, uploadState: .uploading
        )
        store.add(rec)
        store.updateJobInfo(id: id, jobId: "j123", sessionId: 10)
        #expect(store.recordings[0].jobId == "j123")
        #expect(store.recordings[0].sessionId == 10)
    }

    @Test func pendingUploads() {
        let store = makeStore()
        let pending = Recording(
            id: UUID(), filename: "a.m4a", groupId: 1, groupName: "Band",
            createdAt: Date(), durationSec: 60.0, uploadState: .pending
        )
        let completed = Recording(
            id: UUID(), filename: "b.m4a", groupId: 1, groupName: "Band",
            createdAt: Date(), durationSec: 60.0, uploadState: .completed
        )
        store.add(pending)
        store.add(completed)
        #expect(store.pendingUploads.count == 1)
        #expect(store.pendingUploads[0].filename == "a.m4a")
    }

    @Test func deleteRecording() {
        let store = makeStore()
        let id = UUID()
        let rec = Recording(
            id: id, filename: "test.m4a", groupId: 1, groupName: "Band",
            createdAt: Date(), durationSec: 60.0, uploadState: .completed
        )
        store.add(rec)
        store.delete(id: id)
        #expect(store.recordings.isEmpty)
    }

    @Test func totalDiskUsage() {
        let store = makeStore()
        let fileURL = store.directory.appendingPathComponent("test.m4a")
        try! Data(repeating: 0, count: 1024).write(to: fileURL)
        let rec = Recording(
            id: UUID(), filename: "test.m4a", groupId: 1, groupName: "Band",
            createdAt: Date(), durationSec: 60.0, uploadState: .completed
        )
        store.add(rec)
        #expect(store.diskUsageBytes >= 1024)
    }
}
