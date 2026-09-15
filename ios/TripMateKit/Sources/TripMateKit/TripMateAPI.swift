import Foundation

/// Every way a call to this API can fail, as cases a UI can actually switch on.
///
/// Two of these are **not failures** and the contract says so explicitly: `throttled` and
/// `spendCapReached` are first-class states with their own copy, reached in normal use. Collapsing
/// them into a generic error is how "slow down for a moment" becomes "something went wrong".
public enum APIError: Error, Sendable, Equatable {
    /// 429. IP-bucketed today, so on cellular this can fire because of a stranger. Re-keyed onto
    /// the user id by the auth phase.
    case throttled(String)
    /// 503. The rolling-24h spend cap, global across all users until per-user metering lands.
    case spendCapReached(String)
    /// 401. The bearer token was rejected — expired, revoked, or minted by a different
    /// deployment. **The correct response is to sign out**, not to retry: nothing the client can
    /// do makes a rejected token acceptable, and retrying turns one failure into a loop.
    case unauthorized
    /// 402. No active entitlement — generation and refine are the paid tier.
    case notEntitled
    case notFound(String)
    case badRequest(String)
    /// 500. Note two routes leak raw internal error text here; never surface this verbatim.
    case server(String)
    /// URLSession itself failed — offline, DNS, TLS. Distinct from any HTTP status.
    case transport(String)
    case decoding(String)
    case unexpectedStatus(Int, String?)
}

// MARK: - Request and response envelopes

/// `POST /api/trips`.
///
/// **`status` is not optional here, deliberately.** The handler reads
/// `status === "draft" ? "draft" : "saved"`, so *omitting* it inserts a **kept** trip — the
/// opposite of what a caller creating a provisional plan wants. Making it required means you
/// cannot save a trip the traveler never chose by forgetting a field.
public struct CreateTripRequest: Encodable, Sendable {
    public let destination: String
    public let startDate: String
    public let endDate: String
    /// Must encode as a JSON number; the handler rejects anything else with a 400.
    public let budget: Double
    public let itinerary: Itinerary
    public let status: TripStatus
    public let runId: String?
    public let chatSessionId: String?

    public init(
        destination: String, startDate: String, endDate: String, budget: Double,
        itinerary: Itinerary, status: TripStatus,
        runId: String? = nil, chatSessionId: String? = nil
    ) {
        self.destination = destination
        self.startDate = startDate
        self.endDate = endDate
        self.budget = budget
        self.itinerary = itinerary
        self.status = status
        self.runId = runId
        self.chatSessionId = chatSessionId
    }
}

/// `PATCH /api/trips/:id`. `endDate` is **server-derived**, not echoed back — the trip's length is
/// a property of the itinerary being saved, so an edit that added a day cannot leave the column
/// disagreeing with the plan. Persist what comes back rather than what you sent.
public struct TripUpdate: Decodable, Sendable, Equatable {
    public let ok: Bool
    public let endDate: String
    public let days: Int
    public let status: TripStatus
}

public struct GeocodedPlace: Decodable, Sendable, Equatable {
    public let lat: Double
    /// The route renames the geocoder's own `lon` to `lng` on the way out. See contract rule 3.
    public let lng: Double
    public let name: String
}

/// `POST /api/itinerary`. Minimal on purpose — the wizard phase adds `preferences` and the full
/// `userAnswers` tree when there is a wizard to collect them. Sending fewer fields degrades plan
/// quality; it does not fail the call.
public struct GenerateRequest: Encodable, Sendable {
    public let destination: String
    public let startDate: String
    public let endDate: String
    public let budget: Double
    public let tier: TierId?

    public init(
        destination: String, startDate: String, endDate: String,
        budget: Double, tier: TierId? = nil
    ) {
        self.destination = destination
        self.startDate = startDate
        self.endDate = endDate
        self.budget = budget
        self.tier = tier
    }
}

// MARK: - The client

