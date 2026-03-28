import SwiftUI
import AVFoundation

struct UploadQueueView: View {
    let recordings: [Recording]
    let recordingsDirectory: URL
    var onRetry: ((UUID) -> Void)?
    var onDelete: ((UUID) -> Void)?
    var onRename: ((UUID, String) -> Void)?
    var isRecording: Bool = false
    @State private var playingId: UUID?
    @State private var playerDelegate: PlayerDelegate?
    @State private var player: AVAudioPlayer?
    @State private var confirmDeleteId: UUID?
    @State private var editingRecording: Recording?
    @State private var editName: String = ""

    var body: some View {
        if recordings.isEmpty {
            ContentUnavailableView("No Recordings", systemImage: "waveform", description: Text("Tap the record button to start"))
        } else {
            List {
                ForEach(recordings) { recording in
                    HStack {
                        Button(action: { togglePlayback(recording) }) {
                            Image(systemName: playingId == recording.id ? "stop.circle.fill" : "play.circle.fill")
                                .font(.title2)
                                .foregroundStyle(playingId == recording.id ? .red : .accentColor)
                        }
                        .buttonStyle(.plain)

                        VStack(alignment: .leading) {
                            Text(recording.name)
                                .font(.subheadline)
                                .lineLimit(1)
                            HStack(spacing: 4) {
                                Text(recording.groupName)
                                Text("·")
                                Text(formatDuration(recording.durationSec))
                            }
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        }
                        .contentShape(Rectangle())
                        .onTapGesture {
                            if recording.uploadState != .uploading {
                                editName = recording.name
                                editingRecording = recording
                            }
                        }
                        Spacer()
                        uploadStatusView(recording)
                    }
                }
                .onDelete { offsets in
                    for index in offsets {
                        let recording = recordings[index]
                        if recording.uploadState == .pending || recording.uploadState == .uploading {
                            confirmDeleteId = recording.id
                        } else {
                            onDelete?(recording.id)
                        }
                    }
                }
            }
            .listStyle(.plain)
            .alert("Delete Recording?", isPresented: Binding(
                get: { confirmDeleteId != nil },
                set: { if !$0 { confirmDeleteId = nil } }
            )) {
                Button("Delete", role: .destructive) {
                    if let id = confirmDeleteId {
                        onDelete?(id)
                        confirmDeleteId = nil
                    }
                }
                Button("Cancel", role: .cancel) { confirmDeleteId = nil }
            } message: {
                Text("This recording hasn't been uploaded yet. Deleting it will permanently remove it.")
            }
            .alert("Rename Recording", isPresented: Binding(
                get: { editingRecording != nil },
                set: { if !$0 { editingRecording = nil } }
            )) {
                TextField("Name", text: $editName)
                Button("Save") {
                    if let rec = editingRecording, !editName.isEmpty {
                        onRename?(rec.id, editName)
                    }
                    editingRecording = nil
                }
                Button("Cancel", role: .cancel) { editingRecording = nil }
            }
            .onChange(of: isRecording) { _, recording in
                if recording {
                    player?.stop()
                    player = nil
                    playerDelegate = nil
                    playingId = nil
                }
            }
        }
    }

    private func togglePlayback(_ recording: Recording) {
        if playingId == recording.id {
            player?.stop()
            player = nil
            playerDelegate = nil
            playingId = nil
            return
        }

        player?.stop()

        let fileURL = recordingsDirectory.appendingPathComponent(recording.filename)
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return }

        do {
            try AVAudioSession.sharedInstance().setCategory(.playback)
            try AVAudioSession.sharedInstance().setActive(true)
            let newPlayer = try AVAudioPlayer(contentsOf: fileURL)
            let delegate = PlayerDelegate { [self] in
                self.player = nil
                self.playerDelegate = nil
                self.playingId = nil
            }
            newPlayer.delegate = delegate
            newPlayer.play()
            player = newPlayer
            playerDelegate = delegate
            playingId = recording.id
        } catch {
            print("[Playback] Error: \(error)")
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
            if let progress = recording.uploadProgress, progress > 0 {
                ProgressView(value: progress)
                    .progressViewStyle(.circular)
                    .frame(width: 20, height: 20)
            } else {
                ProgressView()
            }
        case .completed:
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
        case .failed:
            Button(action: { onRetry?(recording.id) }) {
                Label("Retry", systemImage: "arrow.clockwise")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
            .buttonStyle(.bordered)
            .tint(.red)
        }
    }

    private func formatDuration(_ seconds: Double) -> String {
        let mins = Int(seconds) / 60
        let secs = Int(seconds) % 60
        return String(format: "%d:%02d", mins, secs)
    }
}

// MARK: - AVAudioPlayerDelegate

private class PlayerDelegate: NSObject, AVAudioPlayerDelegate {
    let onFinished: () -> Void

    init(onFinished: @escaping () -> Void) {
        self.onFinished = onFinished
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        DispatchQueue.main.async { self.onFinished() }
    }
}
