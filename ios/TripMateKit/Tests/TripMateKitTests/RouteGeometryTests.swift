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

    // MARK: - Taper

    /// Narrows from the stop being left toward the stop being arrived at — the shape says which
    /// way the day runs before any animation does.
    func testTaperNarrowsMonotonically() {
        let widths = RouteGeometry.taperWidths()
        XCTAssertEqual(widths.count, RouteGeometry.taperSegments)
        for (a, b) in zip(widths, widths.dropFirst()) {
            XCTAssertGreaterThan(a, b, "each segment must be narrower than the one before")
        }
    }

    /// Sampled at midpoints, so the widths are symmetric about the leg rather than biased to one
    /// end — the first is inside the start width and the last inside the end width.
    func testTaperIsSampledAtMidpointsNotEndpoints() {
        let widths = RouteGeometry.taperWidths()
        XCTAssertLessThan(widths.first!, RouteGeometry.widthStart)
        XCTAssertGreaterThan(widths.last!, RouteGeometry.widthEnd)
        // Symmetric: the mean of the extremes is the mean of the range.
        let mid = (RouteGeometry.widthStart + RouteGeometry.widthEnd) / 2
        XCTAssertEqual((widths.first! + widths.last!) / 2, mid, accuracy: 0.0001)
    }

    func testTaperDegradesSensiblyAtTheEdges() {
        XCTAssertTrue(RouteGeometry.taperWidths(segments: 0).isEmpty)
        XCTAssertEqual(RouteGeometry.taperWidths(segments: 1), [12.5])
    }

    // MARK: - Fixture

    private static func itinerary(_ days: [[(Double, Double, String)]]) throws -> Itinerary {
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
