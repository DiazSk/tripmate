import Foundation

/// The trip tree as it arrives on the wire, per `docs/api-contract-v1.md`.
///
/// Every leniency below is load-bearing and traceable to a specific handler, not defensive
/// habit. Swift's synthesized `Decodable` already ignores unknown keys, which satisfies the
/// contract's first rule for free — `toTripDetail` spreads unvalidated stored JSON into
/// `itinerary`, so unknown keys always arrive and must never be an error.

// MARK: - Lenient scalars

extension KeyedDecodingContainer {
    /// A `Double` that may arrive as a JSON string.
    ///
    /// Needed because `normalizeDays` — which coerces `cost` through `money()` server-side — runs
    /// on trip *reads* but **not** on SSE `stop` frames. So the same stop is a clean number when
    /// re-read from `GET /api/trips/:id` and can be `"42"` when streamed. Decoding strictly here
    /// means the live stop-by-stop reveal dies on a plausible model output.
    func decodeLenientDouble(forKey key: K) throws -> Double {
        if let d = try? decode(Double.self, forKey: key) { return d }
        if let s = try? decode(String.self, forKey: key), let d = Double(s) { return d }
        throw DecodingError.dataCorruptedError(
            forKey: key, in: self,
            debugDescription: "expected a number, or a string parseable as one"
        )
    }

    /// The optional form, for `actualCost`.
    func decodeLenientDoubleIfPresent(forKey key: K) throws -> Double? {
        if let d = try? decodeIfPresent(Double.self, forKey: key) { return d }
        if let s = try? decodeIfPresent(String.self, forKey: key) { return Double(s) }
        return nil
    }
}

// MARK: - Enums with unknown-value fallbacks

/// `food | entry | transit | other`, and **anything else decodes to `.other`**.
///
/// Same root cause as `decodeLenientDouble`: `normalizeCategory()` guards the read path only, so a
/// streamed frame can carry an arbitrary string. A strict enum would reject a stop the server is
/// perfectly happy to store and re-serve.
public enum StopCategory: String, Codable, Sendable, CaseIterable {
    case food, entry, transit, other

    /// The mark this kind of stop carries, wherever it is drawn.
    ///
    /// **On the category rather than at the two call sites**, because there are two — the stop
    /// row's glyph and the day's spend tile — and they must never show different marks for
    /// `food`. `Spend.tiles` reads this; a test asserts the two agree.
    public var symbol: String {
        switch self {
        case .food: "fork.knife"
        case .entry: "ticket"
        case .transit: "tram"
        case .other: "mappin"
        }
    }

    public init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = StopCategory(rawValue: raw) ?? .other
    }
}

/// `budget | midrange | luxury`. Unknown values are surfaced rather than swallowed — unlike
/// `StopCategory`, there is no streaming path that can invent one, so an unrecognised tier means
/// the wire genuinely disagrees with this client and silence would hide it.
public enum TierId: String, Codable, Sendable {
    case budget, midrange, luxury
}

public enum TripStatus: String, Codable, Sendable {
    case draft, saved
}

// MARK: - The tree

public struct Stop: Codable, Sendable, Equatable {
    public let name: String
    public let lat: Double
    /// Note `lng`. `CandidatePoi`, `ReconciledTrip.selectedPois` and the SSE `day-coords` payload
    /// all spell it `lon` — see `DayCoordsEvent`. One shared coordinate type would be wrong half
    /// the time, which is why there isn't one.
    public let lng: Double
    public let cost: Double
    /// Line 2: the practical detail.
    public let note: String
    /// Line 1: why this stop suits this traveler. Absent on itineraries saved before the field
    /// existed.
    public let why: String?
    /// Free-form clock — "8:00 AM" or "14:00". Deliberately not a `Date`: it is a local wall-clock
    /// string the server never normalises, and parsing it here would invent a timezone.
    public let time: String
    public let durationLabel: String
    /// Deprecated server-side but always written as `[]`, so it is present-and-empty rather than
    /// absent. Optional anyway, since older rows predate it.
    public let tags: [String]?
    public let category: StopCategory
    /// **`var`, and it is the only mutable field on a stop.** A traveller records what they
    /// actually paid, and `Spend.of` prefers it over the estimate from that moment on. Everything
    /// else here is what the server said and is not ours to change.
    public var actualCost: Double?

    private enum CodingKeys: String, CodingKey {
        case name, lat, lng, cost, note, why, time, durationLabel, tags, category, actualCost
    }

