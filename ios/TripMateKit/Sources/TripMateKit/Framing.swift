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
    ///
    /// **This is Cesium's number and it does not describe MapKit.** Measured at 450m
    /// `centerCoordinateDistance`, MapKit spans about 370m where this formula predicts 520m — so
    /// anything deriving metres-per-pixel from it is wrong by roughly 1.4x on this platform. That
    /// is why route framing no longer uses `routeBesidePanel`: see its note.
    public static let defaultTanHalfFovX = tan(Double.pi / 6)

    /// The smallest span a framed day is allowed to occupy, in metres.
    ///
    /// Replaces the range floor for rect-based fitting. A four-stop day inside one hill town spans
    /// ~50m, and fitting that exactly would zoom to a single doorway; padding the rect to a
    /// minimum span keeps a day's *shape* legible without the camera-distance arithmetic that
    /// floor existed to bound.
    public static let mapKitMinSpanM: Double = 400

    /// `STOP_CONTEXT_RADIUS_M` — how much ground to frame around a single place.
    ///
    /// A reader asking about one place is asking "where is this *in the city*", so the flight
    /// stops short of the building. The web's matching `STOP_MIN_RANGE_M` floor of 3.5km does
    /// **not** port: that exists to keep Cesium's oblique camera out of the building mesh, and a
    /// flat map has no geometry to fly into.
    public static let placeContextRadiusM: Double = 800

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
    ///
    /// ### Not used for framing a route on MapKit, and that is the interesting part
    ///
    /// This whole function is a workaround for something Cesium cannot do: there is no "fit this
    /// content into an inset region" call there, so the web renderer has to convert the panel's
    /// width into metres itself and shove the aim point sideways. MapKit has
    /// `setVisibleMapRect(_:edgePadding:animated:)`, which performs the fit *and* the offset using
    /// its own projection — no field-of-view constant to get wrong, and no bias to over-apply.
    ///
    /// Porting the workaround rather than using the native call cost a real bug: with Cesium's 60°
    /// FOV the bias came out ~1.4x too large and pushed the whole day off the free strip to the
    /// display's edge.
    ///
    /// Kept because **point flights still need it.** Flying to a single stop has no rect to fit —
    /// story mode asks for a target, a range and a heading — and that is the shape this computes.
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

/// Distance from the camera's eye to a point on the ground, and how visible a label is at it.
///
/// Ported from `MapRenderer.cameraDistanceM` and `StopMarkerLayer`'s reveal rule.
extension Framing {

    /// Metres from the camera's eye to a ground point.
    ///
    /// **Distance per stop, not one zoom threshold for the view, and that is the whole design.**
    /// Zoom is a property of the frame; this is a property of each stop, and on a pitched camera
    /// those are different numbers — the near edge can be 800m away while the far edge is 9km, so
    /// a single zoom threshold either floods the horizon with names or hides the street under you.
    /// A true 3D distance also *is* the pitch-corrected number rather than an estimate of it.
    ///
    /// `MKMapCamera` gives exactly the three inputs this needs. At pitch 0 — the app's usual
    /// state — the eye sits straight over `centre` and this reduces to `hypot(ground, distance)`.
    public static func cameraDistanceM(
        to point: GeoPoint,
        centre: GeoPoint,
        centreDistanceM: Double,
        pitchDegrees: Double,
        headingDegrees: Double
    ) -> Double {
        let pitch = pitchDegrees * .pi / 180
        let altitudeM = centreDistanceM * cos(pitch)
        // The eye stands *behind* the centre it is aimed at, by however much the pitch lays it
        // down — so the offset runs along heading + 180°.
        let backM = centreDistanceM * sin(pitch)
        let eye = offset(centre, metresNorth: -backM * cos(headingDegrees * .pi / 180),
                         metresEast: -backM * sin(headingDegrees * .pi / 180))
        let ground = distanceM(eye, point)
        return (ground * ground + altitudeM * altitudeM).squareRoot()
    }

    /// Move a point by a north/east offset in metres.
    static func offset(_ point: GeoPoint, metresNorth: Double, metresEast: Double) -> GeoPoint {
        let metresPerDegreeLat = (.pi / 180) * earthRadiusM
        let lat = point.lat + metresNorth / metresPerDegreeLat
        return offsetEast(GeoPoint(lat: lat, lng: point.lng), metres: metresEast)
    }

    /// How a stop's name card fades and shrinks with camera distance.
    ///
    /// **A name is a claim about a building, and it earns the screen only once the camera is close
    /// enough that the building is something you can see.** The band is the web's, chosen to match
    /// what a zoom rule would have done at this app's framing: a day framed for reading shows no
    /// names, and coming down on a stop brings its neighbourhood up smoothly rather than switching
    /// it on.
    ///
    /// Losing the name costs the stop its *label*, never its presence — the dot is drawn at every
    /// distance, which is the same guarantee the web layer makes.
    public enum Reveal {
        public static let hiddenBeyondM: Double = 7000
        public static let visibleWithinM: Double = 2800
        /// Below this a card is not worth compositing.
        public static let minOpacity: Double = 0.06

        /// `scale = clamp(900000 / (distance + 260000), 0.55, 1)`. The floor keeps a card readable
        /// with the whole trip in frame; the ceiling stops it dominating at street level.
        public static let scaleNumerator: Double = 900_000
        public static let scaleDistanceBias: Double = 260_000
        public static let scaleMin: Double = 0.55
        public static let scaleMax: Double = 1

        public static func opacity(atDistanceM distance: Double) -> Double {
            let t = (hiddenBeyondM - distance) / (hiddenBeyondM - visibleWithinM)
            let clamped = min(1, max(0, t))
            return clamped < minOpacity ? 0 : clamped
        }

        public static func scale(atDistanceM distance: Double) -> Double {
            min(scaleMax, max(scaleMin, scaleNumerator / (distance + scaleDistanceBias)))
        }
    }
}
