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
    /// Stored with the draft so the edit loop starts from the same profile planning used, rather
    /// than re-asking what generation already knew.
    public let userAnswers: UserAnswers?

    public init(
        destination: String, startDate: String, endDate: String, budget: Double,
        itinerary: Itinerary, status: TripStatus,
        runId: String? = nil, chatSessionId: String? = nil, userAnswers: UserAnswers? = nil
    ) {
        self.destination = destination
        self.startDate = startDate
        self.endDate = endDate
        self.budget = budget
        self.itinerary = itinerary
        self.status = status
        self.runId = runId
        self.chatSessionId = chatSessionId
        self.userAnswers = userAnswers
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

/// One line of the edit conversation, in the shape `/api/trip-edit` reads.
public struct ChatTurn: Codable, Sendable, Equatable, Identifiable {
    public enum Role: String, Codable, Sendable { case user, assistant }
    public let id: UUID
    public let role: Role
    public let content: String

    public init(id: UUID = UUID(), role: Role, content: String) {
        self.id = id
        self.role = role
        self.content = content
    }

    // `id` is ours, for SwiftUI; the route reads only role and content and rejects nothing extra,
    // but sending a key it never asked for is noise on a prompt we pay for by the token.
    private enum CodingKeys: String, CodingKey { case role, content }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = UUID()
        role = try c.decode(Role.self, forKey: .role)
        content = try c.decode(String.self, forKey: .content)
    }
}

/// `POST /api/trip-edit` in `chat` mode.
///
/// **`ops` deliberately does not appear.** The route applies the model's patch server-side and
/// returns the whole itinerary, so there is no `PatchOp` decoder on this platform and no second
/// implementation of `applyPatch` to keep in step. Persist `itinerary` and `sessionId`; the web
/// does the same through `patchDraft`.
public struct TripEdit: Decodable, Sendable, Equatable {
    public let ok: Bool
    /// The plan after the edit. Persist this — the server does not write it to the trip row.
    public let itinerary: Itinerary
    /// Prose for the traveller. Null on a turn that only changed the plan.
    public let reply: String?
    public let options: [String]
    public let changes: [String]
    /// Skill §12 guardrails — travel time, hours clashes, an over-long day, a budget overshoot.
    public let warnings: [String]
    /// 1-based, and derived from the ops the applier *accepted* rather than from what the model
    /// claimed it touched.
    public let daysModified: [Int]
    public let why: String?
    public let knockOn: String?
    /// Non-empty only when the model reached outside its scope, which means the edit did less
    /// than its reply says. Surface it rather than dropping it.
    public let rejected: [String]
    /// Echo both of these back on the next turn. `syncedHash` is **null when an op was rejected**
    /// — the session's picture of the plan is then wrong, and failing the match next turn is how
    /// the server is forced to resync rather than edit from a stale copy.
    public let sessionId: String?
    public let syncedHash: String?
}

public struct GeocodedPlace: Decodable, Sendable, Equatable {
    public let lat: Double
    /// The route renames the geocoder's own `lon` to `lng` on the way out. See contract rule 3.
    public let lng: Double
    public let name: String
}

/// `preferences` on `POST /api/itinerary`.
///
/// **`vibe` is always null, and that is faithful rather than lazy.** The prompt builder reads the
/// field and the web client sends `{tags, vibe: null}` from its one call site — nothing has ever
/// populated it. Encoded explicitly, because contract rule 5 is that nullable means an explicit
/// `null` rather than an absent key.
public struct GeneratePreferences: Encodable, Sendable, Equatable {
    public let tags: [String]
    public let vibe: String?

    public init(tags: [String], vibe: String? = nil) {
        self.tags = tags
        self.vibe = vibe
    }

    /// Hand-written because **`JSONEncoder` omits a nil optional rather than writing `null`**, and
    /// the whole point of this field is that the web sends an explicit one. `encode` on an
    /// `Optional` is what emits the null; `encodeIfPresent` is the default behaviour being
    /// overridden here.
    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(tags, forKey: .tags)
        try container.encode(vibe, forKey: .vibe)
    }

    private enum CodingKeys: String, CodingKey { case tags, vibe }
}

