import Foundation
import Security

/// Where the session token lives.
///
/// A protocol with two real implementations, not a speculative seam: the Keychain one cannot be
/// exercised by `swift test` at all — an unsigned test binary gets `errSecMissingEntitlement`
/// (-34018) from the data-protection keychain — so without this the entire auth path would be
/// untestable outside a simulator. The in-memory one is what lets `AuthSession`'s logic be tested
/// on the host, and it is also what SwiftUI previews want.
public protocol TokenStore: Sendable {
    func read() throws -> String?
    func write(_ token: String) throws
    func clear() throws
}

public enum KeychainError: Error, Sendable, Equatable {
    /// Carries the raw `OSStatus`. Kept rather than flattened to a string because the numbers are
    /// the only way to tell "no token yet" from "the token is there but this process may not read
    /// it" — see `errSecItemNotFound` vs `errSecMissingEntitlement`.
    case status(OSStatus)
    case unexpectedData
}

/// The real store.
///
/// Three attribute choices carry the security of this file, and none is a default:
///
/// - **`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`.** `AfterFirstUnlock` rather than
///   `WhenUnlocked` because the background generation job has to read this token when the app is
///   woken by a push while the device is locked; `WhenUnlocked` would make that fail, and it would
///   fail only for users whose phone happened to be locked. `ThisDeviceOnly` because a session
///   token is bound to the device that authenticated — letting iCloud Keychain sync it would put a
///   live credential on a device that never signed in.
/// - **`kSecUseDataProtectionKeychain: true`.** Without it macOS falls back to the legacy
///   file-based keychain, which has different ACL semantics from iOS. Setting it means this class
///   behaves identically on both, so what a simulator proves also holds on device.
/// - **Add-or-update, never delete-then-add.** Delete-then-add is one line shorter and leaves a
///   window in which no token exists. A concurrent read landing in that window reads as
///   signed-out, which logs the traveler out of an app they were using.
public struct KeychainTokenStore: TokenStore {
    private let service: String
    private let account: String

    public init(service: String = "com.tripmate.session", account: String = "authToken") {
        self.service = service
        self.account = account
    }

    private var base: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecUseDataProtectionKeychain as String: true,
        ]
    }

    public func read() throws -> String? {
        var query = base
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        // Not an error: this is simply the signed-out state.
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw KeychainError.status(status) }
        guard let data = item as? Data, let token = String(data: data, encoding: .utf8) else {
            throw KeychainError.unexpectedData
        }
        return token
    }

    public func write(_ token: String) throws {
        var attributes = base
        attributes[kSecValueData as String] = Data(token.utf8)
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        let status = SecItemAdd(attributes as CFDictionary, nil)
        if status == errSecSuccess { return }
        guard status == errSecDuplicateItem else { throw KeychainError.status(status) }

        let update = [kSecValueData as String: Data(token.utf8)]
        let updated = SecItemUpdate(base as CFDictionary, update as CFDictionary)
        guard updated == errSecSuccess else { throw KeychainError.status(updated) }
    }

    public func clear() throws {
        let status = SecItemDelete(base as CFDictionary)
        // Already gone is the desired end state, not a failure.
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.status(status)
        }
    }
}

/// For tests and previews. Deliberately not `Keychain`-shaped: it makes no attempt to simulate
/// access control, because a fake that pretended to enforce it would be the worst of both worlds.
public final class InMemoryTokenStore: TokenStore, @unchecked Sendable {
    private let lock = NSLock()
    private var token: String?

    public init(token: String? = nil) { self.token = token }

    public func read() throws -> String? {
        lock.withLock { token }
    }

    public func write(_ token: String) throws {
        lock.withLock { self.token = token }
    }

    public func clear() throws {
        lock.withLock { token = nil }
    }
}
