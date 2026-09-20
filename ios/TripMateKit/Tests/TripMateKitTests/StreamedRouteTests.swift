import Foundation
import XCTest
@testable import TripMateKit

/// `routeStops(streamed:corrections:)` — what the map draws while the plan is still being
/// written.
///
/// Built by decoding real frame JSON rather than by constructing values: `Stop` has a custom
/// decoder and no memberwise initialiser, and the decode is the path the app actually takes.
final class StreamedRouteTests: XCTestCase {
    private func frames(_ json: String) throws -> [StreamedStop] {
        try JSONDecoder.tripMate.decode([StreamedStop].self, from: Data(json.utf8))
    }

    private func stop(
        day: Int, index: Int, name: String, lat: Double, lng: Double, time: String = "9:00 AM"
    ) -> String {
        """
        {"dayIndex":\(day),"stopIndex":\(index),"date":"2026-10-05","stop":{
        "name":"\(name)","lat":\(lat),"lng":\(lng),"cost":0,"note":"",
        "time":"\(time)","durationLabel":"1 hour","category":"other"}}
        """
    }

    /// **Arrival order is not document order.** A frame names its own slot, so a late frame for
    /// an earlier stop has to land in that slot — appending would draw the legs in whatever
    /// order the model finished writing them.
    func testOrdersByDayThenStopRegardlessOfArrival() throws {
        let streamed = try frames(
            "[" + [
                stop(day: 1, index: 0, name: "Second day first", lat: 41.2, lng: -8.6),
                stop(day: 0, index: 1, name: "Bolhão", lat: 41.15, lng: -8.61),
                stop(day: 0, index: 0, name: "Ribeira", lat: 41.14, lng: -8.61),
            ].joined(separator: ",") + "]"
        )
        let route = RouteGeometry.routeStops(streamed: streamed)
        XCTAssertEqual(route.map(\.name), ["Ribeira", "Bolhão", "Second day first"])
        XCTAssertEqual(route.map(\.dayIndex), [0, 0, 1])
    }

    /// `indexWithinDay` restarts per day and is dense; `rawIndex` keeps the frame's own slot.
    func testIndicesAreDensePerDay() throws {
        let streamed = try frames(
            "[" + [
                stop(day: 0, index: 0, name: "A", lat: 41.1, lng: -8.6),
                // Dropped: no coordinate. The next stop must close the gap in the drawing while
                // keeping its own raw slot, or emphasis points at the neighbour.
                stop(day: 0, index: 1, name: "B", lat: 0, lng: 0),
                stop(day: 0, index: 2, name: "C", lat: 41.2, lng: -8.7),
                stop(day: 1, index: 0, name: "D", lat: 41.3, lng: -8.8),
            ].joined(separator: ",") + "]"
        )
        let route = RouteGeometry.routeStops(streamed: streamed)
        XCTAssertEqual(route.map(\.name), ["A", "C", "D"])
        XCTAssertEqual(route.map(\.indexWithinDay), [0, 1, 0])
        XCTAssertEqual(route.map(\.rawIndex), [0, 2, 0])
    }

    /// `day-coords` replaces the model's guess, keyed by name within its day.
    func testCorrectionsReplaceTheModelsGuess() throws {
        let streamed = try frames(
            "[" + stop(day: 0, index: 0, name: "Livraria Lello", lat: 1, lng: 1) + "]"
        )
        let route = RouteGeometry.routeStops(
            streamed: streamed,
            corrections: [0: ["Livraria Lello": GeoPoint(lat: 41.1470, lng: -8.6149)]]
        )
        XCTAssertEqual(route.first?.point.lat, 41.1470)
        XCTAssertEqual(route.first?.point.lng, -8.6149)
    }

    /// A correction belongs to its own day. Two days can hold a stop of the same name — a hotel
    /// appears on every one — and applying day 2's answer to day 0 would move it.
    func testCorrectionsDoNotLeakAcrossDays() throws {
        let streamed = try frames(
            "[" + [
                stop(day: 0, index: 0, name: "Hotel", lat: 41.1, lng: -8.6),
                stop(day: 1, index: 0, name: "Hotel", lat: 41.1, lng: -8.6),
            ].joined(separator: ",") + "]"
        )
        let route = RouteGeometry.routeStops(
            streamed: streamed, corrections: [1: ["Hotel": GeoPoint(lat: 50, lng: 5)]]
        )
        XCTAssertEqual(route[0].point.lat, 41.1, "day 0 keeps its own coordinate")
        XCTAssertEqual(route[1].point.lat, 50, "day 1 takes the correction")
    }

    /// A correction to (0, 0) is still a missing coordinate, not a point in the Atlantic.
    func testCorrectedToZeroIsStillDropped() throws {
        let streamed = try frames(
            "[" + stop(day: 0, index: 0, name: "Nowhere", lat: 41.1, lng: -8.6) + "]"
        )
        let route = RouteGeometry.routeStops(
            streamed: streamed, corrections: [0: ["Nowhere": GeoPoint(lat: 0, lng: 0)]]
        )
        XCTAssertTrue(route.isEmpty)
    }
}
