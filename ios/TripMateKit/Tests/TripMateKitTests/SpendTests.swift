import XCTest
@testable import TripMateKit

/// The budget arithmetic, which is in the package precisely so these can exist.
///
/// Fixtures are built by decoding JSON rather than by a memberwise initialiser — the models have
/// none, since a custom `init(from:)` suppresses it. That is not a workaround: it means every
/// fixture here goes through the same decode path the network does, so a test that passes has
/// also proved the shape it asserts on is a shape the server could actually send.
final class SpendTests: XCTestCase {

    // MARK: - Fixture builders

    /// `(cost, category, actualCost)`
    private typealias StopSpec = (Double, String, Double?)

    private func makeDay(_ stops: [StopSpec], lodging: (Double, Double?)? = nil) throws -> DayPlan {
        let stopJSON = stops.map { cost, category, actual in
            let actualPart = actual.map { ",\"actualCost\":\($0)" } ?? ""
            return """
            {"name":"s","lat":0,"lng":0,"cost":\(cost),"note":"n","time":"9:00 AM",
             "durationLabel":"1h","category":"\(category)"\(actualPart)}
            """
        }.joined(separator: ",")

        let lodgingPart = lodging.map { cost, actual in
            let actualPart = actual.map { ",\"actualCost\":\($0)" } ?? ""
            return ",\"lodging\":{\"name\":\"h\",\"cost\":\(cost),\"note\":\"n\"\(actualPart)}"
        } ?? ""

        let json = """
        {"date":"2026-09-19","weather":"sunny","stops":[\(stopJSON)]\(lodgingPart)}
        """
        return try JSONDecoder.tripMate.decode(DayPlan.self, from: Data(json.utf8))
    }

    // MARK: - Per-category

    func testSumsEachCategorySeparately() throws {
        let day = try makeDay([
            (10, "food", nil), (5, "food", nil),
            (20, "entry", nil),
            (3, "transit", nil),
            (7, "other", nil),
        ], lodging: (90, nil))

        let spend = Spend.byCategory(day)
        XCTAssertEqual(spend.food, 15)
        XCTAssertEqual(spend.entry, 20)
        XCTAssertEqual(spend.transit, 3)
        XCTAssertEqual(spend.other, 7)
        XCTAssertEqual(spend.stay, 90)
        XCTAssertEqual(spend.total, 135)
    }

    /// An entered actual replaces the estimate — for stops and for lodging alike.
    func testActualCostOverridesEstimate() throws {
        let day = try makeDay([(10, "food", 25)], lodging: (90, 120))
        let spend = Spend.byCategory(day)
        XCTAssertEqual(spend.food, 25)
        XCTAssertEqual(spend.stay, 120)
        XCTAssertEqual(spend.total, 145)
    }

    /// An unknown category decodes to `.other` (contract rule 4) and must therefore land in the
    /// `other` bucket rather than being dropped from the total.
    func testUnknownCategoryCountsAsOther() throws {
        let day = try makeDay([(12, "nightlife", nil)])
        let spend = Spend.byCategory(day)
        XCTAssertEqual(spend.other, 12)
        XCTAssertEqual(spend.total, 12)
    }

    /// `day` must delegate to `byCategory().total`, never reduce again. If these two can disagree,
    /// the breakdown's Total tile and the budget bar will eventually show different numbers —
    /// which is the exact defect this module's layout exists to prevent.
    func testDayDelegatesToTheBreakdownTotal() throws {
        let day = try makeDay([(10, "food", nil), (20, "entry", 30)], lodging: (50, nil))
        XCTAssertEqual(Spend.day(day), Spend.byCategory(day).total)
    }

    func testTripSumsItsDays() throws {
        let days = [
            try makeDay([(10, "food", nil)]),
            try makeDay([(20, "entry", nil)], lodging: (5, nil)),
        ]
        XCTAssertEqual(Spend.trip(days), 35)
    }

    /// `planned` is the baseline an overspend is measured against, so it is the one summation that
    /// deliberately ignores actuals.
    func testPlannedIgnoresActuals() throws {
        let day = try makeDay([(10, "food", 999)], lodging: (90, 999))
        XCTAssertEqual(Spend.planned(day), 100)
        XCTAssertEqual(Spend.day(day), 1998, "spend should follow the actuals that planned ignores")
    }

