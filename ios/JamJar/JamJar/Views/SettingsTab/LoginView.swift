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
                let url = apiClient.baseURL.absoluteString
                print("[Login] Attempting login to \(url) with email: \(email)")
                let (user, jwt) = try await apiClient.login(email: email, password: password)
                print("[Login] Success! User: \(user.name), JWT length: \(jwt.count)")
                try keychain.save(jwt, service: keychainService, account: "jwt")
                await MainActor.run { onLogin(user, jwt) }
            } catch APIError.httpError(let code) {
                await MainActor.run {
                    errorMessage = "HTTP \(code) from \(apiClient.baseURL.absoluteString)/api/auth/login"
                    isLoading = false
                }
            } catch APIError.missingCookie {
                await MainActor.run {
                    errorMessage = "Login succeeded but no JWT cookie in response. Server: \(apiClient.baseURL.absoluteString)"
                    isLoading = false
                }
            } catch let urlError as URLError {
                await MainActor.run {
                    errorMessage = "URLError \(urlError.code.rawValue): \(urlError.localizedDescription)\nURL: \(apiClient.baseURL.absoluteString)/api/auth/login"
                    isLoading = false
                }
            } catch {
                await MainActor.run {
                    errorMessage = "\(type(of: error)): \(error)\nURL: \(apiClient.baseURL.absoluteString)/api/auth/login"
                    isLoading = false
                }
            }
        }
    }
}
