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
                    switch code {
                    case 401: errorMessage = "Invalid email or password."
                    case 403: errorMessage = "Account is not authorized."
                    case 429: errorMessage = "Too many attempts. Please wait and try again."
                    case 500...599: errorMessage = "Server error. Please try again later."
                    default: errorMessage = "Login failed (HTTP \(code))."
                    }
                    isLoading = false
                }
            } catch APIError.missingCookie {
                await MainActor.run {
                    errorMessage = "Login failed — unexpected server response."
                    isLoading = false
                }
            } catch is URLError {
                await MainActor.run {
                    errorMessage = "Unable to reach server. Check your internet connection."
                    isLoading = false
                }
            } catch {
                await MainActor.run {
                    errorMessage = "Login failed. Please try again."
                    isLoading = false
                }
            }
        }
    }
}
