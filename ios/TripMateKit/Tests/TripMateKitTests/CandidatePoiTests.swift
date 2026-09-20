import Foundation
import XCTest
@testable import TripMateKit

/// The wire name is `category`; the Swift name is `kind`. This is the guard on that mapping.
///
/// It exists because the mismatch was **silent in both directions** — an optional field decoded
/// as `nil` and encoded under a key nobody reads, so a POI the traveller pinned reached the
/// planner stripped of its category and nothing anywhere failed.
final class CandidatePoiTests: XCTestCase {
    func testDecodesCategoryIntoKind() throws {
        let json = #"{"name":"Café Guarany","lat":41.1478,"lon":-8.6109,"category":"cafe"}"#
        let poi = try JSONDecoder().decode(CandidatePoi.self, from: Data(json.utf8))
        XCTAssertEqual(poi.name, "Café Guarany")
        XCTAssertEqual(poi.kind, "cafe")
        XCTAssertEqual(poi.lon, -8.6109)
    }

    func testEncodesKindAsCategory() throws {
        let poi = CandidatePoi(name: "Livraria Lello", lat: 41.147, lon: -8.6149, kind: "museum")
        let data = try JSONEncoder().encode(poi)
        let back = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
        XCTAssertEqual(back["category"] as? String, "museum")
        // The name the server never sends and never reads.
        XCTAssertNil(back["kind"])
        // Contract rule 3: `lon`, not `lng`. Encoding this one as `lng` puts the anchor in the
        // wrong ocean, so it is asserted here rather than trusted.
        XCTAssertNotNil(back["lon"])
        XCTAssertNil(back["lng"])
    }

    func testAbsentCategoryIsNil() throws {
        let json = #"{"name":"Fonte dos Aliados","lat":41.15,"lon":-8.61}"#
        let poi = try JSONDecoder().decode(CandidatePoi.self, from: Data(json.utf8))
        XCTAssertNil(poi.kind)
    }
}
