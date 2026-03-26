import Testing
import Foundation
@testable import JamJar

struct KeychainHelperTests {
    let keychain = KeychainHelper()
    let testService = "com.jamjar.test.\(UUID().uuidString)"

    @Test func saveAndReadString() throws {
        try keychain.save("test-token-123", service: testService, account: "jwt")
        let result = try keychain.read(service: testService, account: "jwt")
        #expect(result == "test-token-123")
        try keychain.delete(service: testService, account: "jwt")
    }

    @Test func readMissingKeyReturnsNil() throws {
        let result = try keychain.read(service: testService, account: "nonexistent")
        #expect(result == nil)
    }

    @Test func deleteRemovesValue() throws {
        try keychain.save("to-delete", service: testService, account: "jwt")
        try keychain.delete(service: testService, account: "jwt")
        let result = try keychain.read(service: testService, account: "jwt")
        #expect(result == nil)
    }

    @Test func overwriteExistingValue() throws {
        try keychain.save("old-value", service: testService, account: "jwt")
        try keychain.save("new-value", service: testService, account: "jwt")
        let result = try keychain.read(service: testService, account: "jwt")
        #expect(result == "new-value")
        try keychain.delete(service: testService, account: "jwt")
    }
}
