import SwiftUI

struct LoginView: View {
    let apiClient: APIClient
    let keychain: KeychainHelper
    let keychainService: String
    let onLogin: (UserResponse, String) -> Void

    @State private var email = ""
    @State private var password = ""
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        Form {
            Section {
                TextField("Email", text: $email)
                    .textContentType(.emailAddress)
                    .autocapitalization(.none)
                    .keyboardType(.emailAddress)
                SecureField("Password", text: $password)
                    .textContentType(.password)
            }
            if let errorMessage {
                Section {
                    Text(errorMessage)
                        .foregroundStyle(.red)
                }
            }
            Section {
                Button(action: login) {
                    if isLoading {
                        ProgressView()
                    } else {
                        Text("Log In")
                    }
                }
                .disabled(email.isEmpty || password.isEmpty || isLoading)
            }
        }
        .navigationTitle("Log In")
    }

    private func login() {
        isLoading = true
        errorMessage = nil
        Task {
            do {
                let (user, jwt) = try await apiClient.login(email: email, password: password)
                try keychain.save(jwt, service: keychainService, account: "jwt")
                await MainActor.run { onLogin(user, jwt) }
            } catch APIError.httpError(let code) {
                await MainActor.run {
                    errorMessage = code == 401 ? "Invalid email or password." : "Server error (\(code))."
                    isLoading = false
                }
            } catch {
                await MainActor.run {
                    errorMessage = "Connection failed. Check your server URL."
                    isLoading = false
                }
            }
        }
    }
}
