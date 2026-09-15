import XCTest
@testable import TripMateKit

/// One test per decoder rule in `docs/api-contract-v1.md`. Each rule exists because a real handler
/// behaves this way, so each test is really asserting "we still tolerate what the server does."
final class TripWireModelTests: XCTestCase {

    private let decoder = JSONDecoder.tripMate

    /// Rule 1. `toTripDetail` spreads unvalidated stored JSON, so unknown keys always arrive and
    /// must never fail. Swift's synthesized decoding gives this for free — the test pins it so a
    /// future switch to a strict decoder breaks here instead of in production.
    func testUnknownKeysAreIgnored() throws {
        let json = #"""
        {"tier":"midrange","days":[],"someKeyFromAPastWriter":{"nested":true},"legacyFlag":1}
        """#
        let itinerary = try decoder.decode(Itinerary.self, from: Data(json.utf8))
        XCTAssertEqual(itinerary.tier, .midrange)
        XCTAssertTrue(itinerary.days.isEmpty)
    }

    /// Rule 2. A row written before `tier` existed has none, and nothing backfills it.
    func testItineraryTierIsOptional() throws {
        let itinerary = try decoder.decode(Itinerary.self, from: Data(#"{"days":[]}"#.utf8))
        XCTAssertNil(itinerary.tier)
    }

    /// Rule 4, half one. `normalizeCategory()` guards the read path only, so a streamed frame can
    /// carry anything. Unknown must land on `.other`, not throw.
    func testUnknownStopCategoryFallsBackToOther() throws {
        let stop = try decoder.decode(Stop.self, from: Data(Self.stopJSON(category: "nightlife").utf8))
        XCTAssertEqual(stop.category, .other)
    }

    func testKnownStopCategoriesStillDecodeExactly() throws {
        for expected in StopCategory.allCases {
            let stop = try decoder.decode(
                Stop.self, from: Data(Self.stopJSON(category: expected.rawValue).utf8)
            )
            XCTAssertEqual(stop.category, expected)
        }
    }

    /// Rule 4, half two. `normalizeDays` coerces `cost` through `money()` on reads but never on
    /// SSE `stop` frames, so the same stop is a number one way and a string the other.
    func testCostDecodesFromAJSONString() throws {
        let stop = try decoder.decode(Stop.self, from: Data(Self.stopJSON(cost: "\"42.5\"").utf8))
        XCTAssertEqual(stop.cost, 42.5)
    }

    func testCostStillDecodesFromANumber() throws {
        let stop = try decoder.decode(Stop.self, from: Data(Self.stopJSON(cost: "42.5").utf8))
        XCTAssertEqual(stop.cost, 42.5)
    }

    /// A genuinely undecodable cost is a real contract violation and should be loud.
    func testNonNumericCostStringThrows() {
        XCTAssertThrowsError(
            try decoder.decode(Stop.self, from: Data(Self.stopJSON(cost: "\"free\"").utf8))
        )
    }

    /// `why` postdates some saved itineraries; `tags` is deprecated but always written as `[]`.
    func testOptionalStopFieldsMayBeAbsent() throws {
        let json = #"""
        {"name":"Alfama","lat":38.7,"lng":-9.1,"cost":0,"note":"walkable",
         "time":"9:00 AM","durationLabel":"1h","category":"entry"}
        """#
        let stop = try decoder.decode(Stop.self, from: Data(json.utf8))
        XCTAssertNil(stop.why)
        XCTAssertNil(stop.tags)
        XCTAssertNil(stop.actualCost)
    }

    /// Absent `status` means `.saved`, matching the column's own backfill.
    func testAbsentStatusResolvesToSaved() throws {
        let json = #"""
        {"id":"t1","destination":"Lisbon","startDate":"2026-09-19","endDate":"2026-09-22",
         "budget":1200}
        """#
        let summary = try decoder.decode(TripSummary.self, from: Data(json.utf8))
        XCTAssertNil(summary.status)
        XCTAssertEqual(summary.resolvedStatus, .saved)
    }

    /// The `lon` / `lng` split, asserted on both sides so a future shared coordinate type fails
    /// loudly rather than silently reading zero.
    func testStopUsesLngWhileDayCoordsUsesLon() throws {
        let stop = try decoder.decode(Stop.self, from: Data(Self.stopJSON().utf8))
        XCTAssertEqual(stop.lng, -9.1)

        let coords = #"{"dayIndex":0,"coords":{"Belém":{"lat":38.69,"lon":-9.21}}}"#
        let event = try decoder.decode(DayCoordsEvent.self, from: Data(coords.utf8))
        XCTAssertEqual(event.coords["Belém"]?.lon, -9.21)
    }

    /// A whole trip, with the shapes that actually cause trouble: a nested day, an explicit null
    /// for `userAnswers`, and a junk key at the itinerary level.
    func testFullTripDecodes() throws {
        let json = #"""
        {"id":"t1","destination":"Lisbon","startDate":"2026-09-19","endDate":"2026-09-20",
         "budget":1200,"status":"saved","chatSessionId":null,"userAnswers":null,
         "itinerary":{"tier":"budget","strayKey":true,"days":[
           {"date":"2026-09-19","weather":"sunny","stops":[
             {"name":"Alfama","lat":38.7,"lng":-9.1,"cost":"12","note":"n","time":"9:00 AM",
              "durationLabel":"1h","category":"entry","tags":[]}
           ],"lodging":{"name":"Hotel","cost":90,"note":"central"}}
         ]}}
        """#
        let trip = try decoder.decode(Trip.self, from: Data(json.utf8))
        XCTAssertEqual(trip.resolvedStatus, .saved)
        XCTAssertNil(trip.userAnswers)
        XCTAssertNil(trip.chatSessionId)
        XCTAssertEqual(trip.itinerary.days.count, 1)
        XCTAssertEqual(trip.itinerary.days[0].stops[0].cost, 12)
        XCTAssertEqual(trip.itinerary.days[0].lodging?.cost, 90)
        XCTAssertNil(trip.itinerary.days[0].summary)
    }

    // MARK: - Fixture

    private static func stopJSON(category: String = "entry", cost: String = "10") -> String {
        #"""
        {"name":"Alfama","lat":38.7,"lng":-9.1,"cost":\#(cost),"note":"walkable","why":"quiet",
         "time":"9:00 AM","durationLabel":"1h","tags":[],"category":"\#(category)"}
        """#
    }
}
