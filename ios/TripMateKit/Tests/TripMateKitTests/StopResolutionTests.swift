import Foundation
import XCTest
@testable import TripMateKit

/// `StopResolution` — what to ask a geocoder about a stop, and whether to believe it.
///
/// The canonical case throughout is the real one: a nine-day Val d'Orcia trip where ten stops
/// share 43.0766, 11.6785 (the Pienza town centre) and "Breakfast at Caffè Poliziano" is 8.4 km
/// from the café it names.
final class StopResolutionTests: XCTestCase {

    // Pienza's centre — the point ten fabricated stops share.
    private let pienza = GeoPoint(lat: 43.0766, lng: 11.6785)
    // Where Caffè Poliziano actually is, per MKLocalSearch.
    private let poliziano = GeoPoint(lat: 43.09032, lng: 11.78055)

    private func stop(_ name: String, _ lat: Double, _ lng: Double) -> Stop {
        Stop(name: name, lat: lat, lng: lng)
    }

    // MARK: - query(for:)

    func testAMealAtAPlaceAsksAboutThePlace() {
        XCTAssertEqual(StopResolution.query(for: "Breakfast at Caffè Poliziano"), "Caffè Poliziano")
        XCTAssertEqual(StopResolution.query(for: "Dinner around Pike Place Market"), "Pike Place Market")
        XCTAssertEqual(StopResolution.query(for: "Lunch in Pienza centro"), "Pienza centro")
        XCTAssertEqual(StopResolution.query(for: "Drinks near the Duomo"), "the Duomo")
    }

    /// **The trap the lead-in vocabulary exists to avoid.** Splitting on the separator without
    /// checking the first word turns this into "Pienza", which geocodes to the town centroid —
    /// which is the exact bug the whole feature is repairing.
    func testANameThatMerelyContainsASeparatorIsLeftAlone() {
        XCTAssertEqual(
            StopResolution.query(for: "Museum of Art in Pienza"), "Museum of Art in Pienza"
        )
        XCTAssertEqual(
            StopResolution.query(for: "Abbey of Sant'Antimo"), "Abbey of Sant'Antimo"
        )
    }

    /// Splits once. "Dinner at the trattoria in Pienza" is a question about the trattoria.
    func testOnlyTheFirstSeparatorCuts() {
        XCTAssertEqual(
            StopResolution.query(for: "Dinner at the trattoria in Pienza"),
            "the trattoria in Pienza"
        )
    }

    func testAPlaceNameIsAskedAboutWhole() {
        XCTAssertEqual(StopResolution.query(for: "Caffè Fiaschetteria"), "Caffè Fiaschetteria")
        XCTAssertEqual(StopResolution.query(for: "Car rental pickup"), "Car rental pickup")
    }

    /// A meal word with no place after it names nothing. Asking anyway spends a request to be
    /// told about a town in Poland.
    func testAMealWithNoPlaceAsksNothing() {
        XCTAssertNil(StopResolution.query(for: "Lunch"))
        XCTAssertNil(StopResolution.query(for: "  Dinner  "))
        XCTAssertNil(StopResolution.query(for: ""))
        XCTAssertNil(StopResolution.query(for: "   "))
        // A separator with nothing after it is the same situation.
        XCTAssertNil(StopResolution.query(for: "Breakfast at"))
    }

    func testAMealWordWithoutASeparatorKeepsItsWholeName() {
        XCTAssertEqual(StopResolution.query(for: "Breakfast buffet"), "Breakfast buffet")
    }

    func testTheVocabularyIgnoresCaseAndAccents() {
        XCTAssertEqual(StopResolution.query(for: "BREAKFAST AT Caffè Poliziano"), "Caffè Poliziano")
        XCTAssertEqual(StopResolution.query(for: "Café at Piazza Grande"), "Café at Piazza Grande")
        // Trailing punctuation on the lead-in must not defeat the match.
        XCTAssertEqual(StopResolution.query(for: "Dinner, at Latte di Luna"), "Latte di Luna")
    }

