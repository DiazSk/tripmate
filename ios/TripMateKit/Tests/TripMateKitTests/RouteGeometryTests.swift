import XCTest
@testable import TripMateKit

final class RouteGeometryTests: XCTestCase {

    // MARK: - Palette

    /// Modulo, not a hash — so adjacent days can never share a palette until the pool wraps.
    /// A hash makes no such promise, and two consecutive days colliding is the exact case the
    /// palette exists to prevent.
    func testAdjacentDaysNeverShareAPaletteBeforeThePoolWraps() {
        let count = RouteGeometry.dayPalettes.count
        for day in 0..<(count - 1) {
            XCTAssertNotEqual(
                RouteGeometry.palette(forDay: day),
                RouteGeometry.palette(forDay: day + 1)
            )
        }
    }

    func testPaletteCyclesAtThePoolSize() {
        let count = RouteGeometry.dayPalettes.count
        XCTAssertEqual(RouteGeometry.palette(forDay: 0), RouteGeometry.palette(forDay: count))
        XCTAssertEqual(RouteGeometry.palette(forDay: 2), RouteGeometry.palette(forDay: count + 2))
    }

    /// A 30-day trip is legal (`MAX_TRIP_DAYS`), and a negative index should not trap either —
    /// Swift's `%` keeps the sign, which would be a crash rather than a wrap.
    func testPaletteHandlesEveryLegalDayIndexAndNegatives() {
        for day in 0..<30 {
            XCTAssertNotNil(RouteGeometry.palette(forDay: day))
        }
        XCTAssertEqual(RouteGeometry.palette(forDay: -1), RouteGeometry.palette(forDay: 4))
    }

    // MARK: - Stops

    /// A zeroed coordinate is treated as missing rather than as a point in the Gulf of Guinea.
    /// The model does emit these, and a leg drawn out to the Atlantic is worse than one fewer stop.
    func testZeroedCoordinatesAreDropped() throws {
        let itinerary = try Self.itinerary([
            [(38.7, -9.1, "Alfama"), (0, 0, "Nowhere"), (38.72, -9.14, "Belém")],
        ])
        let stops = RouteGeometry.routeStops(itinerary)
        XCTAssertEqual(stops.map(\.name), ["Alfama", "Belém"])
    }

    /// `indexWithinDay` must be dense after dropping — emphasis is addressed by it, so a hole
    /// would point at the wrong stop.
    func testIndexWithinDayStaysDenseAcrossDroppedStops() throws {
        let itinerary = try Self.itinerary([
            [(0, 0, "gone"), (38.7, -9.1, "a"), (38.71, -9.11, "b")],
        ])
        let stops = RouteGeometry.routeStops(itinerary)
        XCTAssertEqual(stops.map(\.indexWithinDay), [0, 1])
    }

    func testDayIndexIsAttachedFromPositionInTheItinerary() throws {
        let itinerary = try Self.itinerary([
            [(38.7, -9.1, "d0")],
            [(38.71, -9.11, "d1")],
        ])
        let stops = RouteGeometry.routeStops(itinerary)
        XCTAssertEqual(stops.map(\.dayIndex), [0, 1])
    }

    // MARK: - Fixture

    static func itinerary(_ days: [[(Double, Double, String)]]) throws -> Itinerary {
        let dayJSON = days.map { stops in
            let stopJSON = stops.map { lat, lng, name in
                """
                {"name":"\(name)","lat":\(lat),"lng":\(lng),"cost":0,"note":"n",
                 "time":"9:00 AM","durationLabel":"1h","category":"entry"}
                """
            }.joined(separator: ",")
            return #"{"date":"2026-09-19","weather":"sunny","stops":[\#(stopJSON)]}"#
        }.joined(separator: ",")

        return try JSONDecoder.tripMate.decode(
            Itinerary.self,
            from: Data(#"{"tier":"budget","days":[\#(dayJSON)]}"#.utf8)
        )
    }
}

final class FramingTests: XCTestCase {

