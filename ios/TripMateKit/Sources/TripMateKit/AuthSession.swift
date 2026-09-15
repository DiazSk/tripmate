import Foundation

/// What Apple hands back from an authorization, reduced to the parts the server needs.
///
/// **`fullName` and `email` arrive only on the very first authorization for an Apple ID.** Every
/// later sign-in returns them as nil, by design — Apple treats them as one-time information the
/// relying party is expected to have kept. So they must be forwarded on that first exchange or
/// they are gone permanently, and the only recovery is the traveler revoking the app in Settings
/// and signing in again. This is the single most common Sign in with Apple defect, and it is
/// invisible in testing because the developer's own first sign-in already happened.
public struct AppleCredential: Encodable, Sendable, Equatable {
    /// The JWT the server verifies against Apple's public keys. Short-lived; exchanged
    /// immediately for a session token rather than used as a bearer.
    public let identityToken: String
    public let authorizationCode: String?
    /// First authorization only. Nil thereafter — see the type's note.
    public let fullName: String?
    /// First authorization only, and may be a private relay address the traveler can revoke.
    public let email: String?

    public init(
        identityToken: String, authorizationCode: String? = nil,
        fullName: String? = nil, email: String? = nil
    ) {
        self.identityToken = identityToken
        self.authorizationCode = authorizationCode
        self.fullName = fullName
        self.email = email
    }
}

/// `POST /api/auth/apple` — **proposed shape, pending backend agreement.**
public struct AuthTokenResponse: Decodable, Sendable, Equatable {
    public let token: String
    public let userId: String
    /// ISO-8601. Optional because a server may choose not to publish it; when absent, the client
    /// learns a token has expired from a 401 rather than by pre-empting it.
    public let expiresAt: String?
}

/// Holds the session token and nothing else.
///
/// An actor because the token is mutable state read from arbitrary concurrency contexts —
/// `TripMateAPI` asks for it on every request, and a background job wake-up asks for it off the
/// main thread.
///
/// **Deliberately does not know about `TripMateAPI`.** The obvious design has the session perform
/// its own sign-in, which needs the API, while the API needs the session for its bearer token — a
/// cycle. Breaking it costs the caller two lines and buys a session that is trivially testable
/// with no network in sight:
///
/// ```swift
/// let result = try await api.signInWithApple(credential)
/// try await session.adopt(result.token)
/// ```
public actor AuthSession {
    private let store: TokenStore
    private var cached: String?
    private var didLoad = false

    public init(store: TokenStore) {
        self.store = store
    }

    /// The token in force, reading through to the store exactly once.
    ///
    /// A Keychain read is a syscall, and this is called on every single request. Caching after the
    /// first read keeps that off the hot path; `adopt` and `signOut` are the only writers, and both
    /// update the cache, so it cannot go stale behind them.
    public func currentToken() -> String? {
        if !didLoad {
            didLoad = true
            cached = try? store.read()
        }
        return cached
    }

    public var isSignedIn: Bool { currentToken() != nil }

    /// Take ownership of a freshly minted session token.
    ///
    /// Writes the store *before* the cache. If the Keychain write fails this throws with the
    /// session unchanged, which is the honest outcome — a cache-first order would report a
    /// successful sign-in that does not survive relaunch.
    public func adopt(_ token: String) throws {
        try store.write(token)
        cached = token
        didLoad = true
    }

    /// Clear the session.
    ///
    /// Clears the cache even if the store throws. A token the app cannot delete is worse held onto
    /// than dropped: the traveler asked to be signed out, and leaving it live in memory so the next
    /// request succeeds is the one outcome nobody wants. The throw still propagates so a caller
    /// can report that the stored copy may remain.
    public func signOut() throws {
        cached = nil
        didLoad = true
        try store.clear()
    }

    /// A closure for `TripMateAPI(tokenProvider:)`.
    ///
    /// Capturing the actor rather than the token, so a sign-out is reflected on the very next
    /// request instead of the API holding a value that was true when it was constructed.
    public nonisolated func tokenProvider() -> @Sendable () async -> String? {
        { [weak self] in await self?.currentToken() }
    }
}

public extension TripMateAPI {
    /// Exchange Apple's identity token for a session token. Unauthenticated by nature — this is
    /// the call that establishes the session, so it carries no bearer.
    ///
    /// The response is **not** stored here; hand `token` to `AuthSession.adopt`. Keeping the
    /// network call and the credential store apart is what stops either needing the other.
    func signInWithApple(_ credential: AppleCredential) async throws -> AuthTokenResponse {
        try await postUnauthenticated(
            "/api/auth/apple", body: credential, as: AuthTokenResponse.self
        )
    }
}