    /// **The one hand-written initialiser on this tree, and it is here because a searched place
    /// has to become a stop.** `DayPlan`'s note explains why the others were left out: a custom
    /// `init(from:)` suppresses the memberwise one, and a hand-written replacement can drift from
    /// the decoder. That risk is real and is covered — a test round-trips a stop built here
    /// through `encode`/`decode` and compares, so a field added to one side and not the other
    /// fails rather than silently dropping off the wire.
    ///
    /// The defaults are `newStop`'s (`itineraryEdits.ts:35`): no cost, no note and no duration,
    /// because a search result knows none of the three and inventing them puts claims in the plan
    /// that nobody made.
    public init(
        name: String,
        lat: Double,
        lng: Double,
        cost: Double = 0,
        note: String = "",
        why: String? = nil,
        time: String = "",
        durationLabel: String = "",
        tags: [String]? = nil,
        category: StopCategory = .other,
        actualCost: Double? = nil
    ) {
        self.name = name
        self.lat = lat
        self.lng = lng
        self.cost = cost
        self.note = note
        self.why = why
        self.time = time
        self.durationLabel = durationLabel
        self.tags = tags
        self.category = category
        self.actualCost = actualCost
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decode(String.self, forKey: .name)
        lat = try c.decode(Double.self, forKey: .lat)
        lng = try c.decode(Double.self, forKey: .lng)
        cost = try c.decodeLenientDouble(forKey: .cost)
        note = try c.decode(String.self, forKey: .note)
        why = try c.decodeIfPresent(String.self, forKey: .why)
        time = try c.decode(String.self, forKey: .time)
        durationLabel = try c.decode(String.self, forKey: .durationLabel)
        tags = try c.decodeIfPresent([String].self, forKey: .tags)
        category = try c.decode(StopCategory.self, forKey: .category)
        actualCost = try c.decodeLenientDoubleIfPresent(forKey: .actualCost)
    }
}

public struct Lodging: Codable, Sendable, Equatable {
    public let name: String
    public let cost: Double
    public let note: String
    /// `var` for the same reason as `Stop.actualCost`.
    public var actualCost: Double?

    private enum CodingKeys: String, CodingKey { case name, cost, note, actualCost }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decode(String.self, forKey: .name)
        cost = try c.decodeLenientDouble(forKey: .cost)
        note = try c.decode(String.self, forKey: .note)
        actualCost = try c.decodeLenientDoubleIfPresent(forKey: .actualCost)
    }
}

public struct DayPlan: Codable, Sendable, Equatable {
    /// ISO date, date-only. **Never format this with a local-timezone formatter** — the web app
    /// has already shipped an off-by-one-day bug from exactly that, since `2026-09-19` parses as
    /// UTC midnight and rolls back a day anywhere west of Greenwich.
    public let date: String
    public let weather: String
    public let weatherDetail: DayWeather?
    public let summary: String?
    /// User-authored, never model-written.
    public let title: String?
    /// Both `var` so an actual cost can be written in place. A `let` here would mean giving
    /// these models a memberwise initialiser, which the custom `init(from:)` suppresses — five
    /// keywords against two hand-written initialisers that could drift from the decoder.
    public var lodging: Lodging?
    public var stops: [Stop]
}

/// Server-attached forecast, not model-authored. Every field below `historical` is *explicitly
/// null* rather than absent when unknown.
public struct DayWeather: Codable, Sendable, Equatable {
    public let date: String
    public let tempMaxC: Double
    public let tempMinC: Double
    public let historical: Bool
    public let precipitationProbability: Double?
    public let humidity: Double?
    public let weatherCode: Int?
    public let sunrise: String?
    public let sunset: String?
}

public struct Itinerary: Codable, Sendable, Equatable {
    /// **Optional, and this is contract rule 2.** `toTripDetail` spreads `JSON.parse(itinerary_json)`
    /// with no shape check, so a row written before `tier` existed has none and nothing adds one.
    public let tier: TierId?
    public var days: [DayPlan]
}

public extension Trip {
    /// The summary shape `/api/trip-edit` wants, from the trip already open.
    ///
    /// Here rather than at the call site because `TripSummary`'s memberwise initialiser is
    /// internal, so the app target cannot build one.
    var summary: TripSummary {
        TripSummary(
            id: id, destination: destination, startDate: startDate,
            endDate: endDate, budget: budget, status: status
        )
    }
}

