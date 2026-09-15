import MapKit
import TripMateKit

/// One day's route, as a MapKit overlay.
///
/// A custom `MKOverlay` rather than `MKPolyline`, because the two things that make a route legible
/// here — the dark casing and the taper — are neither of them expressible on `MKPolylineRenderer`,
/// which has one width and one colour.
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
        // rect bounds the *centreline*, and the casing is drawn either side of it.
        self.boundingMapRect = rect.isNull ? .null : rect.insetBy(dx: -rect.width * 0.2 - 1000, dy: -rect.height * 0.2 - 1000)
        self.coordinate = points.first?.coordinate ?? CLLocationCoordinate2D()
    }
}

/// Draws a day's route: dark casing underneath, tapering coloured body on top.
///
/// **The casing is what makes it legible, not the brightness.** A stroke of colour has no
/// guaranteed contrast against uncontrolled cartography — Apple's map is green here and grey
/// there — while a stroke with a near-black border supplies its own wherever it lands. That was
/// learned on photorealistic satellite tiles and it holds just as well over vector cartography.
///
/// **The taper says which way the day runs before any animation does**, narrowing from the stop
/// being left toward the stop being arrived at. CoreGraphics has no per-vertex width, exactly as
/// Cesium had none, so each leg is cut into consecutive constant-width pieces — the same
/// technique, arrived at for the same reason.
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
        // width on screen instead of letting it grow with zoom.
        func screenWidth(_ width: Double) -> CGFloat { CGFloat(width) / CGFloat(zoomScale) }

        let widths = RouteGeometry.taperWidths()

        // Pass one: the casing, under everything. Drawn as a single stroke at the widest body
        // width plus the casing allowance — one pass rather than per-segment, because two
        // adjacent casing strokes would seam visibly at their join.
        context.setStrokeColor(
            red: RouteGeometry.casing.red,
            green: RouteGeometry.casing.green,
            blue: RouteGeometry.casing.blue,
            alpha: 0.9
        )
        context.setLineWidth(screenWidth(RouteGeometry.widthStart + RouteGeometry.casingWidth))
        context.beginPath()
        context.addLines(between: points)
        context.strokePath()

        // Pass two: the body, tapering per leg.
        for legIndex in 0..<(points.count - 1) {
            let from = points[legIndex]
            let to = points[legIndex + 1]
            for (segmentIndex, width) in widths.enumerated() {
                let t0 = Double(segmentIndex) / Double(widths.count)
                let t1 = Double(segmentIndex + 1) / Double(widths.count)
                context.setStrokeColor(
                    red: route.palette.core.red,
                    green: route.palette.core.green,
                    blue: route.palette.core.blue,
                    alpha: 1
                )
                context.setLineWidth(screenWidth(width))
                context.beginPath()
                context.move(to: Self.lerp(from, to, t0))
                context.addLine(to: Self.lerp(from, to, t1))
                context.strokePath()
            }
        }
    }

    private static func lerp(_ a: CGPoint, _ b: CGPoint, _ t: Double) -> CGPoint {
        CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t)
    }
}
