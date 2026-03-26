import AVFoundation
import Foundation
import MediaPlayer
import Observation

@Observable
class AudioRecorder {
    private var audioEngine: AVAudioEngine?
    private var audioFile: AVAudioFile?

    private(set) var isRecording = false
    private(set) var currentLevel: Float = 0.0
    private(set) var duration: TimeInterval = 0.0
    private(set) var outputURL: URL?

    private var startTime: Date?
    private var durationTimer: Timer?

    enum RecorderError: Error {
        case microphonePermissionDenied
        case engineStartFailed(Error)
    }

    func requestPermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    func start(to directory: URL) throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, options: [.defaultToSpeaker])
        try session.setActive(true)

        let engine = AVAudioEngine()
        let inputNode = engine.inputNode
        let inputFormat = inputNode.outputFormat(forBus: 0)

        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd_HHmmss"
        let filename = "\(formatter.string(from: Date())).m4a"
        let fileURL = directory.appendingPathComponent(filename)

        let outputSettings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: inputFormat.sampleRate,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 192_000,
        ]
        let file = try AVAudioFile(forWriting: fileURL, settings: outputSettings)

        inputNode.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { [weak self] buffer, _ in
            try? file.write(from: buffer)
            self?.updateLevel(buffer: buffer)
        }

        try engine.start()

        self.audioEngine = engine
        self.audioFile = file
        self.outputURL = fileURL
        self.startTime = Date()
        self.isRecording = true
        self.duration = 0

        startDurationTimer()
        setupNowPlaying()
    }

    func stop() -> (url: URL, duration: TimeInterval)? {
        guard isRecording, let url = outputURL else { return nil }
        let finalDuration = duration

        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine?.stop()
        audioFile = nil
        audioEngine = nil

        durationTimer?.invalidate()
        durationTimer = nil

        isRecording = false
        currentLevel = 0
        startTime = nil

        clearNowPlaying()

        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)

        return (url, finalDuration)
    }

    // MARK: Private

    private func updateLevel(buffer: AVAudioPCMBuffer) {
        guard let channelData = buffer.floatChannelData?[0] else { return }
        let frameCount = Int(buffer.frameLength)
        var sum: Float = 0
        for i in 0..<frameCount {
            sum += channelData[i] * channelData[i]
        }
        let rms = sqrt(sum / Float(max(frameCount, 1)))
        let normalized = min(rms / 0.5, 1.0)
        DispatchQueue.main.async { [weak self] in
            self?.currentLevel = normalized
        }
    }

    private func startDurationTimer() {
        durationTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            guard let self, let start = self.startTime else { return }
            self.duration = Date().timeIntervalSince(start)
        }
    }

    private func setupNowPlaying() {
        let center = MPNowPlayingInfoCenter.default()
        center.nowPlayingInfo = [
            MPMediaItemPropertyTitle: "Recording Jam Session",
            MPMediaItemPropertyArtist: "Jam Jar",
        ]
        let commandCenter = MPRemoteCommandCenter.shared()
        commandCenter.pauseCommand.isEnabled = true
        commandCenter.pauseCommand.addTarget { [weak self] _ in
            self?.stop()
            return .success
        }
    }

    private func clearNowPlaying() {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        MPRemoteCommandCenter.shared().pauseCommand.removeTarget(nil)
    }
}
