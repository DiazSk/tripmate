import XCTest
@testable import TripMateKit

/// The one sentence the Profile header card prints.
final class TravelerPortraitTests: XCTestCase {

    func testTheTwoHalvesMakeOneSentence() {
        XCTAssertEqual(
            TravelerPortrait.headline(group: .couple, explorerStyle: .mixed),
            "A couple who likes a bit of both"
        )
        XCTAssertEqual(
            TravelerPortrait.detail(energy: .moderate, crowds: .avoid),
            "At a comfortable pace, away from the crowds."
        )
    }

    /// **The headline must never end in a stop and the detail must always start with a capital**,
    /// because they are one sentence broken across two faces: the serif carries the subject and
    /// the system face finishes it.
    func testEveryCombinationIsWellFormed() {
        var headlines = Set<String>()
        for group in GroupType.allCases {
            for style in ExplorerStyle.allCases {
                let h = TravelerPortrait.headline(group: group, explorerStyle: style)
                headlines.insert(h)
                XCTAssertTrue(h.hasPrefix("A "), h)
                XCTAssertFalse(h.hasSuffix("."), "headline is not a sentence: \(h)")
                XCTAssertFalse(h.contains("  "), "double space: \(h)")
            }
        }
        XCTAssertEqual(headlines.count, 16)

        var details = Set<String>()
        for energy in EnergyLevel.allCases {
            for crowds in CrowdPreference.allCases {
                let d = TravelerPortrait.detail(energy: energy, crowds: crowds)
                details.insert(d)
                XCTAssertTrue(d.hasSuffix("."), d)
                XCTAssertEqual(d.first, d.first?.uppercased().first, "not capitalised: \(d)")
                XCTAssertFalse(d.contains("  "), "double space: \(d)")
                XCTAssertFalse(d.contains(" ."), "space before stop: \(d)")
            }
        }
        XCTAssertEqual(details.count, 9)
    }

    /// The defaults resolve to solo/mixed/moderate/mixed, so a generated sentence would assert
    /// four things an untouched profile never said.
    func testTheUnansweredStateIsAnInvitationRatherThanAGuess() {
        XCTAssertFalse(TravelerPortrait.unanswered.contains("solo"))
        XCTAssertTrue(TravelerPortrait.unanswered.hasSuffix("."))
    }
}

/// The country a destination names, for the record section's middle figure.
final class DestinationCountryTests: XCTestCase {

    private func summary(_ destination: String) throws -> TripSummary {
        try JSONDecoder().decode(TripSummary.self, from: Data("""
        {"id":"t","destination":"\(destination)","startDate":"2026-09-12",
         "endDate":"2026-09-20","budget":2600,"status":"saved"}
        """.utf8))
    }

    func testTakesTheLastCommaSeparatedPart() throws {
        XCTAssertEqual(try summary("Val d'Orcia, Italy").country, "Italy")
        XCTAssertEqual(try summary("Zurich, Switzerland").country, "Switzerland")
        // Three parts, as Apple's completer returns for US places.
        XCTAssertEqual(try summary("Seaside, OR, United States").country, "United States")
    }

    func testNoCommaMeansThePlaceIsTheAnswer() throws {
        XCTAssertEqual(try summary("Tokyo").country, "Tokyo")
    }

    func testTrailingCommaDoesNotYieldAnEmptyCountry() throws {
        XCTAssertEqual(try summary("Kyoto, Japan ").country, "Japan")
    }
}
