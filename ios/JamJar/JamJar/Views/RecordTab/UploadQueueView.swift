import SwiftUI

struct UploadQueueView: View {
    let recordings: [Recording]

    var body: some View {
        if recordings.isEmpty {
            ContentUnavailableView("No Recordings", systemImage: "waveform", description: Text("Tap the record button to start"))
        } else {
            List(recordings) { recording in
                HStack {
                    VStack(alignment: .leading) {
                        Text(recording.filename)
                            .font(.subheadline.monospaced())
                        Text(recording.groupName)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(formatDuration(recording.durationSec))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    uploadStatusView(recording)
                }
            }
            .listStyle(.plain)
        }
    }

    @ViewBuilder
    private func uploadStatusView(_ recording: Recording) -> some View {
        switch recording.uploadState {
        case .pending:
            Label("Pending", systemImage: "clock")
                .font(.caption)
                .foregroundStyle(.secondary)
        case .uploading:
            ProgressView()
        case .completed:
            if recording.jobStatus == "completed" {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
            } else if recording.jobStatus == "failed" {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
            } else {
                Label("Processing", systemImage: "gear")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        case .failed:
            Label("Failed", systemImage: "exclamationmark.triangle")
                .font(.caption)
                .foregroundStyle(.red)
        }
    }

    private func formatDuration(_ seconds: Double) -> String {
        let mins = Int(seconds) / 60
        let secs = Int(seconds) % 60
        return String(format: "%d:%02d", mins, secs)
    }
}
