import SwiftUI

struct RecordView: View {
    let recorder: AudioRecorder
    let store: RecordingStore
    let user: UserResponse?
    @Binding var selectedGroupId: Int?
    var onRecordingStopped: (() -> Void)?
    var onRetryUpload: ((UUID) -> Void)?
    var onDeleteRecording: ((UUID) -> Void)?
    var onRenameRecording: ((UUID, String) -> Void)?
    var uploadsPaused: Bool = false

    @State private var showPermissionAlert = false
    @State private var showLowStorageAlert = false
    @State private var showRecordingError = false
    @State private var showNamePrompt = false
    @State private var pendingRecordingId: UUID?
    @State private var recordingName: String = ""

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

                    if user == nil && !recorder.isRecording {
                        Text("Log in from Settings to upload recordings")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer()

                if uploadsPaused {
                    Label("Uploads paused — waiting for WiFi", systemImage: "wifi.slash")
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .padding(.vertical, 6)
                        .padding(.horizontal, 12)
                        .background(.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
                        .padding(.horizontal)
                }

                UploadQueueView(recordings: store.recordings.reversed(), recordingsDirectory: store.directory, onRetry: onRetryUpload, onDelete: onDeleteRecording, onRename: onRenameRecording, isRecording: recorder.isRecording)
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
            .alert("Name Recording", isPresented: $showNamePrompt) {
                TextField("Name", text: $recordingName)
                Button("Save") {
                    if let id = pendingRecordingId, !recordingName.isEmpty {
                        onRenameRecording?(id, recordingName)
                    }
                    if user != nil {
                        onRecordingStopped?()
                    }
                    pendingRecordingId = nil
                }
            } message: {
                Text("This name will be used as the session name on the server.")
            }
            .alert("Low Storage", isPresented: $showLowStorageAlert) {
                Button("Record Anyway") {
                    Task {
                        let granted = await recorder.requestPermission()
                        guard granted else {
                            showPermissionAlert = true
                            return
                        }
                        do {
                            try recorder.start(to: store.directory)
                        } catch {
                            showRecordingError = true
                        }
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Less than 500 MB of storage remaining. Long recordings may fail if the device runs out of space.")
            }
            .alert("Recording Failed", isPresented: $showRecordingError) {
                Button("OK", role: .cancel) {}
            } message: {
                Text("Could not start recording. Another app may be using the microphone.")
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

    private static let minFreeBytes: Int64 = 500 * 1024 * 1024 // 500 MB

    private func startRecording() {
        if let freeSpace = try? URL(fileURLWithPath: NSHomeDirectory())
            .resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
            .volumeAvailableCapacityForImportantUsage,
           freeSpace < Self.minFreeBytes {
            showLowStorageAlert = true
            return
        }

        Task {
            let granted = await recorder.requestPermission()
            guard granted else {
                showPermissionAlert = true
                return
            }
            do {
                try recorder.start(to: store.directory)
            } catch {
                showRecordingError = true
            }
        }
    }

    private func stopRecording() {
        guard let result = recorder.stop() else { return }
        let groupId = selectedGroupId ?? groups.first?.id ?? 0
        let groupName = groups.first(where: { $0.id == groupId })?.name ?? "Not logged in"
        let fileBaseName = (result.url.lastPathComponent as NSString).deletingPathExtension
        let recording = Recording(
            id: UUID(),
            filename: result.url.lastPathComponent,
            groupId: groupId,
            groupName: groupName,
            createdAt: Date(),
            durationSec: result.duration,
            name: fileBaseName,
            uploadState: user != nil ? .pending : .failed
        )
        store.add(recording)
        recordingName = fileBaseName
        pendingRecordingId = recording.id
        showNamePrompt = true
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