    // MARK: - anchors(_:excluding:)

    func testTheStopBeingResolvedIsNotOneOfItsOwnAnchors() {
        let stops = [stop("A", 43.1, 11.6), stop("B", 43.2, 11.7), stop("C", 43.3, 11.8)]
        let anchors = StopResolution.anchors(stops, excluding: 1)
        XCTAssertEqual(anchors.count, 2)
        XCTAssertFalse(anchors.contains(GeoPoint(lat: 43.2, lng: 11.7)))
    }

    func testZeroedStopsAreNotAnchors() {
        let stops = [stop("A", 43.1, 11.6), stop("Missing", 0, 0), stop("C", 43.3, 11.8)]
        XCTAssertEqual(StopResolution.anchors(stops, excluding: 0).count, 1)
    }

    func testADayOfOneStopOffersNoAnchors() {
        XCTAssertTrue(StopResolution.anchors([stop("Only", 43.1, 11.6)], excluding: 0).isEmpty)
    }

    // MARK: - accepts(_:anchors:)

    /// **The case the whole feature exists for.** Every anchor is the same fabricated Pienza
    /// point; the true café is 8.4 km away and must be believed.
    func testTheMontepulcianoBreakfastIsAccepted() {
        let anchors = Array(repeating: pienza, count: 9)
        XCTAssertTrue(StopResolution.accepts(poliziano, anchors: anchors))
    }

    func testANearbyCorrectionIsAccepted() {
        XCTAssertTrue(
            StopResolution.accepts(GeoPoint(lat: 43.07893, lng: 11.67613), anchors: [pienza])
        )
    }

    func testAPlaceInAnotherCountryIsRefused() {
        // Paris, against a day in Tuscany.
        XCTAssertFalse(StopResolution.accepts(GeoPoint(lat: 48.8566, lng: 2.3522), anchors: [pienza]))
    }

    /// **The boundary, asserted on both sides**, because the bound is wide enough that the two
    /// cases above would survive almost any constant. `offsetEast` gives an exact metre offset.
    func testTheBoundIsFortyKilometresInclusive() {
        let inside = Framing.offsetEast(pienza, metres: StopResolution.maxCorrectionM - 100)
        let outside = Framing.offsetEast(pienza, metres: StopResolution.maxCorrectionM + 100)
        XCTAssertTrue(StopResolution.accepts(inside, anchors: [pienza]))
        XCTAssertFalse(StopResolution.accepts(outside, anchors: [pienza]))
    }

    /// No anchors is no evidence, and no evidence is not grounds for refusal.
    func testWithNoAnchorsAnythingIsAccepted() {
        XCTAssertTrue(StopResolution.accepts(GeoPoint(lat: -33.86, lng: 151.2), anchors: []))
    }

    /// **The mutation this is built for: dropping `excluding` from `anchors`.** With ten
    /// identical bad points, including the stop's own adds nothing and the mutant survives. Two
    /// stops, tuned so that keeping self in the set drags the centroid far enough to flip the
    /// verdict, is what kills it.
    func testIncludingTheStopsOwnPointWouldChangeTheVerdict() {
        // The stop under suspicion sits 70km west of its one good anchor. A candidate 39km east
        // of that anchor is inside the bound; including the suspicious point in the centroid
        // would pull the centre 35km west and push the candidate outside it.
        let anchor = GeoPoint(lat: 43.0, lng: 12.0)
        let suspicious = Framing.offsetEast(anchor, metres: -70_000)
        let candidate = Framing.offsetEast(anchor, metres: 39_000)
        let stops = [
            stop("Suspicious", suspicious.lat, suspicious.lng),
            stop("Good", anchor.lat, anchor.lng),
        ]
        let honest = StopResolution.anchors(stops, excluding: 0)
        XCTAssertTrue(StopResolution.accepts(candidate, anchors: honest))

        let contaminated = stops.map { GeoPoint($0) }
        XCTAssertFalse(
            StopResolution.accepts(candidate, anchors: contaminated),
            "if this passes, excluding the stop's own point buys nothing and the test is toothless"
        )
    }