public struct TripSummary: Codable, Sendable, Equatable {
    public let id: String
    public let destination: String
    public let startDate: String
    public let endDate: String
    public let budget: Double
    /// Optional in the type, always emitted by `toTripSummary`, and backfilled non-null in the
    /// column. Treat absence as `.saved`, matching every server-side reader.
    public let status: TripStatus?

    public var resolvedStatus: TripStatus { status ?? .saved }
}

/// The `GET /api/trips/:id` body.
public struct Trip: Codable, Sendable, Equatable {
    public let id: String
    public let destination: String
    public let startDate: String
    public let endDate: String
    public let budget: Double
    /// **`var`, for the same reason `itinerary` is.** Keeping a trip is written locally
    /// and then sent, so the banner goes the moment you press it rather than after a
    /// round trip; a failure puts it back.
    public var status: TripStatus?
    /// `var` so an actual cost can be written without rebuilding the trip. The synthesized
    /// memberwise initialiser is internal, so the alternative is a public one that could drift
    /// from the decoder.
    public var itinerary: Itinerary
    /// Explicitly `null` for trips saved before answers were stored.
    public let userAnswers: UserAnswers?
    /// Explicitly `null` when the row tracks no session.
    public let chatSessionId: String?

    public var resolvedStatus: TripStatus { status ?? .saved }
}

// `UserAnswers`, `TripLogistics`, `DietaryNeeds` and the rest of the answer tree live in
// `UserAnswers.swift` — they are the wizard's *write* shape as well as this read field's type, and
// one JSON object should not be two Swift types.
//
// This read used to model only three fields, on the reasoning that modelling twenty we never
// display would be twenty more chances to decode-fail. The wizard needs all twenty to *send*, and
// the reasoning survives the merge intact: every added field is optional, so a trip saved before
// any of them existed decodes exactly as it did.

// MARK: - The decoder

public extension JSONDecoder {
    /// The one decoder this client uses.
    ///
    /// No key-decoding strategy: the API is already camelCase end to end (`src/lib/tripPayload.ts`
    /// owns that boundary server-side), so converting would break every key. No date strategy
    /// either — every date on this wire is a date-only string and is kept as one, for the UTC
    /// reason noted on `DayPlan.date`.
    static var tripMate: JSONDecoder { JSONDecoder() }
}

/// An airport or station a traveler could arrive at, from `GET /api/arrival-points`.
///
/// Feeds the optional "arriving at" field, which stays **free text** — `TripLogistics` records
/// why: the point is a fact for the prompt, and geocoding it would add a fetch that can fail for
/// no planning gain. So these are suggestions, never a closed set.
public struct ArrivalPoint: Codable, Sendable, Equatable, Identifiable {
    public enum Kind: String, Codable, Sendable {
        case airport, rail
    }

    /// Display name, with the IATA code already appended for airports: "Kansai Intl (KIX)".
    public let name: String
    public let kind: Kind
    public let distanceKm: Double
    /// **Do not sort on this.** `arrivalPoints.ts` documents it as "0 for an international
    /// airport, 1 for anything else", and the wire disagrees: Kyoto returns `tier: 2` for all
    /// three airports and `tier: 0` for every rail station. Observed 2026-09-19 against the
    /// live route, not inferred.
    ///
    /// What the response *is* ordered by is kind then distance — airports ascending, then rail
    /// ascending — so the wire order is the one to render in.
    public let tier: Int
    /// The bare code, separate from `name`, because a flight search needs "KIX" rather than the
    /// display string it is embedded in. `null` for rail.
    public let iata: String?

    public var id: String { name }
}

/// `GET /api/place-photo`. **All three fields null is a real answer**, not a failure: the route
/// returns it with a 200 so the client caches "this place has no photograph" rather than asking
/// again. A failed *lookup* is a 503 and never reaches this type.
public struct PlacePhoto: Codable, Sendable, Equatable {
    /// The small one, for avatars and list rows.
    public let thumbnailUrl: String?
    /// The large one, for header backgrounds.
    public let imageUrl: String?
    /// Wikipedia's one-paragraph description, which arrives in the same response — so asking
    /// for it beside a photo costs nothing extra.
    public let extract: String?

    /// True when the lookup succeeded and the place simply has no picture.
    public var isEmpty: Bool { thumbnailUrl == nil && imageUrl == nil }
}
