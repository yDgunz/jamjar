import Foundation

enum UploadState: String, Codable {
    case pending
    case uploading
    case completed
    case failed
}

struct Recording: Codable, Identifiable {
    let id: UUID
    let filename: String
    let groupId: Int
    let groupName: String
    let createdAt: Date
    let durationSec: Double
    var name: String
    var uploadState: UploadState
    var jobId: String?
    var sessionId: Int?
    var jobStatus: String?
    var retryCount: Int = 0
    var uploadProgress: Double? = nil

    /// The name sent to the server as the upload filename (determines session name).
    var uploadFilename: String {
        let ext = (filename as NSString).pathExtension
        return "\(name).\(ext)"
    }
}
