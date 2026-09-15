import MapKit
import TripMateKit
import UIKit

/// One day's route, as a MapKit overlay.
///
/// A custom `MKOverlay` rather than `MKPolyline`, because the design is two strokes — a blurred
/// glow under a thin core — and `MKPolylineRenderer` has one width and one colour.
final class DayRouteOverlay: NSObject, MKOverlay {
    let coordinates: [CLLocationCoordinate2D]
    let palette: DayPalette

    let coordinate: CLLocationCoordinate2D
    let boundingMapRect: MKMapRect

    init(coordinates: [CLLocationCoordinate2D], palette: DayPalette) {
        self.coordinates = coordinates
        self.palette = palette

        let points = coordinates.map { MKMapPoint($0) }
        var rect = points.first.map { MKMapRect(origin: $0, size: MKMapSize(width: 0, height: 0)) }
            ?? MKMapRect.null
        for point in points.dropFirst() {
            rect = rect.union(MKMapRect(origin: point, size: MKMapSize(width: 0, height: 0)))
        }
        // Padded so a wide stroke near the edge is not clipped by its own bounding rect — the
        // rect bounds the *centreline*, and the glow is drawn either side of it.
        self.boundingMapRect = rect.isNull ? .null : rect.insetBy(dx: -rect.width * 0.2 - 1000, dy: -rect.height * 0.2 - 1000)
        self.coordinate = points.first?.coordinate ?? CLLocationCoordinate2D()
    }
}

/// Draws a day's route the way MapLibre's 2D layers do: a wide blurred glow, then a thin core.
///
/// **Ported from the flat design rather than the elevated one.** The previous version carried a
/// dark casing and a six-segment taper, both of which are Cesium's: that ribbon is lifted into the
/// air, where a casing supplies contrast against arbitrary photogrammetry and the taper says which
/// way the day runs. Neither applies to a line draped on vector cartography, and MapLibre's own
/// `-glow`/`-core` pair is what this app actually looks like in 2D. Two strokes instead of a loop
/// over seven.
final class DayRouteRenderer: MKOverlayRenderer {

    private var route: DayRouteOverlay { overlay as! DayRouteOverlay }

    override func draw(
        _ mapRect: MKMapRect, zoomScale: MKZoomScale, in context: CGContext
    ) {
        let points = route.coordinates.map { point(for: MKMapPoint($0)) }
        guard points.count >= 2 else { return }

        context.setLineCap(.round)
        context.setLineJoin(.round)

        // `zoomScale` is points-per-MKMapPoint, so dividing by it holds a stroke at a constant
        // width on screen instead of letting it grow with zoom. The blur radius takes the same
        // conversion — it is a length in the same user space as the stroke.
        func screenUnits(_ value: Double) -> CGFloat { CGFloat(value) / CGFloat(zoomScale) }

        func stroke(_ colour: UIColor, width: Double) {
            context.setStrokeColor(colour.cgColor)
            context.setLineWidth(screenUnits(width))
            context.beginPath()
            context.addLines(between: points)
            context.strokePath()
        }

        let glow = UIColor(
            red: route.palette.glow.red, green: route.palette.glow.green,
            blue: route.palette.glow.blue, alpha: RouteGeometry.Design.glowOpacity
        )
        let core = UIColor(
            red: route.palette.core.red, green: route.palette.core.green,
            blue: route.palette.core.blue, alpha: RouteGeometry.Design.coreOpacity
        )

        // The glow. `setShadow` at zero offset is CoreGraphics' native equivalent of MapLibre's
        // `line-blur` — a genuinely blurred copy of the stroke sitting under it, rather than a
        // wider low-alpha stroke faking the falloff.
        context.saveGState()
        context.setShadow(
            offset: .zero,
            blur: screenUnits(RouteGeometry.Design.glowBlur),
            color: glow.cgColor
        )
        stroke(glow, width: RouteGeometry.Design.glowWidth)
        context.restoreGState()

        stroke(core, width: RouteGeometry.Design.coreWidth)
    }
}
