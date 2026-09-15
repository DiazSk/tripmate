import MapKit
import TripMateKit

/// What the map is currently asked to draw: one day of one trip.
///
/// **One day, not the whole trip.** The web renderer can draw every day at once and emphasise one,
/// but that reading depends on the elevated arcs to separate overlapping days in the air — which
/// MapKit cannot do, so overlapping draped routes on a dense city would read as a single tangle.
/// Drawing the day being read is the honest version of the same intent.
struct RoutePresentation: Equatable {
    let dayIndex: Int
    let stops: [RouteStop]

    var palette: DayPalette { RouteGeometry.palette(forDay: dayIndex) }
    var points: [GeoPoint] { stops.map(\.point) }
    var coordinates: [CLLocationCoordinate2D] {
        stops.map { CLLocationCoordinate2D(latitude: $0.point.lat, longitude: $0.point.lng) }
    }

    /// An identity that changes exactly when the drawing should — used to avoid re-framing the
    /// camera on every unrelated environment change.
    var identity: String {
        "\(dayIndex):" + stops.map { "\($0.point.lat),\($0.point.lng)" }.joined(separator: ";")
    }

    init?(trip: Trip, dayIndex: Int) {
        let all = RouteGeometry.routeStops(trip.itinerary)
        let dayStops = all.filter { $0.dayIndex == dayIndex }
        guard !dayStops.isEmpty else { return nil }
        self.dayIndex = dayIndex
        self.stops = dayStops
    }
}
