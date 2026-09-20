import Foundation
import XCTest
@testable import TripMateKit

/// `DayDisplay.formatRange` — one month named once, and the one case that must not collapse.
final class FormatRangeTests: XCTestCase {
    func testSameMonthAndYearCollapses() {
        XCTAssertEqual(
            DayDisplay.formatRange("2026-09-12", "2026-09-20", currentYear: 2026),
            "Sep 12 – 20"
        )
    }

    /// **The guard this file exists for.** Same month number, a year apart. Collapsing prints
    /// "Sep 19 – 19", which says a trip lasted a day when it lasted a year.
    func testSameMonthDifferentYearDoesNotCollapse() {
        XCTAssertEqual(
            DayDisplay.formatRange("2026-09-19", "2027-09-19", currentYear: 2026),
            "Sep 19 – Sep 19, '27"
        )
    }

    func testCrossMonthNamesBoth() {
        XCTAssertEqual(
            DayDisplay.formatRange("2026-09-19", "2026-10-02", currentYear: 2026),
            "Sep 19 – Oct 2"
        )
    }

    /// The year goes on the end. "Sep 19, '27 – 23" reads as a typo.
    func testOffYearSuffixLandsOnTheEndDate() {
        XCTAssertEqual(
            DayDisplay.formatRange("2027-09-19", "2027-09-23", currentYear: 2026),
            "Sep 19 – 23, '27"
        )
    }

    /// Falls through rather than inventing a date — the raw strings are what the list shows
    /// today, so the worst case is no worse than before.
    func testUnparseableSideFallsThrough() {
        XCTAssertEqual(DayDisplay.formatRange("not-a-date", "2026-09-20"), "not-a-date – 2026-09-20")
        XCTAssertEqual(DayDisplay.formatRange("2026-13-01", "2026-09-20"), "2026-13-01 – 2026-09-20")
    }
}
