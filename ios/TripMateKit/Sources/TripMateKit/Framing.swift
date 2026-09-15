import Foundation

/// Where to point the camera, in metres.
public struct RouteFraming: Sendable, Equatable {
    /// Metres to shove the aim point east of the route's centre, so the route lands in the free
    /// strip rather than under the panel. Zero when there is no panel to clear.
    public let biasM: Double
    /// Camera distance to that aim point, in metres — `MKMapCamera.centerCoordinateDistance`.
    public let rangeM: Double
}

/// Framing arithmetic, ported from `src/lib/mapRoute.ts`.
///
/// Pure on purpose, for the same reason `Spend` is: this is the part of the map with the
/// hard-won behaviour in it, and `swift test` can reach it while it cannot reach an `MKMapView`.
public enum Framing {

    /// Camera distance as a multiple of the framed radius.
    public static let rangeRadiusRatio: Double = 2.5

    /// The web renderer's range floor, kept as the default so this stays a faithful port.
    ///
    /// **It is a calibration for a different renderer, and callers should say so.** The web value
    /// exists because a tight cluster of stops otherwise puts Cesium's camera *inside* the
    /// building mesh — a hazard of an oblique pitch over 3D photogrammetry. Drawing flat over
    /// vector cartography there is no geometry to fly into, and 800m is badly wrong for the case
    /// it most affects: a walking day whose stops sit 50m apart frames at ~96m and gets snapped to
    /// 800, which renders the whole day about 40pt across and loses it among the basemap's own
    /// pins. Measured on a real trip, not reasoned about.
    ///
    /// So `routeBesidePanel` takes the floor as an argument. See `mapKitMinRangeM`.
    public static let webMinRangeM: Double = 800

    /// The floor for a flat, pitch-0 MapKit camera.
    ///
    /// Chosen from what it has to show rather than from what it has to avoid, and **tuned
    /// against a real trip rather than reasoned about**.
    ///
    /// The web's 800m rendered a 50m walking day about 40pt across. 250m made the day legible but
    /// blew the ground rings up to ~450pt radius — they are a fixed 42m, so on an unusually tight
    /// day they stop reading as pools under a stop and become the dominant shape on screen. 450m
    /// is the compromise: a 60° field of view spans ~520m, putting that day near 140pt with rings
    /// around 250pt.
    ///
    /// **This is a calibration knob and it deserves a human eye.** The tension is real rather than
    /// a mistake — ring radius is fixed in metres while a day's spread is not, so the two only
    /// agree over a band of trip sizes. Most days span a city, where the web constants were
    /// chosen; a four-stop day inside one hill town is the edge this was found on.
    public static let mapKitMinRangeM: Double = 450

    /// A 60° horizontal field of view, which is what the web renderer falls back to when the
    /// frustum cannot be read.
    public static let defaultTanHalfFovX = tan(Double.pi / 6)

    /// The ceiling on pulling back to fit a narrow strip.
    ///
    /// Without it a very narrow free strip sends the camera far enough up that a city block
    /// becomes 80 pixels. Better to let the route run slightly under the panel's edge than to
    /// lose it entirely to altitude.
    public static let maxFitScale: Double = 2.5

    public static let earthRadiusM: Double = 6_371_000

    /// Great-circle distance in metres.
    public static func distanceM(_ a: GeoPoint, _ b: GeoPoint) -> Double {
        let φ1 = a.lat * .pi / 180
        let φ2 = b.lat * .pi / 180
        let dφ = φ2 - φ1
        let dλ = (b.lng - a.lng) * .pi / 180
        let h = sin(dφ / 2) * sin(dφ / 2) + cos(φ1) * cos(φ2) * sin(dλ / 2) * sin(dλ / 2)
        return 2 * earthRadiusM * asin(min(1, sqrt(h)))
    }

