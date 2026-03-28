import SwiftUI

struct SettingsView: View {
    let apiClient: APIClient
    let keychain: KeychainHelper
    let keychainService: String
    @Binding var user: UserResponse?
    @Binding var jwt: String?
    @Binding var wifiOnly: Bool
    @Binding var autoClean: Bool
    let store: RecordingStore

    @State private var showingLogin = false

    var body: some View {
        NavigationStack {
            Form {

                Section("Account") {
                    if let user {
                        LabeledContent("Name", value: user.name)
                        LabeledContent("Email", value: user.email)
                        LabeledContent("Role", value: user.role)
                        Button("Log Out", role: .destructive) { logout() }
                    } else {
                        Button("Log In") { showingLogin = true }
                    }
                }

                Section("Uploads") {
                    Toggle("WiFi Only", isOn: $wifiOnly)
                    Toggle("Auto-Delete After Upload", isOn: $autoClean)
                }

                Section("Storage") {
                    LabeledContent("Local Recordings", value: "\(store.recordings.count)")
                    LabeledContent("Disk Usage", value: formatBytes(store.diskUsageBytes))
                    let uploadedCount = store.recordings.filter { $0.uploadState == .completed }.count
                    if uploadedCount > 0 {
                        Button("Clear Uploaded Recordings") {
                            clearUploaded()
                        }
                    }
                }

                Section {
                    LabeledContent("Version", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—")
                }
            }
            .navigationTitle("Settings")
            .sheet(isPresented: $showingLogin) {
                NavigationStack {
                    LoginView(
                        apiClient: apiClient,
                        keychain: keychain,
                        keychainService: keychainService
                    ) { loggedInUser, token in
                        user = loggedInUser
                        jwt = token
                        showingLogin = false
                    }
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Cancel") { showingLogin = false }
                        }
                    }
                }
            }
        }
    }

    private func logout() {
        try? keychain.delete(service: keychainService, account: "jwt")
        user = nil
        jwt = nil
    }

    private func clearUploaded() {
        for rec in store.recordings where rec.uploadState == .completed {
            let fileURL = store.directory.appendingPathComponent(rec.filename)
            try? FileManager.default.removeItem(at: fileURL)
            store.delete(id: rec.id)
        }
    }

    private func formatBytes(_ bytes: Int64) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: bytes)
    }
}
