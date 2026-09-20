import Foundation
import XCTest
@testable import TripMateKit

final class TripsCopyTests: XCTestCase {
    private func trips(_ destinations: [String]) throws -> [TripSummary] {
        let rows = destinations.map {
            """
            {"id":"\($0)","destination":"\($0)","startDate":"2026-09-12",
            "endDate":"2026-09-20","budget":2600}
            """
        }
        return try JSONDecoder.tripMate.decode(
            [TripSummary].self, from: Data(("[" + rows.joined(separator: ",") + "]").utf8)
        )
    }

    func testPlural() throws {
        XCTAssertTrue(
            TripsCopy.countLine(try trips(["Val d'Orcia, Italy", "Kyoto, Japan"]))
                .hasPrefix("2 trips remembered")
        )
        XCTAssertTrue(
            TripsCopy.countLine(try trips(["Val d'Orcia, Italy"])).hasPrefix("1 trip remembered")
        )
    }

    func testNamesFirstAndLast() throws {
        XCTAssertEqual(
            TripsCopy.countLine(try trips(["Val d'Orcia, Italy", "Zurich", "Kyoto, Japan"])),
            "3 trips remembered, from Val d'Orcia to Kyoto."
        )
    }

    /// One trip — or several to the same place — is not a journey "from X to Y".
    func testSamePlaceBothEndsReadsAsStartingWith() throws {
        XCTAssertEqual(
            TripsCopy.countLine(try trips(["Porto, Portugal"])),
            "1 trip remembered, starting with Porto."
        )
        XCTAssertEqual(
            TripsCopy.countLine(try trips(["Porto, Portugal", "Lisbon", "Porto, Portugal"])),
            "3 trips remembered, starting with Porto."
        )
    }

    /// The country is the same word on every card and carries nothing here.
    func testDropsTheCountry() throws {
        XCTAssertTrue(
            TripsCopy.countLine(try trips(["Kyoto, Japan", "Zurich, Switzerland"]))
                .contains("from Kyoto to Zurich")
        )
    }

    /// A destination with no comma is the whole string, not an empty one.
    func testDestinationWithoutACommaSurvives() throws {
        XCTAssertEqual(
            TripsCopy.countLine(try trips(["Zurich"])),
            "1 trip remembered, starting with Zurich."
        )
    }

    /// No trips is a real state — the invitation renders instead, but this must not trap.
    func testNoTripsIsATotalWithNoClause() {
        XCTAssertEqual(TripsCopy.countLine([]), "0 trips remembered.")
    }
}
