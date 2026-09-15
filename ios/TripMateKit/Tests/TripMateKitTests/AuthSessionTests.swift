import XCTest
import Security
@testable import TripMateKit

/// A store that fails on demand, so the ordering guarantees in `adopt` and `signOut` can be
/// asserted rather than hoped for. Those two orderings are the whole reason this file exists.
private final class FailingTokenStore: TokenStore, @unchecked Sendable {
    var stored: String?
    var failWrite = false
    var failClear = false

    func read() throws -> String? { stored }

    func write(_ token: String) throws {
        if failWrite { throw KeychainError.status(errSecIO) }
        stored = token
    }

    func clear() throws {
        if failClear { throw KeychainError.status(errSecIO) }
        stored = nil
    }
}

final class AuthSessionTests: XCTestCase {

    func testStartsSignedOutWhenTheStoreIsEmpty() async {
        let session = AuthSession(store: InMemoryTokenStore())
        let token = await session.currentToken()
        XCTAssertNil(token)
        let signedIn = await session.isSignedIn
        XCTAssertFalse(signedIn)
    }

    /// A token already in the Keychain from a previous launch is what makes the app open
    /// signed-in. Losing this is a logout on every cold start.
    func testAdoptsATokenAlreadyInTheStore() async {
        let session = AuthSession(store: InMemoryTokenStore(token: "from-last-launch"))
        let token = await session.currentToken()
        XCTAssertEqual(token, "from-last-launch")
    }

    func testAdoptPersistsAndBecomesCurrent() async throws {
        let store = InMemoryTokenStore()
        let session = AuthSession(store: store)
        try await session.adopt("fresh")
        let token = await session.currentToken()
        XCTAssertEqual(token, "fresh")
        // Persisted, not merely cached — this is what survives relaunch.
        XCTAssertEqual(try store.read(), "fresh")
    }

    /// Store first, cache second. A cache-first order would report a successful sign-in that does
    /// not survive relaunch, which is the worst possible way for a Keychain failure to present.
    func testAdoptLeavesTheSessionUnchangedWhenTheStoreFails() async {
        let store = FailingTokenStore()
        store.failWrite = true
        let session = AuthSession(store: store)

        do {
            try await session.adopt("never-lands")
            XCTFail("expected the store failure to propagate")
        } catch {}

        let token = await session.currentToken()
        XCTAssertNil(token, "a failed write must not leave a live token in memory")
    }

    func testSignOutClearsBothCacheAndStore() async throws {
        let store = InMemoryTokenStore(token: "live")
        let session = AuthSession(store: store)
        _ = await session.currentToken()

        try await session.signOut()

        let token = await session.currentToken()
        XCTAssertNil(token)
        XCTAssertNil(try store.read())
    }

    /// The inverse ordering to `adopt`, and deliberately so: the traveler asked to be signed out,
    /// so a token the app cannot delete is still dropped from memory. The throw propagates so the
    /// caller can say the stored copy may remain.
    func testSignOutStillClearsMemoryWhenTheStoreFails() async {
        let store = FailingTokenStore()
        store.stored = "stuck"
        store.failClear = true
        let session = AuthSession(store: store)
        _ = await session.currentToken()

        do {
            try await session.signOut()
            XCTFail("expected the store failure to propagate")
        } catch {}

        let token = await session.currentToken()
        XCTAssertNil(token, "sign-out must not leave a usable token behind")
    }

    /// The provider captures the actor, not the value, so a sign-out is visible on the very next
    /// request rather than whenever the API was constructed.
    func testTokenProviderReflectsLaterChanges() async throws {
        let session = AuthSession(store: InMemoryTokenStore())
        let provider = session.tokenProvider()

        var seen = await provider()
        XCTAssertNil(seen)

        try await session.adopt("t1")
        seen = await provider()
        XCTAssertEqual(seen, "t1")

        try await session.signOut()
        seen = await provider()
        XCTAssertNil(seen)
    }
}

final class KeychainTokenStoreTests: XCTestCase {

    /// Runs on a simulator or device; **skips under `swift test`**, where an unsigned binary gets
    /// `errSecMissingEntitlement` (-34018) from the data-protection keychain. Skipping rather than
    /// deleting means the coverage arrives for free the first time this suite runs in a simulator,
    /// instead of the Keychain layer being permanently unverified.
    func testRoundTripsAToken() throws {
        let store = KeychainTokenStore(service: "com.tripmate.tests", account: "roundtrip")
        do {
            try store.clear()
            try store.write("secret")
        } catch KeychainError.status(let status) where status == errSecMissingEntitlement {
            throw XCTSkip(
                "keychain unavailable to an unsigned test binary (errSecMissingEntitlement); "
                + "run this suite in a simulator to cover it"
            )
        }

        XCTAssertEqual(try store.read(), "secret")

        // Add-or-update, not delete-then-add: overwriting must never leave a window with no token.
        try store.write("rotated")
        XCTAssertEqual(try store.read(), "rotated")

        try store.clear()
        XCTAssertNil(try store.read())
        // Clearing twice is the desired end state, not an error.
        XCTAssertNoThrow(try store.clear())
    }
}