public struct TripMateAPI: Sendable {
    private let baseURL: URL
    private let session: URLSession
    private let decoder: JSONDecoder
    /// Supplies the bearer token once auth exists. Optional because it does not yet — the cookie
    /// mechanism it replaces is explicitly not an authorization boundary, so there is nothing
    /// worth sending in the meantime.
    private let tokenProvider: (@Sendable () async -> String?)?

    public init(
        baseURL: URL,
        session: URLSession = .shared,
        tokenProvider: (@Sendable () async -> String?)? = nil
    ) {
        self.baseURL = baseURL
        self.session = session
        self.decoder = .tripMate
        self.tokenProvider = tokenProvider
    }

    // MARK: Trips

    private struct TripsEnvelope: Decodable { let trips: [TripSummary] }
    private struct IdEnvelope: Decodable { let id: String }

    /// `status` defaults to `saved` server-side — anything that isn't `draft` is narrowed to it.
    public func listTrips(status: TripStatus = .saved) async throws -> [TripSummary] {
        var request = try await get("/api/trips", query: ["status": status.rawValue])
        request.httpMethod = "GET"
        return try await send(request, as: TripsEnvelope.self).trips
    }

    public func trip(id: String) async throws -> Trip {
        try await send(await get("/api/trips/\(id)"), as: Trip.self)
    }

    public func createTrip(_ body: CreateTripRequest) async throws -> String {
        try await send(await post("/api/trips", body: body), as: IdEnvelope.self).id
    }

    /// `status` is write-once and forward-only: only `.saved` is honoured, and passing `nil`
    /// leaves the column alone — which is what a draft autosave must do, or it would promote a
    /// plan the traveler has not kept.
    public func updateTrip(
        id: String, itinerary: Itinerary,
        status: TripStatus? = nil, chatSessionId: String? = nil
    ) async throws -> TripUpdate {
        struct Body: Encodable {
            let itinerary: Itinerary
            let status: TripStatus?
            let chatSessionId: String?
        }
        var request = try await post(
            "/api/trips/\(id)",
            body: Body(itinerary: itinerary, status: status, chatSessionId: chatSessionId)
        )
        request.httpMethod = "PATCH"
        return try await send(request, as: TripUpdate.self)
    }

    public func deleteTrip(id: String) async throws {
        var request = try await get("/api/trips/\(id)")
        request.httpMethod = "DELETE"
        struct Ok: Decodable { let ok: Bool }
        _ = try await send(request, as: Ok.self)
    }

    // MARK: Lookups

    /// Prefer this over calling Open-Meteo directly. The web client hits the geocoder from the
    /// browser for autocomplete; doing the same here would put a third-party host in the app's
    /// network profile for no gain, and this route already caches.
    public func geocode(destination: String) async throws -> GeocodedPlace {
        try await send(
            await get("/api/geocode", query: ["destination": destination]),
            as: GeocodedPlace.self
        )
    }

    // MARK: Generation

    /// Stream a generation, stop by stop.
    ///
    /// Three things this handles that a naive `bytes(for:)` loop does not:
    ///
    /// 1. **The throttle and spend cap fire *before* the stream opens**, as ordinary JSON
    ///    responses — even with `?stream=1`. So the status is checked first and surfaces as a
    ///    typed `APIError`, not as an empty stream.
    /// 2. **The `error` event arrives on an HTTP 200.** It comes through as `.failure`, since
    ///    there is no status code left to carry it.
    /// 3. **An `error` after a `plan` is dropped**, matching the web client's own rule. A plan is
    ///    interactive from the moment `plan` lands while the run keeps going, so a late failure
    ///    must never tear down something already on screen. Enforced here rather than left to
    ///    each caller, because getting it wrong is invisible until it happens to a real traveler.
    ///
    /// Cancelling the returned stream stops *delivery*, not the work: the server has no
    /// cancellation token, so the model call finishes and is billed either way.
    public func generate(_ body: GenerateRequest) -> AsyncThrowingStream<GenerationEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    var request = try await post("/api/itinerary", body: body, query: ["stream": "1"])
                    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    request.timeoutInterval = 300

