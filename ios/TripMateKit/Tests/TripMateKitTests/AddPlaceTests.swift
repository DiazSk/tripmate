import Foundation
import XCTest
@testable import TripMateKit

/// `Itinerary.addingPlace` and `StopCategory(searchCategory:)`.
///
/// **These two have no tests on the web at all**, because they live in a `"use client"` `.tsx`
/// the `.test.mjs` runner cannot load — `activeItinerary.tsx:147` and `:182`. In the kit they are
/// ordinary functions, so the port ends up better covered than the original. Written first for
/// that reason.
final class AddPlaceTests: XCTestCase {

    private func itinerary(_ days: [[(name: String, time: String)]]) throws -> Itinerary {
        let json = days.map { stops in
            let s = stops.map {
                """
                {"name":"\($0.name)","lat":41.1,"lng":-8.6,"cost":10,"note":"",
                "time":"\($0.time)","durationLabel":"1 hour","category":"food"}
                """
            }.joined(separator: ",")
            return #"{"date":"2026-09-14","weather":"Clear","stops":[\#(s)]}"#
        }.joined(separator: ",")
        return try JSONDecoder.tripMate.decode(
            Itinerary.self, from: Data(#"{"tier":"midrange","days":[\#(json)]}"#.utf8)
        )
    }

    private let porto = GeoPoint(lat: 41.15, lng: -8.61)

    // MARK: stopCategoryFor

    func testSearchCategoriesMapToTheFourAStopHas() {
        XCTAssertEqual(StopCategory(searchCategory: "cafe"), .food)
        XCTAssertEqual(StopCategory(searchCategory: "restaurant"), .food)
        XCTAssertEqual(StopCategory(searchCategory: "bar"), .food)
        XCTAssertEqual(StopCategory(searchCategory: "sights"), .entry)
    }

    /// The `place` bucket is the biggest one on the wire and has no money of its own.
    func testEverythingElseIsOther() {
        for unknown in ["park", "shop", "hotel", "place", "", "food", nil] {
            XCTAssertEqual(StopCategory(searchCategory: unknown), .other, "for \(unknown ?? "nil")")
        }
    }

    /// **Never `transit`.** Nothing you search for is a journey, and a transit tile appearing
    /// because somebody added a café would misreport the day's spend.
    func testNoSearchCategoryEverProducesTransit() {
        for raw in ["cafe", "restaurant", "bar", "sights", "transit", "tram", "station", nil] {
            XCTAssertNotEqual(StopCategory(searchCategory: raw), .transit, "for \(raw ?? "nil")")
        }
    }

    // MARK: addPlaceToDay

    func testAPlaceLandsAtTheSlotsIndexWithItsTime() throws {
        let plan = try itinerary([[("Breakfast", "9:00 AM"), ("Dinner", "8:00 PM")]])
        let after = plan.addingPlace("Majestic", at: porto, category: "cafe", toDay: 0, slot: .afternoon)
        let stops = after.days[0].stops
        XCTAssertEqual(stops.map(\.name), ["Breakfast", "Majestic", "Dinner"])
        XCTAssertEqual(stops[1].time, "2:30 PM")
        XCTAssertEqual(stops[1].category, .food)
    }

    /// **The rule the whole feature rests on.** Nothing already in the plan moves or is re-timed.
    func testNothingAlreadyInTheDayMovesOrIsRetimed() throws {
        let plan = try itinerary([[("Breakfast", "9:00 AM"), ("Dinner", "8:00 PM")]])
        let before = plan.days[0].stops
        let after = plan.addingPlace("Majestic", at: porto, category: "cafe", toDay: 0, slot: .afternoon)
        XCTAssertEqual(after.days[0].stops.filter { $0.name != "Majestic" }, before)
    }

    /// No cost and no duration it has not earned — a search result knows neither.
    func testTheNewStopClaimsNoCostAndNoDuration() throws {
        let plan = try itinerary([[]])
        let stop = try XCTUnwrap(
            plan.addingPlace("Majestic", at: porto, category: "cafe", toDay: 0, slot: .morning)
                .days[0].stops.first
        )
        XCTAssertEqual(stop.cost, 0)
        XCTAssertEqual(stop.durationLabel, "")
        XCTAssertEqual(stop.note, "")
        XCTAssertNil(stop.actualCost)
        XCTAssertNil(stop.why)
        XCTAssertEqual(stop.lat, porto.lat)
        XCTAssertEqual(stop.lng, porto.lng)
    }

    /// No slot means nobody was asked, so it appends with no time rather than guessing one.
    func testNoSlotAppendsWithNoTime() throws {
        let plan = try itinerary([[("Breakfast", "9:00 AM")]])
        let after = plan.addingPlace("Majestic", at: porto, category: "cafe", toDay: 0, slot: nil)
        XCTAssertEqual(after.days[0].stops.map(\.name), ["Breakfast", "Majestic"])
        XCTAssertEqual(after.days[0].stops[1].time, "")
    }

    func testOnlyTheNamedDayChanges() throws {
        let plan = try itinerary([[("A", "9:00 AM")], [("B", "9:00 AM")], [("C", "9:00 AM")]])
        let after = plan.addingPlace("Majestic", at: porto, category: nil, toDay: 1, slot: .morning)
        XCTAssertEqual(after.days[0], plan.days[0])
        XCTAssertEqual(after.days[2], plan.days[2])
        XCTAssertEqual(after.days[1].stops.count, 2)
    }

    /// The picker lists a day count that can be reloaded underneath it; a stale tap must not trap.
    func testAnOutOfRangeDayChangesNothing() throws {
        let plan = try itinerary([[("A", "9:00 AM")]])
        XCTAssertEqual(plan.addingPlace("X", at: porto, category: nil, toDay: 7, slot: .morning), plan)
        XCTAssertEqual(plan.addingPlace("X", at: porto, category: nil, toDay: -1, slot: .morning), plan)
    }

    /// **The hand-written `Stop.init` must not drift from the decoder.** `DayPlan`'s docstring
    /// names that risk as the reason the other models have no initialiser at all; this is what
    /// makes it safe to have one here. A field added to the struct and forgotten in `CodingKeys`,
    /// or defaulted differently from what the wire round-trips, fails here.
    func testAStopBuiltInCodeSurvivesTheWire() throws {
        let built = Stop(
            name: "Majestic", lat: 41.15, lng: -8.61, cost: 12, note: "n", why: "w",
            time: "2:30 PM", durationLabel: "1 hour", tags: ["t"], category: .food, actualCost: 14
        )
        let data = try JSONEncoder().encode(built)
        XCTAssertEqual(try JSONDecoder.tripMate.decode(Stop.self, from: data), built)
    }

    /// The defaults are the ones that reach the server for a searched place, so they are the ones
    /// worth pinning through a round trip too.
    func testADefaultedStopSurvivesTheWire() throws {
        let built = Stop(name: "Majestic", lat: 41.15, lng: -8.61)
        let data = try JSONEncoder().encode(built)
        XCTAssertEqual(try JSONDecoder.tripMate.decode(Stop.self, from: data), built)
    }
}
