import Testing
import Foundation
@testable import JamJar

struct UploadManagerTests {
    @Test func maxRetriesExceeded() {
        let rec = Recording(
            id: UUID(), filename: "test.m4a", groupId: 1, groupName: "Band",
            createdAt: Date(), durationSec: 60.0, uploadState: .failed, retryCount: 3
        )
        #expect(UploadManager.shouldRetry(rec) == false)
    }

    @Test func shouldRetryPending() {
        let rec = Recording(
            id: UUID(), filename: "test.m4a", groupId: 1, groupName: "Band",
            createdAt: Date(), durationSec: 60.0, uploadState: .pending, retryCount: 0
        )
        #expect(UploadManager.shouldRetry(rec) == true)
    }

    @Test func shouldRetryFailed() {
        let rec = Recording(
            id: UUID(), filename: "test.m4a", groupId: 1, groupName: "Band",
            createdAt: Date(), durationSec: 60.0, uploadState: .failed, retryCount: 2
        )
        #expect(UploadManager.shouldRetry(rec) == true)
    }

    @Test func retryDelayExponential() {
        #expect(UploadManager.retryDelay(attempt: 0) == 2.0)
        #expect(UploadManager.retryDelay(attempt: 1) == 4.0)
        #expect(UploadManager.retryDelay(attempt: 2) == 8.0)
    }
}
