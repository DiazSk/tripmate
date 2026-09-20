import Foundation
import XCTest
@testable import TripMateKit

/// `DaySlotting`, ported case for case from `src/lib/daySlotting.test.mjs`.
///
/// `parseDurationLabel`'s cases are not repeated here — `Overlap.duration` *is* that port and
/// `TripCopyTests` already covers it. Duplicating them would be two suites asserting one function.
final class DaySlottingTests: XCTestCase {

    private func stop(_ name: String, _ time: String, _ duration: String = "1 hour") -> Stop {
        Stop(name: name, lat: 0, lng: 0, time: time, durationLabel: duration)
    }

    /// The assigned time, read back through the same parser the plan's own list uses.
    private func at(_ plan: DaySlotting.SlotPlan) -> Int? {
        DaySchedule.minutes(fromClock: plan.time)
    }

    // MARK: formatClock

    func testClockFormattingMatchesThePlansOwnFormatIncludingBothEnds() {
        XCTAssertEqual(DaySlotting.formatClock(0), "12:00 AM")
        XCTAssertEqual(DaySlotting.formatClock(12 * 60), "12:00 PM")
        XCTAssertEqual(DaySlotting.formatClock(9 * 60 + 5), "9:05 AM")
        XCTAssertEqual(DaySlotting.formatClock(14 * 60 + 30), "2:30 PM")
        XCTAssertEqual(DaySlotting.formatClock(23 * 60 + 59), "11:59 PM")
    }

    // MARK: suggestTimeOfDay

    func testAPlaceIsSuggestedByWhatItIs() {
        XCTAssertEqual(DaySlotting.suggest(name: "Fábrica", category: "cafe"), .morning)
        XCTAssertEqual(DaySlotting.suggest(name: "A Ginjinha", category: "bar"), .evening)
        XCTAssertEqual(DaySlotting.suggest(name: "Taberna", category: "restaurant"), .evening)
        XCTAssertEqual(DaySlotting.suggest(name: "Gulbenkian", category: "museum"), .afternoon)
        XCTAssertEqual(DaySlotting.suggest(name: "Estrela", category: "park"), .afternoon)
        // The free-text bucket is the biggest and gets the band that is never closed.
        XCTAssertEqual(DaySlotting.suggest(name: "Miradouro", category: "place"), .afternoon)
        XCTAssertEqual(DaySlotting.suggest(name: "", category: nil), .afternoon)
    }

    func testTheNameOutranksTheCategoryBecauseACategoryIsACoarseBucket() {
        XCTAssertEqual(DaySlotting.suggest(name: "Brunch Club", category: "restaurant"), .morning)
        XCTAssertEqual(DaySlotting.suggest(name: "Time Out Night Market", category: "shop"), .evening)
        XCTAssertEqual(DaySlotting.suggest(name: "Rooftop Bar", category: "place"), .evening)
    }

    /// **Whole words only**, and the mutation target for this rule: a substring match would file
    /// "Sunset Diner" under Morning for containing "sun", and "Winery Lane Coffee" under Evening
    /// for containing "wine".
    func testNameHintsMatchWholeWordsOnly() {
        XCTAssertEqual(DaySlotting.suggest(name: "Sunset Diner", category: "cafe"), .evening)
        XCTAssertEqual(DaySlotting.suggest(name: "Winery Lane Coffee", category: "cafe"), .morning)
    }

    /// **The two cases above do not actually prove whole-word matching**, and neither do the
    /// web's — its own comment admits as much. Under substring matching "Sunset Diner" still
    /// reaches Evening and "Winery Lane Coffee" still reaches Morning, by a different route.
    /// Mutating the match to `contains` left both green.
    ///
    /// These discriminate: a hint word buried *inside* a longer word, where the surviving answer
    /// differs. Both names are real ones.
    func testAHintWordInsideALongerWordIsNotAHint() {
        // "night" inside "Nightingale". Word-matched it is not a hint, so the café's own category
        // answers; substring-matched the name would file a tea room as an evening venue.
        XCTAssertEqual(DaySlotting.suggest(name: "Nightingale Tea Room", category: "cafe"), .morning)
        // "espresso" inside "Espressoteca", which is a bar.
        XCTAssertEqual(DaySlotting.suggest(name: "Espressoteca", category: "bar"), .evening)
    }

    // MARK: planSlot