    /// The mean of a set of points.
    ///
    /// A plain mean, not a spherical centroid: every caller frames one day in one city, where the
    /// two agree to well inside a pixel. A trip spanning hemispheres would need the real thing,
    /// and `MAX_TRIP_DAYS` days in one destination is not that.
    public static func centroid(_ points: [GeoPoint]) -> GeoPoint? {
        guard !points.isEmpty else { return nil }
        let count = Double(points.count)
        return GeoPoint(
            lat: points.reduce(0) { $0 + $1.lat } / count,
            lng: points.reduce(0) { $0 + $1.lng } / count
        )
    }

    /// The radius that contains every point, measured from their centroid.
    public static func boundingRadiusM(_ points: [GeoPoint]) -> Double {
        guard let centre = centroid(points) else { return 0 }
        return points.reduce(0) { max($0, distanceM(centre, $1)) }
    }

    /// Where to point the camera so the route is centred in the space the panel leaves, rather
    /// than in the viewport.
    ///
    /// The docked panel covers the trailing ~40% of the screen, so the visible map is the strip
    /// from the leading edge to the panel's edge — and the route should sit in the middle of
    /// *that*. Aiming at the viewport centre puts half the day under the panel and leaves a
    /// matching band of dead space on the other side.
    ///
    /// Two independent corrections:
    ///
    /// 1. **Pull back** by `viewWidth / freeWidth`, so a route that filled the viewport now fills
    ///    only the free strip.
    /// 2. **Shift the aim point** by however many metres correspond to half the panel's width on
    ///    screen. Moving the aim toward the panel moves the route away from it.
    ///
    /// The pixels-to-metres conversion is the honest one — `2 · range · tan(½ fovₓ) / viewWidth`
    /// is the width of the world at the aim point's depth — rather than a fraction of the route's
    /// radius, which has no relationship to where the panel's edge actually is and drifts with
    /// every viewport and every trip.
    ///
    /// `rangeM` is computed before `biasM` because the conversion depends on it: the further back
    /// the camera, the more metres a pixel is worth.
    public static func routeBesidePanel(
        radiusM: Double,
        viewWidthPx: Double,
        freeWidthPx: Double,
        tanHalfFovX: Double = defaultTanHalfFovX,
        minRangeM: Double = webMinRangeM
    ) -> RouteFraming {
        let centred = RouteFraming(
            biasM: 0,
            rangeM: max(radiusM * rangeRadiusRatio, minRangeM)
        )
        // No panel, a panel covering everything, or a nonsense measurement: centre it. A
        // full-bleed panel is the phone layout, where there is no strip to aim at and centred
        // framing is the correct answer rather than a fallback.
        guard viewWidthPx > 0, freeWidthPx > 0, freeWidthPx < viewWidthPx else { return centred }

        let fitScale = min(viewWidthPx / freeWidthPx, maxFitScale)
        let rangeM = max(radiusM * rangeRadiusRatio * fitScale, minRangeM)
        let metresPerPx = (2 * rangeM * tanHalfFovX) / viewWidthPx
        // The aim point moves from the viewport's centre to the free strip's centre, and the
        // distance between those is exactly half of what the panel covers.
        let shiftPx = viewWidthPx / 2 - freeWidthPx / 2
        return RouteFraming(biasM: shiftPx * metresPerPx, rangeM: rangeM)
    }

    /// Offset a point east by `metres`, for applying `biasM` to an aim coordinate.
    ///
    /// Longitude only, so the camera's pitch does not enter into it: at heading 0, camera-right is
    /// local east, and pitch tilts the vertical axis rather than this one.
    public static func offsetEast(_ point: GeoPoint, metres: Double) -> GeoPoint {
        guard metres != 0 else { return point }
        let metresPerDegree = (.pi / 180) * earthRadiusM * cos(point.lat * .pi / 180)
        guard metresPerDegree > 0 else { return point }
        return GeoPoint(lat: point.lat, lng: point.lng + metres / metresPerDegree)
    }
}