/// `POST /api/itinerary`.
///
/// **Sending fewer fields degrades plan quality; it does not fail the call** — which is why every
/// answer below the first four is optional, and why the wizard's later steps can be skipped.
///
/// `tier` is the exception that looks like an option: it is `nil`-able here because a *refine*
/// carries `previousItinerary` instead, but a first generation without one is a 400 **"No spending
/// style was selected"** (`route.ts:114`). Nothing picks it — `PlanDraft.tier` derives it from the
/// budget, so the real precondition is a budget above zero.
public struct GenerateRequest: Encodable, Sendable {
    public let destination: String
    public let startDate: String
    public let endDate: String
    public let budget: Double
    public let tier: TierId?
    public let preferences: GeneratePreferences?
    public let userAnswers: UserAnswers?
    /// Sent alongside `userAnswers.dietary` rather than only inside it. The legacy prompt has read
    /// the top-level field since `formatDietary` shipped, and a food stop the traveler cannot eat
    /// at is the worst defect this app can produce — so it goes in both places the server looks.
    public let dietary: DietaryNeeds?

    public init(
        destination: String, startDate: String, endDate: String,
        budget: Double, tier: TierId? = nil,
        preferences: GeneratePreferences? = nil,
        userAnswers: UserAnswers? = nil,
        dietary: DietaryNeeds? = nil
    ) {
        self.destination = destination
        self.startDate = startDate
        self.endDate = endDate
        self.budget = budget
        self.tier = tier
        self.preferences = preferences
        self.userAnswers = userAnswers
        self.dietary = dietary
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

    /// Ask the planner to change the plan in words.
    ///
    /// `trip` and `itinerary` are both required by the route: it rebuilds the edit context from
    /// the summary and patches the itinerary you send, not one it looks up — which is what lets
    /// the pre-save page edit a plan that has no row yet.
    public func editTrip(
        trip: TripSummary,
        itinerary: Itinerary,
        messages: [ChatTurn],
        dayIndex: Int? = nil,
        userAnswers: UserAnswers? = nil,
        sessionId: String? = nil,
        syncedHash: String? = nil
    ) async throws -> TripEdit {
        struct Body: Encodable {
            let mode = "chat"
            let trip: TripSummary
            let itinerary: Itinerary
            let tripId: String?
            let messages: [ChatTurn]
            let dayIndex: Int?
            let userAnswers: UserAnswers?
            let sessionId: String?
            let syncedHash: String?
        }
        let request = try await post(
            "/api/trip-edit",
            body: Body(
                trip: trip, itinerary: itinerary, tripId: trip.id, messages: messages,
                dayIndex: dayIndex, userAnswers: userAnswers,
                sessionId: sessionId, syncedHash: syncedHash
            )
        )
        return try await send(request, as: TripEdit.self)
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

    private struct ArrivalPointsEnvelope: Decodable { let points: [ArrivalPoint] }
    private struct RawFetchEnvelope: Decodable {
        struct RawFetch: Decodable {
            struct Candidates: Decodable {
                let available: Bool
                let pois: [CandidatePoi]
            }
            let candidatePois: Candidates
        }
        let rawFetch: RawFetch
    }
    /// Both directions: the route answers `{"profile": …}` and reads `body?.profile`.
    private struct ProfileEnvelope: Codable { let profile: TravelerProfile? }

    /// `GET /api/arrival-points?lat=&lon=` — the airports and stations near a destination.
    ///
    /// **Note `lon`, not `lng`.** Contract rule 3: this is the one geo route taking `lon` as a
    /// query param, while `/api/geocode` renames the geocoder's `lon` to `lng` on the way out.
    /// So the value handed in here comes from `GeocodedPlace.lng` and goes out as `lon`.
    ///
    /// **Never throws.** The route is always 200 and degrades to `{points: []}` on an Overpass
    /// outage, because the field it feeds is optional and free-text — an error here would
    /// surface on a question nobody was required to answer. This mirrors that: a failure is an
    /// empty list, not a thrown error.
    /// `POST /api/trip-fetch` — the places worth pinning before the plan is written.
    ///
    /// **The route returns the whole preference-independent bundle and this reads one field of
    /// it.** `rawFetch` also carries weather, holidays, highways and city geometry, none of
    /// which the picker needs; decoding only `candidatePois` keeps the four other shapes out of
    /// this client until something asks for them. The server does the work either way — the web
    /// fires this same call to warm its cache the moment the traveller leaves the basics step.
    ///
    /// **Never throws**, for the same reason `arrivalPoints` does not: these are optional
    /// anchors on an optional question. `available: false` and an empty list are different
    /// facts — the first means OpenTripMap could not be reached, the second means it had
    /// nothing — and the caller is told which.
    public func candidatePois(
        destination: String, startDate: String, endDate: String
    ) async -> (available: Bool, pois: [CandidatePoi]) {
        struct Body: Encodable {
            let destination: String
            let startDate: String
            let endDate: String
        }
        do {
            let envelope = try await send(
                await post(
                    "/api/trip-fetch",
                    body: Body(
                        destination: destination, startDate: startDate, endDate: endDate
                    )
                ),
                as: RawFetchEnvelope.self
            )
            return (envelope.rawFetch.candidatePois.available,
                    envelope.rawFetch.candidatePois.pois)
        } catch {
            return (false, [])
        }
    }

    public func arrivalPoints(lat: Double, lng: Double) async -> [ArrivalPoint] {
        do {
            let request = try await get(
                "/api/arrival-points",
                query: ["lat": String(lat), "lon": String(lng)]
            )
            return try await send(request, as: ArrivalPointsEnvelope.self).points
        } catch {
            return []
        }
    }

    /// `GET /api/place-photo?name=` — the Wikipedia photograph and extract for a place.
    ///
    /// Feeds the memories wall, the itinerary card's collapsing header and stop avatars. Look
    /// Around does not replace this: that is street-level imagery of somewhere you are standing
    /// near, this is the editorial photograph *of a destination*.
    ///
    /// **The 200/503 split is the caching contract, and it is the whole subtlety.** A miss
    /// returns all three fields `null` with a **200, deliberately, so the client caches it** —
    /// a place with no photograph should not be looked up again. A **503 "Lookup failed"** is
    /// the retryable case: the lookup itself failed, upstream or rate-limited, and caching that
    /// would leave a trip photo-less for the rest of the session.
    ///
    /// So this returns `PlacePhoto?`: a value to cache, or `nil` meaning "ask again". It
    /// deliberately does not surface `APIError` — 503 classifies as `spendCapReached`, which is
    /// wrong for this route (see `check`), and nothing here is worth showing a traveler anyway.
    /// The traveller's durable preferences, or `nil` when none have been saved.
    ///
    /// **`nil` is a real state, not a failure.** The route answers `{"profile": null}` for a
    /// traveller who has never filled the form in, and the caller must show an empty form rather
    /// than an error. A genuine failure throws.
    public func profile() async throws -> TravelerProfile? {
        try await send(try await get("/api/profile"), as: ProfileEnvelope.self).profile
    }

    /// `PUT`, not `POST` — verified against `src/app/api/profile/route.ts`, which exports only
    /// `GET` and `PUT` and answers `{ok: true}`. The body is enveloped the same way the response
    /// is; the route reads `body?.profile` and 400s on any other shape.
    public func saveProfile(_ profile: TravelerProfile) async throws {
        var request = try await post("/api/profile", body: ProfileEnvelope(profile: profile))
        request.httpMethod = "PUT"
        struct Ok: Decodable { let ok: Bool }
        _ = try await send(request, as: Ok.self)
    }

    public func placePhoto(name: String) async -> PlacePhoto? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        // A caller passing a field the traveler has not filled in yet would otherwise fire a
        // lookup for "" on every render, which can only 400.
        guard !trimmed.isEmpty else { return nil }
        do {
            return try await send(
                await get("/api/place-photo", query: ["name": trimmed]), as: PlacePhoto.self
            )
        } catch {
            return nil
        }
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
        // **503 does not always mean the spend cap, and this case overstates what the status
        // code knows.** Three routes send it for the cap — `/api/itinerary`, `/api/trip-edit`
        // and `/api/place-detail`, all with "Demo budget for today has been used up" — while
        // `/api/place-photo` sends it for "Lookup failed", a transient upstream miss with no
        // billing meaning. The bodies differ but branching on copy is worse than this note.
        //
        // Harmless today because the one non-cap sender is fail-soft and its caller
        // (`placePhoto`) ignores the classification entirely. **A new user-facing route that
        // 503s for any other reason would show the wrong message** — give it the same treatment
        // rather than relying on this.
        case 503: throw APIError.spendCapReached(message ?? "Temporarily unavailable.")
        default:  throw APIError.unexpectedStatus(http.statusCode, message)
        }
    }

    private static func mapped(_ error: Error) -> Error {
        if error is APIError { return error }
        return APIError.transport(error.localizedDescription)
    }
}
