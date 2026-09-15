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

        let identity = route?.identity ?? ""
        // `updateUIView` fires on any environment change — a fold, a rotation, a panel resize.
        // Re-framing on all of those would yank the camera away from wherever the traveler had
        // just dragged it, so the redraw is gated on the drawing actually being different.
        guard context.coordinator.drawnIdentity != identity else { return }
        context.coordinator.drawnIdentity = identity

        map.removeOverlays(map.overlays)
        map.removeAnnotations(map.annotations)

        guard let route else { return }

        // **`.aboveLabels`, not `.aboveRoads`.** The day is the reason this map is on screen, so
        // it outranks the basemap's own cartography — and in a dense historic centre like Pienza
        // the POI labels are thick enough to hide a 16pt stroke entirely. The rings stay below the
        // labels: they are ground, and burying a street name under a translucent disc would cost
        // more than it buys.
        map.addOverlay(
            DayRouteOverlay(coordinates: route.coordinates, palette: route.palette),
            level: .aboveLabels
        )
        for circle in Self.groundRings(for: route) {
            map.addOverlay(circle, level: .aboveRoads)
        }
        map.addAnnotations(route.stops.map(StopAnnotation.init(stop:)))

        frame(route, in: map)
    }

    // MARK: - Ground rings

    /// `POOL_RADIUS_M` and `POOL_OUTER_RATIO`, drawn as two real metre-radius circles per stop.
    ///
    /// This is one of the few pieces that ports *exactly*: `MKCircle` takes a radius in metres and
    /// foreshortens correctly under pitch, which is the same thing the Cesium ellipses did. What
    /// does not port is the animation — three rings brightening a third of a cycle apart would
    /// mean redrawing every ring on every frame through CoreGraphics, so the travelling wave is
    /// the casualty and the static rings are what remain.
    private static let poolRadiusM: Double = 42
    private static let poolOuterRatio: Double = 2.1

    private static func groundRings(for route: RoutePresentation) -> [MKCircle] {
        route.coordinates.flatMap { coordinate in
            [
                MKCircle(center: coordinate, radius: poolRadiusM * poolOuterRatio),
                MKCircle(center: coordinate, radius: poolRadiusM),
            ]
        }
    }

    // MARK: - Framing

    private func frame(_ route: RoutePresentation, in map: MKMapView) {
        guard let centre = Framing.centroid(route.points) else { return }
        let framing = Framing.routeBesidePanel(
            radiusM: Framing.boundingRadiusM(route.points),
            viewWidthPx: panelMetrics.viewWidth,
            freeWidthPx: panelMetrics.freeWidth,
            // The web floor is 800m, calibrated so Cesium's oblique camera never flies into the
            // building mesh. Drawing flat there is no geometry to hit, and 800m renders a 50m
            // walking day about 40pt across — measured on a real trip, and it disappeared among
            // the basemap's own pins.
            minRangeM: Framing.mapKitMinRangeM
        )
        let aim = Framing.offsetEast(centre, metres: framing.biasM)
        map.setCamera(
            MKMapCamera(
                lookingAtCenter: CLLocationCoordinate2D(latitude: aim.lat, longitude: aim.lng),
                fromDistance: framing.rangeM,
                // Pitch 0 for now. The web camera sits at an oblique because the route is
                // *elevated* there and a plan view would flatten the arcs; here the route is
                // draped, so an oblique buys nothing and costs legibility on the far stops.
                pitch: 0,
                heading: 0
            ),
            animated: true
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

        func mapView(_ map: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            if let route = overlay as? DayRouteOverlay {
                return DayRouteRenderer(overlay: route)
            }
            if let circle = overlay as? MKCircle {
                let renderer = MKCircleRenderer(circle: circle)
                let palette = (map.overlays.compactMap { $0 as? DayRouteOverlay }.first)?.palette
                    ?? RouteGeometry.palette(forDay: 0)
                let colour = UIColor(
                    red: palette.glow.red, green: palette.glow.green,
                    blue: palette.glow.blue, alpha: 1
                )
                // **The rings are the figure**, not the discs: a disc alone reads as a stain on
                // the cartography, while a circle has an *edge*, which is the thing a basemap
                // cannot fake underneath it. So the fill stays very low and the stroke carries it.
                let isOuter = circle.radius > poolRadiusM * 1.5
                renderer.fillColor = colour.withAlphaComponent(isOuter ? 0.07 : 0.24)
                renderer.strokeColor = colour.withAlphaComponent(isOuter ? 0.75 : 0.5)
                renderer.lineWidth = 1
                return renderer
            }
            return MKOverlayRenderer(overlay: overlay)
        }

        func mapView(
            _ map: MKMapView, viewFor annotation: MKAnnotation
        ) -> MKAnnotationView? {
            guard annotation is StopAnnotation else { return nil }
            return map.dequeueReusableAnnotationView(
                withIdentifier: StopAnnotationView.reuseIdentifier, for: annotation
            )
        }
    }
}