    func testAStopLandsAtTheEndOfItsOwnPartOfTheDayMovingNothing() {
        let stops = [stop("Breakfast", "9:00 AM"), stop("Museum", "10:30 AM"), stop("Dinner", "8:00 PM")]
        let plan = DaySlotting.plan(stops, slot: .afternoon)
        XCTAssertEqual(plan.index, 2, "after the morning pair, before dinner")
        XCTAssertEqual(plan.time, "2:30 PM")
        XCTAssertFalse(plan.tight)
    }

    func testAMorningThatAlreadyRunsLateGetsTheNextFreeTimeNotTheAnchor() {
        let plan = DaySlotting.plan([stop("Market", "9:00 AM", "2 hours")], slot: .morning)
        XCTAssertEqual(plan.index, 1)
        // 9:00 + 2h + the 15-minute buffer, rather than insisting on 10:00 and double-booking.
        XCTAssertEqual(plan.time, "11:15 AM")
        XCTAssertFalse(plan.tight)
    }

    /// Predictability beats optimality: three cafés added to an afternoon come out in the order
    /// they were added, rather than the plan re-sorting itself around a hunt for room.
    func testAStopGoesAtTheEndOfItsPartOfTheDayNotIntoTheWidestGap() {
        let stops = [stop("Lunch", "12:30 PM"), stop("Show", "4:00 PM")]
        XCTAssertEqual(DaySlotting.plan(stops, slot: .afternoon, visitMinutes: 60).index, 2)
    }

    func testTheNextStopsStartIsRespectedNotJustThePreviousOnesEnd() throws {
        let stops = [stop("Lunch", "12:30 PM"), stop("Dinner", "7:00 PM")]
        let plan = DaySlotting.plan(stops, slot: .afternoon, visitMinutes: 60)
        XCTAssertEqual(plan.index, 1)
        let minutes = try XCTUnwrap(at(plan))
        XCTAssertGreaterThanOrEqual(minutes, 13 * 60 + 45, "\(plan.time) must clear lunch plus the buffer")
        XCTAssertLessThanOrEqual(minutes + 60 + 15, 19 * 60, "\(plan.time) must finish before dinner")
    }

    func testAVisitThatCannotClearTheNextStopIsReportedTight() {
        let stops = [stop("Late lunch", "3:00 PM"), stop("Dinner", "5:15 PM")]
        let plan = DaySlotting.plan(stops, slot: .afternoon, visitMinutes: 60)
        XCTAssertTrue(plan.tight, "an hour does not fit between 4pm and 5:15pm with buffers")
        XCTAssertEqual(plan.time, "4:00 PM", "so it sits directly after the lunch it follows")
    }

    /// The window bounds when a stop *starts*. A coffee at 11:30 is a morning coffee even though
    /// you leave at half past twelve — the first version required the whole visit to fit and
    /// called an ordinary morning full.
    func testALongVisitStillStartsInsideItsWindowEvenIfItEndsOutside() {
        let plan = DaySlotting.plan([stop("Market", "9:00 AM", "2 hours")], slot: .morning, visitMinutes: 90)
        XCTAssertFalse(plan.tight)
        XCTAssertEqual(plan.time, "11:15 AM")
    }

    func testAssignedTimesLandOnAFiveMinuteGridSoTheyReadLikeTimes() throws {
        let stops = [
            stop("A", "12:00 PM", "2 hours"), stop("B", "2:15 PM", "2 hours"),
            stop("C", "4:30 PM", "30 min"), stop("Dinner", "5:00 PM"),
        ]
        for slot in TimeOfDay.allCases {
            let plan = DaySlotting.plan(stops, slot: slot)
            XCTAssertEqual(try XCTUnwrap(at(plan)) % 5, 0, "\(slot) gave \(plan.time)")
        }
        // A previous stop ending off-grid pushes past the anchor, so the raw answer is 11:02.
        XCTAssertEqual(DaySlotting.plan([stop("Odd", "10:07 AM", "40 min")], slot: .morning).time, "11:00 AM")
    }

    func testAnEmptyDayGetsTheWindowsAnchor() throws {
        for slot in TimeOfDay.allCases {
            let plan = DaySlotting.plan([], slot: slot)
            XCTAssertEqual(plan.index, 0)
            XCTAssertEqual(at(plan), DaySlotting.windows[slot]?.anchor, "\(slot)")
            XCTAssertFalse(plan.tight)
        }
    }