    /// No panel: centred, and the range is the plain radius multiple.
    func testNoPanelMeansCentredFraming() {
        let framing = Framing.routeBesidePanel(radiusM: 1000, viewWidthPx: 0, freeWidthPx: 0)
        XCTAssertEqual(framing.biasM, 0)
        XCTAssertEqual(framing.rangeM, 2500)
    }

    /// **A full-bleed panel is the phone layout**, where there is no strip to aim at — so centred
    /// framing is the correct answer rather than a fallback.
    func testFullBleedPanelCentresRatherThanBiasing() {
        let framing = Framing.routeBesidePanel(radiusM: 1000, viewWidthPx: 400, freeWidthPx: 400)
        XCTAssertEqual(framing.biasM, 0)
        XCTAssertEqual(framing.rangeM, 2500)
    }

    /// The floor keeps a tight cluster of stops from putting Cesium's camera inside the
    /// buildings — and it defaults to the web value so this stays a faithful port.
    func testRangeHasAFloor() {
        let framing = Framing.routeBesidePanel(radiusM: 1, viewWidthPx: 0, freeWidthPx: 0)
        XCTAssertEqual(framing.rangeM, Framing.webMinRangeM)
    }

    /// **The floor is a calibration, not a law**, and the caller supplies it.
    ///
    /// Route framing no longer goes through this function at all — MapKit fits a rect natively.
    /// This still covers the *point-flight* shape story mode needs, where there is no rect and the
    /// answer genuinely is a target plus a range.
    func testRangeFloorIsCallerSupplied() {
        let tight = Framing.routeBesidePanel(
            radiusM: 25, viewWidthPx: 1488, freeWidthPx: 968,
            minRangeM: Framing.mapKitMinRangeM
        )
        XCTAssertEqual(tight.rangeM, Framing.mapKitMinRangeM)
        XCTAssertLessThan(tight.rangeM, Framing.webMinRangeM)

        // A day big enough to clear both floors is unaffected by either.
        let wide = Framing.routeBesidePanel(
            radiusM: 2000, viewWidthPx: 1488, freeWidthPx: 968,
            minRangeM: Framing.mapKitMinRangeM
        )
        XCTAssertGreaterThan(wide.rangeM, Framing.webMinRangeM)
    }

    /// Two independent corrections: pull back by viewWidth/freeWidth, then shift the aim by the
    /// metres matching half the panel's width.
    func testDockedPanelPullsBackAndBiases() {
        // 1000pt viewport, 600pt free strip → fitScale 1.667
        let framing = Framing.routeBesidePanel(
            radiusM: 1000, viewWidthPx: 1000, freeWidthPx: 600
        )
        XCTAssertEqual(framing.rangeM, 1000 * 2.5 * (1000.0 / 600.0), accuracy: 0.001)

        let metresPerPx = (2 * framing.rangeM * Framing.defaultTanHalfFovX) / 1000
        XCTAssertEqual(framing.biasM, 200 * metresPerPx, accuracy: 0.001)
        XCTAssertGreaterThan(framing.biasM, 0)
    }

    /// Without the ceiling, a very narrow strip sends the camera far enough up that a city block
    /// becomes 80 pixels. Better to run slightly under the panel than to lose the route to
    /// altitude.
    func testFitScaleIsCapped() {
        let framing = Framing.routeBesidePanel(
            radiusM: 1000, viewWidthPx: 1000, freeWidthPx: 50
        )
        XCTAssertEqual(framing.rangeM, 1000 * 2.5 * Framing.maxFitScale, accuracy: 0.001)
    }

    // MARK: - Geometry

    func testDistanceIsGreatCircle() {
        // Lisbon to Madrid, ~502km.
        let lisbon = GeoPoint(lat: 38.72, lng: -9.14)
        let madrid = GeoPoint(lat: 40.42, lng: -3.70)
        XCTAssertEqual(Framing.distanceM(lisbon, madrid) / 1000, 502, accuracy: 6)
        XCTAssertEqual(Framing.distanceM(lisbon, lisbon), 0, accuracy: 0.0001)
    }