    // MARK: - Budget segments

    func testSegmentsSplitTheTrackByDay() throws {
        let days = [
            try makeDay([(250, "food", nil)]),   // 25%
            try makeDay([(500, "entry", nil)]),  // 50%
        ]
        let segments = Spend.budgetSegments(days, budget: 1000)
        XCTAssertEqual(segments.count, 2)
        XCTAssertEqual(segments[0].width, 25)
        XCTAssertEqual(segments[0].left, 0)
        XCTAssertEqual(segments[1].width, 50)
        XCTAssertEqual(segments[1].left, 25)
    }

    /// Over budget, the crossing day is drawn partial and the days after it get nothing. The spans
    /// sum to exactly 100 with no rounding slack, which is what makes "the budget ran out on day
    /// three" readable off the bar.
    func testOverBudgetTruncatesAndDropsLaterDays() throws {
        let days = [
            try makeDay([(600, "food", nil)]),   // 60%
            try makeDay([(600, "food", nil)]),   // would be 60%, clipped to 40%
            try makeDay([(600, "food", nil)]),   // nothing left
        ]
        let segments = Spend.budgetSegments(days, budget: 1000)
        XCTAssertEqual(segments.count, 2)
        XCTAssertEqual(segments[0].width, 60)
        XCTAssertEqual(segments[1].width, 40)
        XCTAssertEqual(segments.reduce(0) { $0 + $1.width }, 100)
        // The clipped span still reports its true spend; only the drawing was truncated.
        XCTAssertEqual(segments[1].spend, 600)
    }

    /// A zero-width span still draws its separator — a hairline marking nothing — so zero-spend
    /// days are dropped entirely rather than emitted at zero.
    func testZeroSpendDaysAreDropped() throws {
        let days = [
            try makeDay([(100, "food", nil)]),
            try makeDay([]),
            try makeDay([(100, "food", nil)]),
        ]
        let segments = Spend.budgetSegments(days, budget: 1000)
        XCTAssertEqual(segments.map(\.dayIndex), [0, 2], "the empty day must not claim a span")
        XCTAssertEqual(segments[1].left, 10, "offsets must stay honest across the gap")
    }

    func testNoBudgetMeansNoSegments() throws {
        let days = [try makeDay([(100, "food", nil)])]
        XCTAssertTrue(Spend.budgetSegments(days, budget: 0).isEmpty)
        XCTAssertTrue(Spend.budgetSegments(days, budget: -50).isEmpty)
    }

    /// A negative cost off the model would otherwise *give back* room to the days after it.
    func testNegativeDaySpendIsClampedNotRefunded() throws {
        let days = [
            try makeDay([(-500, "food", nil)]),
            try makeDay([(250, "food", nil)]),
        ]
        let segments = Spend.budgetSegments(days, budget: 1000)
        XCTAssertEqual(segments.map(\.dayIndex), [1])
        XCTAssertEqual(segments[0].left, 0, "the negative day must not shift the next one")
        XCTAssertEqual(segments[0].width, 25)
    }

    // MARK: - The breakdown tiles

    /// **The shipped bug this filter exists to prevent.** A day of sightseeing printed
    /// `Food $0 · Entry $0 · Transit $0 · Stay $0` beside a Total nothing on screen accounted
    /// for, because `other` was summed into the total and never given a tile of its own.
    func testACategoryWithNothingInItGetsNoTile() throws {
        let day = try makeDay([(40, "entry", nil)])
        let tiles = Spend.tiles(Spend.byCategory(day))
        XCTAssertEqual(tiles.map(\.label), ["Entry"], "only the category with money in it")
    }

    /// The other half of that bug: `other` must be able to produce a tile, or a total can
    /// exceed the tiles that are supposed to add up to it.
    func testOtherIsATileLikeAnyOther() throws {
        let day = try makeDay([(25, "other", nil)])
        XCTAssertEqual(Spend.tiles(Spend.byCategory(day)).map(\.label), ["Other"])
    }

