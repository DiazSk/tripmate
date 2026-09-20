import XCTest
@testable import TripMateKit

/// The clock parser and the grouping, both ported from `src/lib/timeOfDay.ts` where they are
/// unit-tested for the same reasons.
final class DayScheduleTests: XCTestCase {

    // MARK: - Parsing a clock the model was only asked to write

    func testReadsTheShapesTheModelActuallySends() {
        XCTAssertEqual(DaySchedule.minutes(fromClock: "1:00 PM"), 13 * 60)
        XCTAssertEqual(DaySchedule.minutes(fromClock: "13:00"), 13 * 60)
        XCTAssertEqual(DaySchedule.minutes(fromClock: "1:00pm"), 13 * 60)
        XCTAssertEqual(DaySchedule.minutes(fromClock: "1 PM"), 13 * 60)
        XCTAssertEqual(DaySchedule.minutes(fromClock: " 9:30 a.m. "), 9 * 60 + 30)
    }

    /// **The one case the 12-hour clock does not simply add twelve**, and the one this would
    /// otherwise get exactly backwards.
    func testMidnightAndNoonAreNotTwelvePastEachOther() {
        XCTAssertEqual(DaySchedule.minutes(fromClock: "12:00 AM"), 0)
        XCTAssertEqual(DaySchedule.minutes(fromClock: "12:00 PM"), 12 * 60)
    }

    /// Anything unreadable returns nil rather than a guess — a guess becomes a heading.
    func testUnreadableTimesReturnNilRatherThanGuessing() {
        for bad in ["", "later", "25:00", "1:75 PM", "13:00 PM", "noon"] {
            XCTAssertNil(DaySchedule.minutes(fromClock: bad), "\(bad) should not parse")
        }
        XCTAssertNil(DaySchedule.minutes(fromClock: nil))
    }

    // MARK: - Boundaries

    func testBoundariesAreTheOrdinaryEnglishOnes() {
        XCTAssertEqual(DaySchedule.timeOfDay(5 * 60), .morning, "morning opens at 5am")
        XCTAssertEqual(DaySchedule.timeOfDay(11 * 60 + 59), .morning)
        XCTAssertEqual(DaySchedule.timeOfDay(12 * 60), .afternoon, "noon by definition")
        XCTAssertEqual(DaySchedule.timeOfDay(16 * 60 + 59), .afternoon)
        XCTAssertEqual(DaySchedule.timeOfDay(17 * 60), .evening, "where dinners land")
    }

    /// Evening is the fallthrough because it is the bucket that wraps past midnight.
    func testEveningWrapsPastMidnightUpToFive() {
        XCTAssertEqual(DaySchedule.timeOfDay(0), .evening)
        XCTAssertEqual(DaySchedule.timeOfDay(4 * 60 + 59), .evening)
        XCTAssertEqual(DaySchedule.timeOfDay(23 * 60), .evening)
    }

    // MARK: - Grouping

    private func stops(_ times: [String]) throws -> [Stop] {
        let json = "[" + times.map {
            """
            {"name":"s","lat":0,"lng":0,"cost":0,"note":"n","time":"\($0)",
             "durationLabel":"1h","category":"other"}
            """
        }.joined(separator: ",") + "]"
        return try JSONDecoder().decode([Stop].self, from: Data(json.utf8))
    }

    func testConsecutiveStopsInOnePartOfTheDayShareAGroup() throws {
        let groups = DaySchedule.group(try stops(["9:00 AM", "10:30 AM", "1:00 PM", "7:30 PM"]))
        XCTAssertEqual(groups.map(\.label), [.morning, .afternoon, .evening])
        XCTAssertEqual(groups[0].stops.map(\.index), [0, 1])
    }

    /// **Order is never changed.** A plan that puts a 9am stop after a 3pm one says so; this is a
    /// heading, not a sort.
    func testAnOutOfOrderDayIsLabelledNotReordered() throws {
        let groups = DaySchedule.group(try stops(["3:00 PM", "9:00 AM"]))
        XCTAssertEqual(groups.map(\.label), [.afternoon, .morning])
        XCTAssertEqual(groups.flatMap { $0.stops.map(\.index) }, [0, 1])
    }

    /// An untimed stop between two afternoon ones is an afternoon stop, not its own bucket.
    func testAnUntimedStopJoinsTheGroupInProgress() throws {
        let groups = DaySchedule.group(try stops(["1:00 PM", "whenever", "3:00 PM"]))
        XCTAssertEqual(groups.count, 1)
        XCTAssertEqual(groups[0].stops.map(\.index), [0, 1, 2])
    }

    /// Leading untimed stops borrow the first real label rather than being filed under a guess.
    func testLeadingUntimedStopsBorrowTheFirstKnownLabel() throws {
        let groups = DaySchedule.group(try stops(["sometime", "7:00 PM"]))
        XCTAssertEqual(groups.map(\.label), [.evening])
        XCTAssertEqual(groups[0].stops.count, 2)
    }

    /// **A day with no readable time gets one unlabelled group**, so the view draws no heading —
    /// "Morning" over a day whose timing is unknown invents a fact.
    func testADayWithNoTimesIsOneUnlabelledGroup() throws {
        let groups = DaySchedule.group(try stops(["", "later", "sometime"]))
        XCTAssertEqual(groups.count, 1)
        XCTAssertNil(groups[0].label)
    }

    func testAnEmptyDayGroupsToNothing() {
        XCTAssertTrue(DaySchedule.group([]).isEmpty)
    }
}
