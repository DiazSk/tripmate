import XCTest
@testable import TripMateKit

/// The one sentence the Profile header card prints.
final class TravelerPortraitTests: XCTestCase {

    func testReadsAsOneSentence() {
        XCTAssertEqual(
            TravelerPortrait.sentence(
                group: .solo, explorerStyle: .relaxed, energy: .moderate, crowds: .avoid
            ),
            "A solo traveller who wants a few things done well — at a comfortable pace, away from the crowds."
        )
        XCTAssertEqual(
            TravelerPortrait.sentence(
                group: .familyWithKids, explorerStyle: .packed, energy: .high, crowds: .love
            ),
            "A family with kids who wants to see as much as possible — happy to walk all day, in the thick of it."
        )
    }

    /// **Every one of the 144 combinations, because the point of composing from fragments was
    /// that none of them can come out malformed.** A missing fragment would show up here as a
    /// double space or a stray dash rather than on somebody's phone.
    func testEveryCombinationIsWellFormed() {
        var seen = Set<String>()
        for group in GroupType.allCases {
            for style in ExplorerStyle.allCases {
                for energy in EnergyLevel.allCases {
                    for crowds in CrowdPreference.allCases {
                        let s = TravelerPortrait.sentence(
                            group: group, explorerStyle: style, energy: energy, crowds: crowds
                        )
                        seen.insert(s)
                        XCTAssertTrue(s.hasPrefix("A "), s)
                        XCTAssertTrue(s.hasSuffix("."), s)
                        XCTAssertFalse(s.contains("  "), "double space: \(s)")
                        XCTAssertFalse(s.contains(" ."), "space before stop: \(s)")
                        XCTAssertFalse(s.contains(",,"), s)
                        XCTAssertEqual(
                            s.filter { $0 == "—" }.count, 1, "exactly one dash: \(s)"
                        )
                    }
                }
            }
        }
        // 4 groups x 4 styles x 3 energies x 3 crowds, and `other` collapses none of them.
        XCTAssertEqual(seen.count, 144)
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
