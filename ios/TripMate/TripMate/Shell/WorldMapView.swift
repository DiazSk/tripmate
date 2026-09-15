import MapKit
import SwiftUI
import TripMateKit

/// The map, as `MKMapView` wrapped for SwiftUI.
///
/// **`UIViewRepresentable` rather than SwiftUI's `Map`, and not by preference.** Every framing
/// rule this app owns is written as a target point plus a *range*, a pitch and a heading — the
/// vocabulary `mapCamera.tsx` uses and, as it happens, exactly what `MKMapCamera` takes. SwiftUI's
/// `Map` does not expose that camera, so the framing logic would have to be rewritten against a
/// different model to use it.
struct WorldMapView: UIViewRepresentable {
    /// The day to draw, or nil for a bare map.
    let route: RoutePresentation?
    /// Which stop within that day is being pointed at, as a *drawn* index — see
    /// `RoutePresentation.drawnIndex(forRawStop:)`, which is where the panel's index is converted.
    let emphasis: Int?
    /// The searched place pinned on the map, if any.
    let pin: SearchResult?
    /// Somewhere to look when there is no day to frame — the wizard's geocoded destination.
    ///
    /// **Only honoured while `route` is nil.** A day's framing is a stronger claim about where the
    /// camera belongs than "the trip is roughly here", so once there is a route this is ignored
    /// rather than fighting it.
    let focus: MKCoordinateRegion?
    /// Map taps that change what is being pointed at.
    let onEmphasise: (Int?) -> Void
    /// Where "near this view" is, reported when the camera settles.
    let onRegionSettled: (MKCoordinateRegion) -> Void

    @Environment(\.panelMetrics) private var panelMetrics
    @Environment(\.shellExclusions) private var exclusions

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.delegate = context.coordinator

        // Apple's own cartography is all there is — no tint knob, no LOD control, no style JSON,
        // which is the trade `DESIGN.md`'s globe section documents losing. `.realistic` elevation
        // is the one thing that buys back a sense of terrain.
        let configuration = MKStandardMapConfiguration(elevationStyle: .realistic)
        configuration.pointOfInterestFilter = .includingAll
        map.preferredConfiguration = configuration

        map.showsCompass = false      // The app draws its own, per DESIGN.md's control stack.
        map.showsScale = false
        map.isRotateEnabled = true
        map.isPitchEnabled = true
        // Dark-only, matching the web app's `color-scheme: dark` on :root. The map must not
        // follow the system appearance into light.
        map.overrideUserInterfaceStyle = .dark
        map.register(
            StopAnnotationView.self,
            forAnnotationViewWithReuseIdentifier: StopAnnotationView.reuseIdentifier
        )
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        map.directionalLayoutMargins = Self.margins(clearing: exclusions, in: map.bounds)
        context.coordinator.onEmphasise = onEmphasise
        context.coordinator.onRegionSettled = onRegionSettled

        drawRoute(in: map, coordinator: context.coordinator)
        drawPin(in: map, coordinator: context.coordinator)
        lookAtFocus(in: map, coordinator: context.coordinator)