    // MARK: - isWorthApplying

    func testATinyMoveIsNotWorthARedraw() {
        let near = Framing.offsetEast(pienza, metres: 20)
        XCTAssertFalse(StopResolution.isWorthApplying(from: pienza, to: near))
        let real = Framing.offsetEast(pienza, metres: 300)
        XCTAssertTrue(StopResolution.isWorthApplying(from: pienza, to: real))
    }

    // MARK: - routeStops(_:corrections:)

    private func itinerary(_ days: [[(String, Double, Double)]]) throws -> Itinerary {
        let json = days.map { stops in
            let s = stops.map {
                """
                {"name":"\($0.0)","lat":\($0.1),"lng":\($0.2),"cost":0,"note":"",
                "time":"9:00 AM","durationLabel":"1 hour","category":"other"}
                """
            }.joined(separator: ",")
            return #"{"date":"2026-09-12","weather":"Clear","stops":[\#(s)]}"#
        }.joined(separator: ",")
        return try JSONDecoder.tripMate.decode(
            Itinerary.self, from: Data(#"{"tier":"midrange","days":[\#(json)]}"#.utf8)
        )
    }

    func testACorrectionReplacesTheModelsGuess() throws {
        let plan = try itinerary([[("Breakfast at Caffè Poliziano", 43.0766, 11.6785)]])
        let fixed = RouteGeometry.routeStops(
            plan, corrections: [0: ["Breakfast at Caffè Poliziano": poliziano]]
        )
        XCTAssertEqual(fixed.first?.point, poliziano)
    }

    func testAnUncorrectedStopKeepsWhatItHad() throws {
        let plan = try itinerary([[("A", 43.1, 11.6), ("B", 43.2, 11.7)]])
        let fixed = RouteGeometry.routeStops(plan, corrections: [0: ["A": poliziano]])
        XCTAssertEqual(fixed[1].point, GeoPoint(lat: 43.2, lng: 11.7))
    }

    func testACorrectionForOneDayDoesNotTouchAnother() throws {
        let plan = try itinerary([
            [("Breakfast", 43.1, 11.6)],
            [("Breakfast", 43.1, 11.6)],
        ])
        let fixed = RouteGeometry.routeStops(plan, corrections: [1: ["Breakfast": poliziano]])
        XCTAssertEqual(fixed[0].point, GeoPoint(lat: 43.1, lng: 11.6))
        XCTAssertEqual(fixed[1].point, poliziano)
    }

    /// A stop the model gave no coordinate is exactly the kind a geocoder can place, so a
    /// correction brings it back into the route rather than leaving it dropped.
    func testACorrectionUnDropsAZeroedStop() throws {
        let plan = try itinerary([[("A", 43.1, 11.6), ("Missing", 0, 0)]])
        XCTAssertEqual(RouteGeometry.routeStops(plan).count, 1)
        let fixed = RouteGeometry.routeStops(plan, corrections: [0: ["Missing": poliziano]])
        XCTAssertEqual(fixed.count, 2)
        XCTAssertEqual(fixed[1].point, poliziano)
        XCTAssertEqual(fixed[1].indexWithinDay, 1)
    }

    /// Correcting a stop *to* zero is still a missing coordinate, not a point in the Atlantic.
    func testACorrectionToZeroIsStillDropped() throws {
        let plan = try itinerary([[("A", 43.1, 11.6)]])
        let fixed = RouteGeometry.routeStops(plan, corrections: [0: ["A": GeoPoint(lat: 0, lng: 0)]])
        XCTAssertTrue(fixed.isEmpty)
    }
}