    func testAStopSlottedBeforeEverythingAlreadyPlannedGoesFirst() {
        let stops = [stop("Lunch", "1:00 PM"), stop("Dinner", "8:00 PM")]
        let plan = DaySlotting.plan(stops, slot: .morning)
        XCTAssertEqual(plan.index, 0)
        XCTAssertEqual(plan.time, "10:00 AM")
    }

    func testAFullAfternoonIsReportedTightRatherThanSilentlyDoubleBooked() throws {
        let stops = [
            stop("A", "12:00 PM", "2 hours"), stop("B", "2:15 PM", "2 hours"),
            stop("C", "4:30 PM", "30 min"), stop("Dinner", "5:00 PM"),
        ]
        let plan = DaySlotting.plan(stops, slot: .afternoon, visitMinutes: 60)
        XCTAssertTrue(plan.tight)
        XCTAssertEqual(plan.index, 3, "still after the last afternoon stop in the running order")
        XCTAssertEqual(DaySchedule.timeOfDay(try XCTUnwrap(at(plan))), .afternoon)
    }

    /// **The invariant the window table exists to preserve.** The stop list groups by
    /// `DaySchedule.timeOfDay`, so a stop filed under Morning appearing beneath an AFTERNOON
    /// heading would be the feature contradicting itself on screen — and it has to hold even when
    /// the day is too full to honour the choice comfortably.
    func testWhateverTimeIsAssignedReadsBackAsTheSlotTheTravellerPicked() throws {
        let days: [[Stop]] = [
            [],
            [stop("One", "9:00 AM")],
            [stop("One", "11:45 AM", "3 hours"), stop("Two", "4:45 PM", "3 hours")],
            [stop("Dawn", "6:00 AM"), stop("Late", "11:30 PM")],
            [stop("A", "8:00 AM", "4 hours"), stop("B", "12:00 PM", "5 hours"), stop("C", "5:00 PM", "5 hours")],
        ]
        for stops in days {
            for slot in TimeOfDay.allCases {
                let plan = DaySlotting.plan(stops, slot: slot)
                XCTAssertEqual(
                    DaySchedule.timeOfDay(try XCTUnwrap(at(plan))), slot,
                    "\(slot) on \(stops.map(\.time)) gave \(plan.time)"
                )
            }
        }
    }

    func testStopsWithUnreadableTimesBoundNothingButKeepTheirPlace() {
        let stops = [stop("Unknown", "sometime"), stop("Dinner", "7:00 PM")]
        let plan = DaySlotting.plan(stops, slot: .afternoon)
        // Stepped over exactly as `DaySchedule.group` steps over it, so the afternoon lands before
        // dinner rather than being pushed by a stop that carries no time at all.
        XCTAssertEqual(plan.index, 1)
        XCTAssertEqual(plan.time, "2:30 PM")
    }

    func testADayWithNoReadableTimesAtAllAppendsAtTheAnchor() {
        let plan = DaySlotting.plan([stop("One", ""), stop("Two", "whenever")], slot: .evening)
        XCTAssertEqual(plan.index, 2)
        XCTAssertEqual(plan.time, "7:00 PM")
    }

    func testAStopWithNoDurationIsSpacedAsIfItTookTheDefault() {
        let plan = DaySlotting.plan([stop("Vague", "9:00 AM", "")], slot: .morning)
        XCTAssertEqual(at(plan), 9 * 60 + DaySlotting.defaultVisitMin + DaySlotting.transitBufferMin)
    }

    /// Every window must sit strictly inside the band `DaySchedule.timeOfDay` reads it back out
    /// of, at both ends. This is the table-level version of the invariant above — it fails on a
    /// bad edit to `windows` without needing a day that happens to expose it.
    func testEveryWindowSitsInsideItsOwnClassificationBand() {
        for slot in TimeOfDay.allCases {
            let w = DaySlotting.windows[slot]!
            XCTAssertEqual(DaySchedule.timeOfDay(w.start), slot, "\(slot) start")
            XCTAssertEqual(DaySchedule.timeOfDay(w.end - 1), slot, "\(slot) end")
            XCTAssertEqual(DaySchedule.timeOfDay(w.anchor), slot, "\(slot) anchor")
            XCTAssertTrue((w.start...w.end - 1).contains(w.anchor), "\(slot) anchor is in range")
        }
    }
}