                    let (bytes, response) = try await session.bytes(for: request)
                    try Self.check(response, bodyForError: nil)

                    var parser = SSEFrameParser()
                    var planArrived = false
                    // `AsyncBytes` yields one byte at a time. Accumulating to the next newline
                    // before handing the parser a chunk keeps its buffer scan off an O(n²) path,
                    // and reassembly still belongs entirely to the parser — this is a throughput
                    // detail, never a correctness one.
                    var pending = Data()
                    for try await byte in bytes {
                        pending.append(byte)
                        guard byte == 0x0A else { continue }
                        let frames = parser.consume(pending)
                        pending.removeAll(keepingCapacity: true)
                        for frame in frames {
                            let event = try frame.asGenerationEvent(decoder: decoder)
                            if case .failure = event, planArrived { continue }
                            if case .plan = event { planArrived = true }
                            continuation.yield(event)
                        }
                    }
                    continuation.finish()
                } catch is CancellationError {
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: Self.mapped(error))
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // MARK: - Plumbing

    private func url(_ path: String, query: [String: String]) throws -> URL {
        guard var components = URLComponents(
            url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false
        ) else { throw APIError.transport("could not build a URL for \(path)") }
        if !query.isEmpty {
            components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let built = components.url else {
            throw APIError.transport("could not build a URL for \(path)")
        }
        return built
    }

    private func get(_ path: String, query: [String: String] = [:]) async throws -> URLRequest {
        var request = URLRequest(url: try url(path, query: query))
        await authorize(&request)
        return request
    }

    private func post(
        _ path: String, body: some Encodable, query: [String: String] = [:]
    ) async throws -> URLRequest {
        var request = URLRequest(url: try url(path, query: query))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        await authorize(&request)
        return request
    }

    /// A POST that deliberately carries no bearer, for the call that *establishes* the session.
    ///
    /// Internal rather than private so `signInWithApple` can live next to the credential types it
    /// belongs with, while `url` and `send` stay private to this file.
    func postUnauthenticated<T: Decodable>(
        _ path: String, body: some Encodable, as type: T.Type
    ) async throws -> T {
        var request = URLRequest(url: try url(path, query: [:]))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return try await send(request, as: type)
    }

    private func authorize(_ request: inout URLRequest) async {
        guard let token = await tokenProvider?() else { return }
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }

    private func send<T: Decodable>(_ request: URLRequest, as type: T.Type) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw Self.mapped(error)
        }
        try Self.check(response, bodyForError: data)
        do {
            return try decoder.decode(type, from: data)
        } catch {
            throw APIError.decoding(String(describing: error))
        }
    }

    /// Maps an HTTP status to a typed case, pulling the server's own `{error}` string through so
    /// the copy a route author wrote is the copy the traveler sees.
    private static func check(_ response: URLResponse, bodyForError data: Data?) throws {
        guard let http = response as? HTTPURLResponse else {
            throw APIError.transport("response was not HTTP")
        }
        if (200..<300).contains(http.statusCode) { return }

        struct Envelope: Decodable { let error: String? }
        let message = data
            .flatMap { try? JSONDecoder().decode(Envelope.self, from: $0) }
            .flatMap(\.error)

        switch http.statusCode {
        case 400: throw APIError.badRequest(message ?? "The request was rejected.")
        case 401: throw APIError.unauthorized
        case 402: throw APIError.notEntitled
        case 404: throw APIError.notFound(message ?? "Not found.")
        case 429: throw APIError.throttled(message ?? "Too many requests.")
        case 500: throw APIError.server(message ?? "Something went wrong.")
        case 503: throw APIError.spendCapReached(message ?? "Temporarily unavailable.")
        default:  throw APIError.unexpectedStatus(http.statusCode, message)
        }
    }

    private static func mapped(_ error: Error) -> Error {
        if error is APIError { return error }
        return APIError.transport(error.localizedDescription)
    }
}
