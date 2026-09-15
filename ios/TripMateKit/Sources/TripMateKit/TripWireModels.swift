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
    public let actualCost: Double?

    private enum CodingKeys: String, CodingKey {
        case name, lat, lng, cost, note, why, time, durationLabel, tags, category, actualCost
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
    public let actualCost: Double?

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
    public let lodging: Lodging?
    public let stops: [Stop]
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
    public let days: [DayPlan]
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
    public let status: TripStatus?
    public let itinerary: Itinerary
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
