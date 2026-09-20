import Foundation
import XCTest
@testable import TripMateKit

/// `DayFit`, ported case for case from `src/lib/dayFit.test.mjs`.
final class DayFitTests: XCTestCase {

    /// Rome, roughly. Every coordinate below is an offset from here so the distances are easy to
    /// reason about: at this latitude 0.01° of latitude is ~1.11km.
    private let base = GeoPoint(lat: 41.9, lng: 12.5)

    private func at(_ dLat: Double, _ dLng: Double = 0) -> GeoPoint {
        GeoPoint(lat: base.lat + dLat, lng: base.lng + dLng)
    }

    private func day(_ index: Int, _ stops: [GeoPoint]) -> DayFit.DayShape {
        DayFit.DayShape(day: index, stops: stops)
    }

    func testAnEmptyTripHasNothingToSuggest() {
        XCTAssertNil(DayFit.suggest(base, days: []))
    }

    func testDaysWithNoStopsAreRankedButNeverRecommended() {
        let days = [day(0, []), day(1, [])]
        let ranked = DayFit.rank(base, days: days)
        XCTAssertEqual(ranked.count, 2, "every day is still listed for the picker")
        XCTAssertTrue(ranked.allSatisfy { $0.score == .infinity })
        XCTAssertNil(DayFit.suggest(base, days: days), "geometry cannot justify an empty day")
    }

    func testADayWithStopsBeatsAnEmptyOneWhateverTheOrderIn() {
        let days = [day(0, []), day(1, [at(0.02), at(0.03)])]
        XCTAssertEqual(DayFit.suggest(base, days: days)?.day, 1)
        XCTAssertEqual(DayFit.rank(base, days: days).first?.day, 1, "finite scores sort ahead of infinity")
    }

    func testTheObviousCaseThePointSitsInsideOneDaysCluster() {
        let days = [
            day(0, [at(0.001), at(-0.001, 0.001)]),  // right on top of the point
            day(1, [at(0.4), at(0.41)]),             // ~45km north
        ]
        XCTAssertEqual(DayFit.suggest(base, days: days)?.day, 0)
    }

    /// **The normalisation, which is the whole reason this is not raw centroid distance.**
    /// Day 0 spans ~12km and its centroid lands 3.8km away; day 1 is a pocket ~1.1km across whose
    /// centroid is 1.0km away. Raw distance says day 1; normalised says day 0, because 1.0km is a
    /// long way for that pocket and 3.8km is well inside a day that already moves 12km.
    func testATightDayJudgesANearbyPointWorseThanASprawlingDayJudgesAFarOne() throws {
        let days = [
            day(0, [at(0.0), at(0.055), at(0.11)]),
            day(1, [at(-0.009, 0.001), at(-0.0095), at(-0.0085, -0.001)]),
        ]
        let ranked = DayFit.rank(base, days: days)
        XCTAssertGreaterThan(
            ranked[0].distanceM, ranked[1].distanceM,
            "the recommended day must be the geometrically *further* one, or this test proves nothing"
        )
        XCTAssertEqual(ranked[0].day, 0)
    }

    func testRawDistanceStillDecidesBetweenTwoDaysOfTheSameSpread() {
        let days = [
            day(0, [at(0.02), at(0.03), at(0.04)]),
            day(1, [at(0.2), at(0.21), at(0.22)]),
        ]
        XCTAssertEqual(DayFit.suggest(base, days: days)?.day, 0)
    }

    /// Four stops in a pocket plus a Fushimi-Inari-style outlier 12km out. **The mean radius** —
    /// not the max, which is why `Framing.boundingRadiusM` cannot stand in — keeps the day's
    /// tolerance near its real size, so a point 8km away on the other side is not a fit.
    func testOneOutlierDoesNotTurnACompactDayIntoOneThatWelcomesAnything() {
        let withOutlier = day(0, [at(0.0), at(0.002), at(0.004), at(0.001, 0.002), at(0.108)])
        let compact = day(1, [at(-0.07), at(-0.072), at(-0.074)])
        let point = at(-0.072, 0.001)  // sitting inside day 1
        XCTAssertEqual(DayFit.suggest(point, days: [withOutlier, compact])?.day, 1)
    }

    /// **The case above does not actually prove the mean**, and neither does the web's — day 1
    /// wins by such a margin that swapping `radius` to the max leaves it green. Mutating it to
    /// `max` survived, so this is the test that fails.
    ///
    /// Same outlier day: centroid 2.55 km up from base, mean radius 3.78 km, **max radius
    /// 9.45 km**. The point sits 10.58 km from that centroid, so it scores 2.80 under the mean
    /// and 1.12 under the max. Day 1 is a tight pocket 800 m from the point with the floored
    /// 400 m radius, so it scores exactly 2.0 — deliberately between the two. Under the mean the
    /// compact day wins, which is right; under the max the outlier day swallows it.
    func testTheMeanRadiusIsWhatStopsAnOutlierDayFromSwallowingACompactOne() {
        let withOutlier = day(0, [at(0.0), at(0.002), at(0.004), at(0.001, 0.002), at(0.108)])
        let pocket = day(1, [at(-0.0645), at(-0.0648), at(-0.0651)])
        let point = at(-0.072)
        XCTAssertEqual(DayFit.suggest(point, days: [withOutlier, pocket])?.day, 1)
    }

    func testASingleStopDayIsRecommendableRatherThanDividingByAZeroRadius() throws {
        let fit = try XCTUnwrap(
            DayFit.suggest(base, days: [day(0, [at(0.001)])]), "a one-stop day must still be able to win"
        )
        XCTAssertTrue(fit.score.isFinite, "expected a finite score, got \(fit.score)")
        XCTAssertEqual(fit.score, fit.distanceM / DayFit.minDayRadiusM, accuracy: 1e-9)
    }

    func testAPlaceInAnotherCityIsNotAFitForAnyDay() {
        let days = [day(0, [at(0.0), at(0.01)])]
        let faraway = GeoPoint(lat: base.lat + 6, lng: base.lng + 6)  // several hundred km
        XCTAssertGreaterThan(DayFit.rank(faraway, days: days)[0].distanceM, DayFit.maxFitDistanceM)
        XCTAssertNil(DayFit.suggest(faraway, days: days))
    }

    /// Swift's sort is not guaranteed stable, so the tiebreak is written rather than relied upon.
    func testTiesBreakOnTheEarlierDaySoTheSuggestionIsStable() {
        let mirror = [day(2, [at(0.01), at(-0.01)]), day(0, [at(0.01), at(-0.01)])]
        XCTAssertEqual(DayFit.suggest(base, days: mirror)?.day, 0)
    }

    func testEveryDayComesBackRankedSoThePickerCanLabelTheWholeList() {
        let days = [day(0, [at(0.3)]), day(1, []), day(2, [at(0.001)])]
        let ranked = DayFit.rank(base, days: days)
        XCTAssertEqual(ranked.map(\.day).sorted(), [0, 1, 2], "no day may be dropped — the list is the picker")
        XCTAssertEqual(ranked[0].day, 2)
    }
}