    func testBoundingRadiusContainsEveryPoint() {
        let points = [
            GeoPoint(lat: 38.70, lng: -9.10),
            GeoPoint(lat: 38.75, lng: -9.20),
            GeoPoint(lat: 38.72, lng: -9.14),
        ]
        let radius = Framing.boundingRadiusM(points)
        let centre = Framing.centroid(points)!
        for point in points {
            XCTAssertLessThanOrEqual(Framing.distanceM(centre, point), radius + 0.001)
        }
    }

    func testEmptyPointsHaveNoCentroidAndNoRadius() {
        XCTAssertNil(Framing.centroid([]))
        XCTAssertEqual(Framing.boundingRadiusM([]), 0)
    }

    /// The bias is applied as an eastward offset, and the conversion has to account for latitude —
    /// a degree of longitude is much shorter in Reykjavík than in Lisbon.
    func testEastOffsetShrinksWithLatitude() {
        let lisbon = GeoPoint(lat: 38.72, lng: -9.14)
        let reykjavik = GeoPoint(lat: 64.13, lng: -21.90)
        let lisbonShift = Framing.offsetEast(lisbon, metres: 1000).lng - lisbon.lng
        let reykjavikShift = Framing.offsetEast(reykjavik, metres: 1000).lng - reykjavik.lng
        XCTAssertGreaterThan(reykjavikShift, lisbonShift)
        XCTAssertEqual(Framing.offsetEast(lisbon, metres: 0), lisbon)
    }
}

// MARK: - Camera distance and the label reveal

final class RevealTests: XCTestCase {

    /// The common case: pitch 0, so the eye is straight over the point it is aimed at.
    func testFlatCameraIsTheHypotenuseOfGroundAndAltitude() {
        let centre = GeoPoint(lat: 38.7, lng: -9.1)
        let target = Framing.offset(centre, metresNorth: 1000, metresEast: 0)
        let d = Framing.cameraDistanceM(
            to: target, centre: centre, centreDistanceM: 1000,
            pitchDegrees: 0, headingDegrees: 0
        )
        XCTAssertEqual(d, (1000.0 * 1000 + 1000 * 1000).squareRoot(), accuracy: 1)
    }

    func testDistanceToTheAimPointIsTheCameraDistance() {
        let centre = GeoPoint(lat: 38.7, lng: -9.1)
        for pitch in [0.0, 30, 60] {
            let d = Framing.cameraDistanceM(
                to: centre, centre: centre, centreDistanceM: 2000,
                pitchDegrees: pitch, headingDegrees: 45
            )
            XCTAssertEqual(d, 2000, accuracy: 1, "pitch \(pitch)")
        }
    }

    /// **The whole reason this is per-stop rather than per-view.** Lay the camera down and the two
    /// ends of the frame are at genuinely different distances — a single zoom threshold cannot
    /// tell them apart, which is what the web note argues and what this asserts.
    func testPitchSeparatesTheNearAndFarEndsOfTheFrame() {
        let centre = GeoPoint(lat: 38.7, lng: -9.1)
        // Heading 0 is north, so the eye lies to the south: a point north of centre is the far one.
        let far = Framing.offset(centre, metresNorth: 2000, metresEast: 0)
        let near = Framing.offset(centre, metresNorth: -2000, metresEast: 0)
        let args = (centreDistanceM: 3000.0, pitchDegrees: 70.0, headingDegrees: 0.0)
        let dFar = Framing.cameraDistanceM(
            to: far, centre: centre, centreDistanceM: args.centreDistanceM,
            pitchDegrees: args.pitchDegrees, headingDegrees: args.headingDegrees
        )
        let dNear = Framing.cameraDistanceM(
            to: near, centre: centre, centreDistanceM: args.centreDistanceM,
            pitchDegrees: args.pitchDegrees, headingDegrees: args.headingDegrees
        )
        XCTAssertGreaterThan(dFar - dNear, 3000)
    }