        // Emphasis is applied on every update and gated by nothing: it changes far more often than
        // the drawing does, and it costs two strokes and a dot colour rather than a redraw.
        context.coordinator.apply(emphasis: emphasis, in: map)
        context.coordinator.refreshReveal(in: map)
    }

    private func drawRoute(in map: MKMapView, coordinator: Coordinator) {
        let identity = route?.identity ?? ""
        // `updateUIView` fires on any environment change — a fold, a rotation, a panel resize.
        // Re-framing on all of those would yank the camera away from wherever the traveler had
        // just dragged it, so the redraw is gated on the drawing actually being different.
        guard coordinator.drawnIdentity != identity else { return }
        coordinator.drawnIdentity = identity

        map.removeOverlays(map.overlays)
        map.removeAnnotations(map.annotations.filter { $0 is StopAnnotation })

        guard let route else { return }

        // **`.aboveLabels`, not `.aboveRoads`.** The day is the reason this map is on screen, so
        // it outranks the basemap's own cartography — and in a dense historic centre like Pienza
        // the POI labels are thick enough to hide the stroke entirely.
        //
        // One overlay per day now. The stop dots used to be two metre-radius `MKCircle`s each;
        // they live in the annotation view instead, where screen-space units make a day's span
        // irrelevant. See `StopAnnotationView.dot`.
        map.addOverlay(
            DayRouteOverlay(coordinates: route.coordinates, palette: route.palette),
            level: .aboveLabels
        )
        map.addAnnotations(route.stops.map(StopAnnotation.init(stop:)))

        frame(route, in: map)
    }

    /// The searched place, and a flight to it.
    ///
    /// Gated separately from the route so a search does not re-frame the day and a day change does
    /// not drop the pin.
    private func drawPin(in map: MKMapView, coordinator: Coordinator) {
        guard coordinator.pinnedID != pin?.id else { return }
        coordinator.pinnedID = pin?.id
        map.removeAnnotations(map.annotations.filter { $0 is SearchPinAnnotation })
        guard let pin else { return }
        map.addAnnotation(SearchPinAnnotation(pin))
        // `STOP_CONTEXT_RADIUS_M` (800m) around the place, which is the web's `flyToPlace`: a
        // traveler asking about a place wants to know where it is *in the city*, so the flight
        // stops short of the building. The web's 3.5km range floor does not come with it — that
        // exists to keep Cesium's oblique camera out of the building mesh, and there is no mesh to
        // fly into here.
        //
        // **Through `fit(_:in:)` rather than `setRegion`, and that is not cosmetic.** `setRegion`
        // centres in the *viewport*, so with a docked panel over the trailing 40% the pin lands
        // against the panel's edge instead of in the middle of the map you can see. That is the
        // same mistake, one call over, that put the whole route off the free strip.
        let span = Framing.placeContextRadiusM * MKMapPointsPerMeterAtLatitude(pin.coordinate.latitude)
        let centre = MKMapPoint(pin.coordinate)
        fit(
            MKMapRect(
                x: centre.x - span, y: centre.y - span, width: span * 2, height: span * 2
            ),
            in: map
        )
    }

    /// Fly to the wizard's destination, once per distinct place.
    ///
    /// Gated on the coordinate rather than on equality of the region, because `MKCoordinateRegion`
    /// is not `Equatable` and the span never changes — and gated so a panel resize does not
    /// re-fly, which is the same rule the route's own redraw gate exists for.
    private func lookAtFocus(in map: MKMapView, coordinator: Coordinator) {
        guard route == nil, let focus else { return }
        let key = "\(focus.center.latitude),\(focus.center.longitude)"
        guard coordinator.focusedKey != key else { return }
        coordinator.focusedKey = key
        map.setRegion(focus, animated: true)
    }

    // MARK: - Framing

    /// Fit the day into the strip the panel leaves.
    ///
    /// **`setVisibleMapRect(_:edgePadding:)` rather than a computed `MKMapCamera`.** The web
    /// renderer has to convert the panel's width into metres and shove the camera's aim point
    /// sideways, because Cesium offers nothing that fits content into an inset region. MapKit
    /// does, and it does the arithmetic in its own projection — so there is no field-of-view
    /// constant to get wrong.
    ///
    /// Porting the workaround instead of using the native call cost a real bug: with Cesium's 60°
    /// FOV the bias came out about 1.4x too large and pushed the entire day off the free strip to
    /// the display's edge, taking the route and every stop card with it.
    ///
    /// The padding *is* the panel. `viewWidth - freeWidth` is what the panel covers, measured
    /// rather than assumed, so this stays correct at every width — including a full-bleed panel,
    /// where it is zero and the day is simply centred.
    private func frame(_ route: RoutePresentation, in map: MKMapView) {
        guard let rect = Self.fitRect(for: route) else { return }
        fit(rect, in: map)
    }

    /// Fit a rect into the strip the panel leaves. One implementation, because a day and a
    /// searched place are the same question about the same geometry.
    private func fit(_ rect: MKMapRect, in map: MKMapView) {
        map.setVisibleMapRect(
            rect,
            edgePadding: UIEdgeInsets(
                top: Token.navHeight + Token.gapRows,
                left: Token.padCompact,
                bottom: Token.padCompact,
                right: max(0, panelMetrics.viewWidth - panelMetrics.freeWidth) + Token.padCompact
            ),
            animated: true
        )
    }

    /// The day's bounding rect, padded to a minimum span.
    ///
    /// Built from min/max rather than by unioning zero-sized rects: `union` has special-case
    /// behaviour for empty rectangles that is easy to be wrong about, and min/max cannot be.
    ///
    /// The minimum span replaces the web's range floor. Fitting a 50m day exactly would zoom to a
    /// single doorway; `mapKitMinSpanM` keeps a day's shape legible without needing the
    /// camera-distance arithmetic that floor existed to bound.
    static func fitRect(for route: RoutePresentation) -> MKMapRect? {
        let points = route.coordinates.map { MKMapPoint($0) }
        guard let firstCoordinate = route.coordinates.first,
              let minX = points.map(\.x).min(), let maxX = points.map(\.x).max(),
              let minY = points.map(\.y).min(), let maxY = points.map(\.y).max()
        else { return nil }

        let rect = MKMapRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
        let minSpan = Framing.mapKitMinSpanM
            * MKMapPointsPerMeterAtLatitude(firstCoordinate.latitude)
        return rect.insetBy(
            dx: -max(0, minSpan - rect.width) / 2,
            dy: -max(0, minSpan - rect.height) / 2
        )
    }

    // MARK: - Hinge

    /// Keep MapKit's *own* furniture — the attribution label, and the compass when shown — out of
    /// the hinge.
    ///
    /// A middle band is not expressible as edge insets, so this does the part that is: it insets
    /// from whichever edge the band is nearer, pushing MapKit's controls onto the roomier half.
    /// **This is not the app's hinge handling.** A route whose centre falls on the fold is bisected
    /// by physical hardware, and the fix for that is biasing the aim point clear of the exclusion
    /// in `Framing` — the same correction the panel already gets. It is not written yet because
    /// `reservedRegions` is not declared API on this SDK, so there is nothing to bias against.
    static func margins(
        clearing exclusions: ShellExclusions, in bounds: CGRect
    ) -> NSDirectionalEdgeInsets {
        guard
            let band = exclusions.primaryFrame,
            band.width > 0, band.height > 0,
            bounds.width > 0
        else { return .zero }

        // A book-style fold reads as a tall, narrow band. A wide, short one is a notch or an
        // under-display camera, which the system already handles through safe areas.
        guard band.height > band.width else { return .zero }

        return band.midX < bounds.midX
            ? NSDirectionalEdgeInsets(top: 0, leading: band.maxX, bottom: 0, trailing: 0)
            : NSDirectionalEdgeInsets(top: 0, leading: 0, bottom: 0, trailing: bounds.width - band.minX)
    }

    // MARK: - Delegate

    final class Coordinator: NSObject, MKMapViewDelegate {
        /// The drawing currently on the map, so an unrelated layout change does not re-frame.
        var drawnIdentity: String?
        /// The pinned place currently on the map, gated apart from the route for the same reason.
        var pinnedID: String?
        /// The wizard destination already flown to.
        var focusedKey: String?
        var onEmphasise: (Int?) -> Void = { _ in }
        var onRegionSettled: (MKCoordinateRegion) -> Void = { _ in }

        func mapView(_ map: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            if let route = overlay as? DayRouteOverlay {
                return DayRouteRenderer(overlay: route)
            }
            return MKOverlayRenderer(overlay: overlay)
        }

        func mapView(
            _ map: MKMapView, viewFor annotation: MKAnnotation
        ) -> MKAnnotationView? {
            if annotation is StopAnnotation {
                return map.dequeueReusableAnnotationView(
                    withIdentifier: StopAnnotationView.reuseIdentifier, for: annotation
                )
            }
            if annotation is SearchPinAnnotation {
                // A marker in the accent, because a pin is where you are pointing — the one thing
                // `--accent` is allowed to mean. MapKit's stock balloon, since a searched place
                // has no design of its own in this app yet.
                let view = MKMarkerAnnotationView(annotation: annotation, reuseIdentifier: "pin")
                view.markerTintColor = UIColor(Token.accent)
                view.glyphImage = UIImage(systemName: "mappin")
                return view
            }
            return nil
        }

        /// Apply the reveal as soon as the views exist, not only on the next camera change — a
        /// freshly drawn day would otherwise sit at whatever alpha the reused view came with.
        func mapView(_ map: MKMapView, didAdd views: [MKAnnotationView]) {
            refreshReveal(in: map)
        }

        /// **MapKit's per-frame hook, and the reason there is no `CADisplayLink` here.** This fires
        /// continuously through a gesture or a flight and not at all while the camera is still,
        /// which is exactly the schedule the reveal wants — a display link would keep waking for
        /// a map nobody is moving.
        func mapViewDidChangeVisibleRegion(_ map: MKMapView) {
            refreshReveal(in: map)
        }

        func mapView(_ map: MKMapView, regionDidChangeAnimated animated: Bool) {
            onRegionSettled(map.region)
        }

        /// Fade and shrink every stop name by its own distance from the camera.
        ///
        /// Per stop rather than per view: on a pitched camera the near edge of the frame can be
        /// 800m away while the far edge is 9km, so one threshold for the whole view either floods
        /// the horizon with names or hides the street underneath. See `Framing.Reveal`.
        ///
        /// ponytail: linear scan over the day's annotations, n ≤ ~15. A day with dozens would want
        /// `annotations(in: visibleMapRect)` instead.
        func refreshReveal(in map: MKMapView) {
            let camera = map.camera
            let centre = GeoPoint(
                lat: camera.centerCoordinate.latitude, lng: camera.centerCoordinate.longitude
            )
            for annotation in map.annotations {
                guard let stop = annotation as? StopAnnotation,
                      let view = map.view(for: stop) as? StopAnnotationView
                else { continue }
                view.apply(
                    distanceM: Framing.cameraDistanceM(
                        to: GeoPoint(lat: stop.coordinate.latitude, lng: stop.coordinate.longitude),
                        centre: centre,
                        centreDistanceM: camera.centerCoordinateDistance,
                        pitchDegrees: camera.pitch,
                        headingDegrees: camera.heading
                    )
                )
            }
        }

        /// Push the emphasised stop into the overlay and the annotation views.
        ///
        /// `setNeedsDisplay()` on the renderer rather than replacing the overlay: rebuilding it
        /// would run through the route's redraw path, which re-frames the camera — so selecting a
        /// stop would snap the view back to the day's bounding rect.
        func apply(emphasis: Int?, in map: MKMapView) {
            if let overlay = map.overlays.compactMap({ $0 as? DayRouteOverlay }).first,
               overlay.emphasisIndex != emphasis {
                overlay.emphasisIndex = emphasis
                map.renderer(for: overlay)?.setNeedsDisplay()
            }
            for annotation in map.annotations {
                guard let stop = annotation as? StopAnnotation,
                      let view = map.view(for: stop) as? StopAnnotationView
                else { continue }
                view.isEmphasised = stop.indexWithinDay == emphasis
            }
        }

        /// Tapping a stop's card points at it; tapping the map again stops pointing.
        ///
        /// The web's equivalent is a pointer hover, which has no touch analogue — a tap is the
        /// gesture that means "this one" here, and it is the same state either way.
        func mapView(_ map: MKMapView, didSelect view: MKAnnotationView) {
            guard let stop = view.annotation as? StopAnnotation else { return }
            onEmphasise(stop.rawIndex)
        }

        func mapView(_ map: MKMapView, didDeselect view: MKAnnotationView) {
            guard view.annotation is StopAnnotation else { return }
            onEmphasise(nil)
        }
    }
}
