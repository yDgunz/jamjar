import Foundation

// MARK: - Request/Response Models

struct LoginBody: Codable, Sendable {
    let email: String
    let password: String
}

struct UserGroup: Codable, Identifiable, Equatable, Sendable {
    let id: Int
    let name: String
}

struct UserResponse: Codable, Equatable, Sendable {
    let id: Int
    let email: String
    let name: String
    let role: String
    let groups: [UserGroup]
}

struct UploadInitBody: Codable, Sendable {
    let filename: String
    let group_id: Int
}

struct UploadInitResponse: Codable, Sendable {
    let upload_url: String?
    let r2_key: String?
    let job: JobResponse
    let session_id: Int
}

struct UploadCompleteBody: Codable, Sendable {
    let job_id: String
    let session_id: Int
}

struct JobResponse: Codable, Sendable {
    let id: String
    let type: String
    let group_id: Int
    let status: String
    let progress: String
    let session_id: Int?
    let error: String?
}

// MARK: - API Client

struct APIClient {
    let baseURL: URL

    // MARK: Request Builders

    func buildLoginRequest(email: String, password: String) -> URLRequest {
        var request = makeRequest(path: "/api/auth/login", method: "POST")
        request.httpBody = try? JSONEncoder().encode(LoginBody(email: email, password: password))
        return request
    }

    func buildMeRequest(jwt: String) -> URLRequest {
        var request = makeRequest(path: "/api/auth/me", method: "GET")
        request.setValue("jam_session=\(jwt)", forHTTPHeaderField: "Cookie")
        return request
    }

    func buildUploadInitRequest(filename: String, groupId: Int, jwt: String) throws -> URLRequest {
        var request = makeRequest(path: "/api/sessions/upload/init", method: "POST")
        request.setValue("jam_session=\(jwt)", forHTTPHeaderField: "Cookie")
        request.httpBody = try JSONEncoder().encode(UploadInitBody(filename: filename, group_id: groupId))
        return request
    }

    func buildUploadCompleteRequest(jobId: String, sessionId: Int, jwt: String) throws -> URLRequest {
        var request = makeRequest(path: "/api/sessions/upload/complete", method: "POST")
        request.setValue("jam_session=\(jwt)", forHTTPHeaderField: "Cookie")
        request.httpBody = try JSONEncoder().encode(UploadCompleteBody(job_id: jobId, session_id: sessionId))
        return request
    }

    func buildJobStatusRequest(jobId: String, jwt: String) -> URLRequest {
        var request = makeRequest(path: "/api/jobs/\(jobId)", method: "GET")
        request.setValue("jam_session=\(jwt)", forHTTPHeaderField: "Cookie")
        return request
    }

    func buildPresignedPutRequest(url: URL, fileURL: URL) -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("audio/mp4", forHTTPHeaderField: "Content-Type")
        return request
    }

    // MARK: High-Level Methods

    func login(email: String, password: String) async throws -> (UserResponse, String) {
        let request = buildLoginRequest(email: email, password: password)
        let (data, response) = try await URLSession.shared.data(for: request)
        let httpResponse = response as! HTTPURLResponse
        guard httpResponse.statusCode == 200 else {
            throw APIError.httpError(httpResponse.statusCode)
        }
        let user = try JSONDecoder().decode(UserResponse.self, from: data)
        guard let setCookie = httpResponse.value(forHTTPHeaderField: "Set-Cookie"),
              let jwt = extractJWT(from: setCookie) else {
            throw APIError.missingCookie
        }
        return (user, jwt)
    }

    func getMe(jwt: String) async throws -> UserResponse {
        let request = buildMeRequest(jwt: jwt)
        let (data, response) = try await URLSession.shared.data(for: request)
        let httpResponse = response as! HTTPURLResponse
        guard httpResponse.statusCode == 200 else {
            throw APIError.httpError(httpResponse.statusCode)
        }
        return try JSONDecoder().decode(UserResponse.self, from: data)
    }

    func uploadInit(filename: String, groupId: Int, jwt: String) async throws -> UploadInitResponse {
        let request = try buildUploadInitRequest(filename: filename, groupId: groupId, jwt: jwt)
        let (data, response) = try await URLSession.shared.data(for: request)
        let httpResponse = response as! HTTPURLResponse
        guard httpResponse.statusCode == 200 else {
            throw APIError.httpError(httpResponse.statusCode)
        }
        return try JSONDecoder().decode(UploadInitResponse.self, from: data)
    }

    func uploadComplete(jobId: String, sessionId: Int, jwt: String) async throws -> JobResponse {
        let request = try buildUploadCompleteRequest(jobId: jobId, sessionId: sessionId, jwt: jwt)
        let (data, response) = try await URLSession.shared.data(for: request)
        let httpResponse = response as! HTTPURLResponse
        guard httpResponse.statusCode == 202 else {
            throw APIError.httpError(httpResponse.statusCode)
        }
        return try JSONDecoder().decode(JobResponse.self, from: data)
    }

    func getJobStatus(jobId: String, jwt: String) async throws -> JobResponse {
        let request = buildJobStatusRequest(jobId: jobId, jwt: jwt)
        let (data, response) = try await URLSession.shared.data(for: request)
        let httpResponse = response as! HTTPURLResponse
        guard httpResponse.statusCode == 200 else {
            throw APIError.httpError(httpResponse.statusCode)
        }
        return try JSONDecoder().decode(JobResponse.self, from: data)
    }

    // MARK: Private

    private func makeRequest(path: String, method: String) -> URLRequest {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return request
    }

    private func extractJWT(from setCookie: String) -> String? {
        for part in setCookie.split(separator: ";") {
            let trimmed = part.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("jam_session=") {
                return String(trimmed.dropFirst("jam_session=".count))
            }
        }
        return nil
    }
}

enum APIError: Error {
    case httpError(Int)
    case missingCookie
}
