import XCTest
@testable import TripMateKit

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