    /// The band, at its three interesting points. A day framed for reading shows no names; a stop
    /// you have come down onto is fully named.
    func testRevealIsOffBeyondTheBandAndFullInsideIt() {
        XCTAssertEqual(Framing.Reveal.opacity(atDistanceM: 9000), 0)
        XCTAssertEqual(Framing.Reveal.opacity(atDistanceM: Framing.Reveal.hiddenBeyondM), 0)
        XCTAssertEqual(Framing.Reveal.opacity(atDistanceM: 1200), 1)
        let mid = Framing.Reveal.opacity(
            atDistanceM: (Framing.Reveal.hiddenBeyondM + Framing.Reveal.visibleWithinM) / 2
        )
        XCTAssertEqual(mid, 0.5, accuracy: 0.001)
    }

    /// A card too faint to read must round to nothing rather than compositing at 3%.
    func testOpacityBelowTheFloorIsZero() {
        // 6% of the band up from the far edge is the floor itself; just short of it is nothing.
        let span = Framing.Reveal.hiddenBeyondM - Framing.Reveal.visibleWithinM
        let justInside = Framing.Reveal.hiddenBeyondM - span * (Framing.Reveal.minOpacity * 0.9)
        XCTAssertEqual(Framing.Reveal.opacity(atDistanceM: justInside), 0)
    }

    /// `clamp(900000 / (d + 260000), 0.55, 1)` — both clamps, and the curve between them.
    func testScaleIsClampedAtBothEnds() {
        XCTAssertEqual(Framing.Reveal.scale(atDistanceM: 0), Framing.Reveal.scaleMax)
        XCTAssertEqual(Framing.Reveal.scale(atDistanceM: 5_000_000), Framing.Reveal.scaleMin)
        // 900000 / 460000 = 1.956 → clamped to 1.
        XCTAssertEqual(Framing.Reveal.scale(atDistanceM: 200_000), 1)
        // 900000 / 1260000 = 0.714, inside the band.
        XCTAssertEqual(Framing.Reveal.scale(atDistanceM: 1_000_000), 0.714, accuracy: 0.001)
    }

    /// Every distance a real camera reaches is above the floor, which is what makes the reveal and
    /// not the scale the thing that hides a card.
    func testScaleStaysNearTheCeilingAcrossTheRevealBand() {
        for distance in stride(from: 0.0, through: Framing.Reveal.hiddenBeyondM, by: 500) {
            XCTAssertGreaterThan(Framing.Reveal.scale(atDistanceM: distance), 0.98)
        }
    }

    // MARK: - Raw vs drawn stop indices

    /// **The bug both indices exist to prevent.** Drop a stop and the two indices diverge, so
    /// addressing emphasis with the wrong one points at the neighbour — silently, and only on a
    /// day that has a dropped stop.
    func testRawIndexSurvivesADroppedStop() throws {
        let itinerary = try RouteGeometryTests.itinerary([
            [(38.70, -9.10, "a"), (0, 0, "gone"), (38.71, -9.11, "b"), (38.72, -9.12, "c")],
        ])
        let stops = RouteGeometry.routeStops(itinerary)
        XCTAssertEqual(stops.map(\.indexWithinDay), [0, 1, 2])
        XCTAssertEqual(stops.map(\.rawIndex), [0, 2, 3])
        // "b" is the panel's third row and the route's second point.
        let b = try XCTUnwrap(stops.first { $0.name == "b" })
        XCTAssertEqual(b.rawIndex, 2)
        XCTAssertEqual(b.indexWithinDay, 1)
    }

    func testRawIndexMatchesDrawnIndexWhenNothingIsDropped() throws {
        let itinerary = try RouteGeometryTests.itinerary([
            [(38.70, -9.10, "a"), (38.71, -9.11, "b")],
            [(38.80, -9.20, "c")],
        ])
        for stop in RouteGeometry.routeStops(itinerary) {
            XCTAssertEqual(stop.rawIndex, stop.indexWithinDay)
        }
    }
}
