import Foundation
import XCTest
@testable import TripMateKit

/// `TripCopy`, `Spend.overspend`, `StopCategory.symbol` and `Overlap` — the four pure pieces
/// the redesigned trip screen leans on.
final class TripCopyTests: XCTestCase {

    private func day(
        date: String = "2026-09-14",
        stops: [(name: String, cost: Double, actual: Double?, time: String, duration: String)] = [],
        lodging: (cost: Double, actual: Double?)? = nil
    ) throws -> DayPlan {
        let stopJSON = stops.map { s in
            """
            {"name":"\(s.name)","lat":41.1,"lng":-8.6,"cost":\(s.cost),
            \(s.actual.map { "\"actualCost\":\($0)," } ?? "")
            "note":"","time":"\(s.time)","durationLabel":"\(s.duration)","category":"food"}
            """
        }.joined(separator: ",")
        let lodgingJSON = lodging.map {
            """
            ,"lodging":{"name":"Hotel","cost":\($0.cost),"note":""\
            \($0.actual.map { a in ",\"actualCost\":\(a)" } ?? "")}
            """
        } ?? ""
        let json = """
        {"date":"\(date)","weather":"Clear","stops":[\(stopJSON)]\(lodgingJSON)}
        """
        return try JSONDecoder.tripMate.decode(DayPlan.self, from: Data(json.utf8))
    }

    // MARK: Spend.overspend

    func testOverspendIsNilWhenOnPlan() throws {
        let d = try day(stops: [("Lunch", 20, nil, "1:00 PM", "1 hour")])
        XCTAssertNil(Spend.overspend(d))
    }

    /// **Exactly equal is not over.** A coral banner reading "ran $0 over" is a false alarm.
    func testOverspendIsNilAtExactlyEqual() throws {
        let d = try day(stops: [("Lunch", 20, 20, "1:00 PM", "1 hour")])
        XCTAssertNil(Spend.overspend(d))
    }

    func testOverspendCountsAnActualAbovePlan() throws {
        let d = try day(stops: [("Lunch", 20, 68, "1:00 PM", "1 hour")])
        XCTAssertEqual(Spend.overspend(d), 48)
    }

    /// Lodging is the largest line on most days; leaving it out would under-report.
    func testOverspendCountsLodgingActuals() throws {
        let d = try day(stops: [], lodging: (cost: 100, actual: 175))
        XCTAssertEqual(Spend.overspend(d), 75)
    }

    // MARK: the symbol, shared

    /// **The whole reason the glyph moved onto the enum.** A tile and a stop row must never
    /// show different marks for the same category.
    func testTilesUseTheCategorysOwnSymbol() throws {
        let d = try day(stops: [("Lunch", 20, nil, "1:00 PM", "1 hour")])
        let tiles = Spend.tiles(Spend.byCategory(d))
        let food = try XCTUnwrap(tiles.first { $0.label == "Food" })
        XCTAssertEqual(food.symbol, StopCategory.food.symbol)
    }

    func testEveryCategoryHasASymbol() {
        for category in StopCategory.allCases {
            XCTAssertFalse(category.symbol.isEmpty, "\(category) has no symbol")
        }
    }

    // MARK: copy that must not rely on colour

    func testOverspendCopyCarriesTheWordAndTheAmount() throws {
        let d = try day(stops: [("Lunch", 20, 68, "1:00 PM", "1 hour")])
        let line = try XCTUnwrap(TripCopy.overspend(d))
        XCTAssertTrue(line.contains("over"), line)
        XCTAssertTrue(line.contains("48"), line)
    }

    func testOverspendCopyIsNilWhenOnPlan() throws {
        XCTAssertNil(TripCopy.overspend(try day(stops: [("Lunch", 20, nil, "1:00 PM", "1 hour")])))
    }

    func testDraftNoticeNamesTheSweep() {
        XCTAssertTrue(TripCopy.draftNotice.contains("30 days"))
        XCTAssertTrue(TripCopy.draftNotice.lowercased().contains("draft"))
    }

    // MARK: the capsule line

    func testDayFactsFormatsTheDateAndPluralisesStops() throws {
        let d = try day(stops: [
            ("A", 1, nil, "9:00 AM", "1 hour"), ("B", 1, nil, "11:00 AM", "1 hour"),
        ])
        XCTAssertEqual(TripCopy.dayFacts(d, index: 2, currentYear: 2026), "Day 3 · Sep 14 · 2 stops")
    }

    func testDayFactsSaysOneStop() throws {
        let d = try day(stops: [("A", 1, nil, "9:00 AM", "1 hour")])
        XCTAssertTrue(TripCopy.dayFacts(d, index: 0, currentYear: 2026).hasSuffix("1 stop"))
    }

    /// The bug this screen has already shipped: a raw ISO date reaching a traveller.
    func testDayFactsNeverPrintsARawISODate() throws {
        let line = TripCopy.dayFacts(try day(), index: 0, currentYear: 2026)
        XCTAssertFalse(line.contains("2026-09-14"), line)
        XCTAssertTrue(line.contains("Sep 14"), line)
    }

    func testDayPosition() {
        XCTAssertEqual(TripCopy.dayPosition(2, of: 9), "Day 3 of 9")
    }

    // MARK: Overlap

    func testOverlapFindsAStopStartingBeforeThePreviousEnds() throws {
        let d = try day(stops: [
            ("Market", 0, nil, "10:00 AM", "2 hours"),
            ("Lunch", 0, nil, "11:30 AM", "1 hour"),
        ])
        let findings = Overlap.findings(in: d)
        XCTAssertEqual(findings.count, 1)
        XCTAssertEqual(findings.first?.minutes, 30)
        XCTAssertEqual(findings.first?.stopIndex, 1)
    }

    func testNoOverlapWhenTheyAbut() throws {
        let d = try day(stops: [
            ("Market", 0, nil, "10:00 AM", "1 hour"),
            ("Lunch", 0, nil, "11:00 AM", "1 hour"),
        ])
        XCTAssertTrue(Overlap.findings(in: d).isEmpty)
    }

    /// A missing duration is zero, not a default hour — inventing a length and then reporting
    /// the clash it causes is the error this check exists to avoid.
    func testMissingDurationDoesNotManufactureAnOverlap() throws {
        let d = try day(stops: [
            ("Market", 0, nil, "10:00 AM", ""),
            ("Lunch", 0, nil, "10:15 AM", "1 hour"),
        ])
        XCTAssertTrue(Overlap.findings(in: d).isEmpty)
    }

    func testUnparseableTimesBindNothing() throws {
        let d = try day(stops: [
            ("Whenever", 0, nil, "sometime", "2 hours"),
            ("Lunch", 0, nil, "10:00 AM", "1 hour"),
        ])
        XCTAssertTrue(Overlap.findings(in: d).isEmpty)
    }

    func testDurationParsing() {
        XCTAssertEqual(Overlap.duration("1.5 hours"), 90)
        XCTAssertEqual(Overlap.duration("45 min"), 45)
        XCTAssertEqual(Overlap.duration("2 hr 30 min"), 150)
        XCTAssertNil(Overlap.duration(""))
        XCTAssertNil(Overlap.duration("a while"))
        XCTAssertNil(Overlap.duration("0 min"), "zero is not a duration")
        XCTAssertNil(Overlap.duration("40 hours"), "over a day is refused, not believed")
    }
}
