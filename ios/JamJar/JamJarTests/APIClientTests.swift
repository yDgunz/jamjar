import Testing
import Foundation
@testable import JamJar

struct APIClientTests {
    let client = APIClient(baseURL: URL(string: "https://jam-jar.app")!)

    @Test func loginRequestShape() throws {
        let request = client.buildLoginRequest(email: "test@example.com", password: "secret")
        #expect(request.url?.absoluteString == "https://jam-jar.app/api/auth/login")
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
        let body = try JSONDecoder().decode(LoginBody.self, from: request.httpBody!)
        #expect(body.email == "test@example.com")
        #expect(body.password == "secret")
    }

    @Test func meRequestIncludesCookie() throws {
        let request = client.buildMeRequest(jwt: "fake-jwt-token")
        #expect(request.url?.absoluteString == "https://jam-jar.app/api/auth/me")
        #expect(request.httpMethod == "GET")
        #expect(request.value(forHTTPHeaderField: "Cookie") == "jam_session=fake-jwt-token")
    }

    @Test func uploadInitRequestShape() throws {
        let request = try client.buildUploadInitRequest(
            filename: "2026-03-25_140000.m4a", groupId: 5, jwt: "tok"
        )
        #expect(request.url?.absoluteString == "https://jam-jar.app/api/sessions/upload/init")
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Cookie") == "jam_session=tok")
        let body = try JSONDecoder().decode(UploadInitBody.self, from: request.httpBody!)
        #expect(body.filename == "2026-03-25_140000.m4a")
        #expect(body.group_id == 5)
    }

    @Test func uploadCompleteRequestShape() throws {
        let request = try client.buildUploadCompleteRequest(
            jobId: "abc123", sessionId: 42, jwt: "tok"
        )
        #expect(request.url?.absoluteString == "https://jam-jar.app/api/sessions/upload/complete")
        #expect(request.httpMethod == "POST")
        let body = try JSONDecoder().decode(UploadCompleteBody.self, from: request.httpBody!)
        #expect(body.job_id == "abc123")
        #expect(body.session_id == 42)
    }

    @Test func jobStatusRequestShape() throws {
        let request = client.buildJobStatusRequest(jobId: "abc123", jwt: "tok")
        #expect(request.url?.absoluteString == "https://jam-jar.app/api/jobs/abc123")
        #expect(request.httpMethod == "GET")
        #expect(request.value(forHTTPHeaderField: "Cookie") == "jam_session=tok")
    }

    @Test func parseLoginResponse() throws {
        let json = """
        {"id": 1, "email": "test@example.com", "name": "Test User", "role": "editor",
         "groups": [{"id": 2, "name": "The Band"}]}
        """.data(using: .utf8)!
        let user = try JSONDecoder().decode(UserResponse.self, from: json)
        #expect(user.id == 1)
        #expect(user.email == "test@example.com")
        #expect(user.groups.count == 1)
        #expect(user.groups[0].id == 2)
        #expect(user.groups[0].name == "The Band")
    }

    @Test func parseUploadInitResponse() throws {
        let json = """
        {"upload_url": "https://r2.example.com/put", "r2_key": "recordings/file.m4a",
         "job": {"id": "j1", "type": "upload", "group_id": 2, "status": "pending",
                 "progress": "Waiting", "session_id": 10, "error": null},
         "session_id": 10}
        """.data(using: .utf8)!
        let resp = try JSONDecoder().decode(UploadInitResponse.self, from: json)
        #expect(resp.upload_url == "https://r2.example.com/put")
        #expect(resp.job.id == "j1")
        #expect(resp.session_id == 10)
    }

    @Test func parseJobResponse() throws {
        let json = """
        {"id": "j1", "type": "upload", "group_id": 2, "status": "completed",
         "progress": "Done", "session_id": 10, "error": null}
        """.data(using: .utf8)!
        let job = try JSONDecoder().decode(JobResponse.self, from: json)
        #expect(job.id == "j1")
        #expect(job.status == "completed")
    }
}
