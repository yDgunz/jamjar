import SwiftUI

struct RecordView: View {
    let recorder: AudioRecorder
    let store: RecordingStore
    let user: UserResponse?
    @Binding var selectedGroupId: Int?
    var onRecordingStopped: (() -> Void)?

    @State private var showPermissionAlert = false

    var groups: [UserGroup] { user?.groups ?? [] }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if let user, user.groups.count > 1 {
                    GroupPicker(groups: user.groups, selectedGroupId: $selectedGroupId)
                        .padding()
                }

                Spacer()

                VStack(spacing: 20) {
                    if recorder.isRecording {
                        Text(formatDuration(recorder.duration))
                            .font(.system(size: 48, weight: .light, design: .monospaced))

                        AudioLevelView(level: recorder.currentLevel)
                            .padding(.horizontal, 40)
                    }

                    Button(action: toggleRecording) {
                        ZStack {
                            Circle()
                                .fill(recorder.isRecording ? Color.red.opacity(0.2) : Color.red.opacity(0.1))
                                .frame(width: 120, height: 120)
                            Circle()
                                .fill(Color.red)
                                .frame(width: recorder.isRecording ? 40 : 80, height: recorder.isRecording ? 40 : 80)
                                .clipShape(RoundedRectangle(cornerRadius: recorder.isRecording ? 8 : 40))
                                .animation(.easeInOut(duration: 0.2), value: recorder.isRecording)
                        }
                    }
                    .disabled(user == nil)

                    if user == nil {
                        Text("Log in from Settings to start recording")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer()

                UploadQueueView(recordings: store.recordings.reversed())
                    .frame(maxHeight: 300)
            }
            .navigationTitle("Record")
            .alert("Microphone Access Required", isPresented: $showPermissionAlert) {
                Button("Open Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Jam Jar needs microphone access to record your jam sessions. Enable it in Settings.")
            }
        }
    }

    private func toggleRecording() {
        if recorder.isRecording {
            stopRecording()
        } else {
            startRecording()
        }
    }

    private func startRecording() {
        Task {
            let granted = await recorder.requestPermission()
            guard granted else {
                showPermissionAlert = true
                return
            }
            do {
                try recorder.start(to: store.directory)
            } catch {
                // Recording failed to start
            }
        }
    }

    private func stopRecording() {
        guard let result = recorder.stop() else { return }
        let groupId = selectedGroupId ?? groups.first?.id ?? 0
        let groupName = groups.first(where: { $0.id == groupId })?.name ?? "Unknown"
        let recording = Recording(
            id: UUID(),
            filename: result.url.lastPathComponent,
            groupId: groupId,
            groupName: groupName,
            createdAt: Date(),
            durationSec: result.duration,
            uploadState: .pending
        )
        store.add(recording)
        onRecordingStopped?()
    }

    private func formatDuration(_ seconds: TimeInterval) -> String {
        let h = Int(seconds) / 3600
        let m = (Int(seconds) % 3600) / 60
        let s = Int(seconds) % 60
        if h > 0 {
            return String(format: "%d:%02d:%02d", h, m, s)
        }
        return String(format: "%d:%02d", m, s)
    }
}