    /// The row and the figure beneath it must agree — that is the whole contract of the band.
    func testTheTilesAlwaysSumToTheTotalBeneathThem() throws {
        let day = try makeDay(
            [(30, "food", nil), (12, "entry", nil), (8, "transit", 15), (5, "other", nil)],
            lodging: (120, nil)
        )
        let spend = Spend.byCategory(day)
        let tiles = Spend.tiles(spend)
        XCTAssertEqual(tiles.map(\.amount).reduce(0, +), spend.total, accuracy: 0.001)
        XCTAssertEqual(tiles.count, 5, "every category earned a tile here")
    }

    /// A day that cost nothing draws no row at all, rather than five zeroes.
    func testAFreeDayHasNoTiles() throws {
        let day = try makeDay([(0, "food", nil)])
        XCTAssertTrue(Spend.tiles(Spend.byCategory(day)).isEmpty)
    }

    /// An actual cost replaces the estimate in the tile, not just in the total.
    func testATileShowsWhatWasActuallyPaid() throws {
        let day = try makeDay([(30, "food", 47)])
        XCTAssertEqual(Spend.tiles(Spend.byCategory(day)).first?.amount, 47)
    }

    /// Order is fixed so the row does not reshuffle between days.
    func testTileOrderIsStable() throws {
        let day = try makeDay(
            [(1, "other", nil), (1, "transit", nil), (1, "food", nil), (1, "entry", nil)],
            lodging: (1, nil)
        )
        XCTAssertEqual(
            Spend.tiles(Spend.byCategory(day)).map(\.label),
            ["Food", "Entry", "Transit", "Other", "Stay"]
        )
    }


    // MARK: - Writing an actual cost

    private func makeItinerary() throws -> Itinerary {
        let day = try makeDay([(30, "food", nil), (12, "entry", nil)], lodging: (120, nil))
        let json = """
        {"tier":"midrange","days":[\(String(data: try JSONEncoder().encode(day), encoding: .utf8)!)]}
        """
        return try JSONDecoder().decode(Itinerary.self, from: Data(json.utf8))
    }

    func testWritingAStopsActualCostChangesWhatItSpends() throws {
        let after = try makeItinerary().settingActualCost(day: 0, stop: 0, to: 47)
        XCTAssertEqual(Spend.byCategory(after.days[0]).food, 47)
        XCTAssertEqual(after.days[0].stops[1].actualCost, nil, "only the addressed stop moves")
    }

    /// `stop: nil` is the lodging — the same gesture to a traveller, a different field on the day.
    func testWritingWithNoStopIndexAddressesTheLodging() throws {
        let after = try makeItinerary().settingActualCost(day: 0, stop: nil, to: 155)
        XCTAssertEqual(after.days[0].lodging?.actualCost, 155)
        XCTAssertEqual(Spend.byCategory(after.days[0]).stay, 155)
    }

    /// **An emptied field clears back to the estimate.** `nil` and `0` are different statements:
    /// "I never recorded this" against "this turned out to be free".
    func testClearingRestoresTheEstimateAndZeroDoesNot() throws {
        let set = try makeItinerary().settingActualCost(day: 0, stop: 0, to: 47)
        XCTAssertEqual(Spend.byCategory(set.settingActualCost(day: 0, stop: 0, to: nil).days[0]).food, 30)
        XCTAssertEqual(Spend.byCategory(set.settingActualCost(day: 0, stop: 0, to: 0).days[0]).food, 0)
    }

    /// A stale index can outlive the day it addressed. Losing the edit beats trapping on a screen
    /// somebody is typing into.
    func testAnOutOfRangeIndexIsIgnoredRatherThanTrapping() throws {
        let before = try makeItinerary()
        XCTAssertEqual(before.settingActualCost(day: 9, stop: 0, to: 5), before)
        XCTAssertEqual(before.settingActualCost(day: 0, stop: 9, to: 5), before)
    }

    /// The trip total is the sum of the days, so an actual cost has to reach it.
    func testAnActualCostReachesTheTripTotal() throws {
        let before = try makeItinerary()
        let after = before.settingActualCost(day: 0, stop: 0, to: 130)
        XCTAssertEqual(Spend.trip(after.days) - Spend.trip(before.days), 100, accuracy: 0.001)
    }

}
