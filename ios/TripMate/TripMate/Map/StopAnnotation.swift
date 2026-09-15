import MapKit
import TripMateKit
import UIKit

final class StopAnnotation: NSObject, MKAnnotation {
    let coordinate: CLLocationCoordinate2D
    let title: String?
    let dayIndex: Int
    let indexWithinDay: Int

    init(stop: RouteStop) {
        self.coordinate = CLLocationCoordinate2D(
            latitude: stop.point.lat, longitude: stop.point.lng
        )
        self.title = stop.name
        self.dayIndex = stop.dayIndex
        self.indexWithinDay = stop.indexWithinDay
    }
}

/// A stop's name, on a chip of glass.
///
/// **This is the one piece of the map that is better on iOS than on the web**, and by enough to be
/// worth saying. `DESIGN.md` records the web version's cost: the card is a DOM element whose
/// transform is rewritten every rendered frame, a `backdrop-filter` element owns a render surface,
/// and moving one re-rasterises everything behind it — once per frame, per card, up to fifteen at
/// a time, over a streaming tileset. The blur is documented there as "the first thing to cut" if
/// panning ever stutters.
///
/// `UIVisualEffectView` has none of that shape. UIKit composites materials on the GPU without
/// re-rasterising what is behind them, so the blur is free here in a way it never was there.
///
/// It also **deletes the declutter scan.** The web layer runs its own overlap pass every frame
/// against a 132×32pt threshold, because three stops in one day legitimately share a coordinate
/// — a hotel transfer, a hotel breakfast and a nearby errand are all "at the hotel". MapKit's
/// `collisionMode` and `displayPriority` do that natively, so a whole per-frame loop and its
/// tuning constants simply do not exist on this side.
final class StopAnnotationView: MKAnnotationView {
    static let reuseIdentifier = "stop"

    private let blur = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterialDark))
    private let label = UILabel()

    /// The stop's point on the map — MapLibre's `-dot` layer.
    ///
    /// **Here rather than as an `MKCircle` overlay, and that is the fix for a measured bug.** Two
    /// metre-radius circles per stop used to draw this, and metres are the wrong unit: across one
    /// real trip day spans run 82m to 67km, so a fixed 42m radius dominated one day and vanished
    /// on another. MapLibre's `circle-radius` is *pixels*, and an annotation view is already
    /// screen-space — so the dot is the same size at every zoom and the span stops mattering.
    /// It also removes two overlays per stop and adds no new type.
    ///
    /// Sits outside the card's bounds, at the coordinate the card is offset above. `MKAnnotationView`
    /// does not clip its subviews, so this needs no layout gymnastics.
    private let dot = UIView()

    override init(annotation: MKAnnotation?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)

        // MapKit's own collision handling, in place of the web's hand-rolled scan. A suppressed
        // card loses its *name*, not its presence — the ground rings are separate overlays drawn
        // for every stop regardless, which is the same guarantee the web layer makes.
        collisionMode = .circle
        // **`.required`, so MapKit never drops a stop's name.** `.defaultHigh` competes with the
        // basemap's own POI labels and loses in a dense centre — observed on Pienza, where the
        // card rendered at one zoom and was silently discarded at another. A stop the traveler
        // is reading about is not a candidate for decluttering against a shop MapKit happens to
        // know; collision between *our own* cards is still handled, by `collisionMode`.
        displayPriority = .required
        canShowCallout = false

        label.font = .systemFont(ofSize: 12, weight: .medium)
        label.textColor = UIColor(white: 0.96, alpha: 0.95)
        label.numberOfLines = 1

        // `map-glass` at 0.75 over the blur, per DESIGN.md. The fill carries the contrast; the
        // blur is what stops the chip reading as a box sitting *on* the map rather than
        // dissolving into it.
        blur.contentView.backgroundColor = UIColor(
            red: 10 / 255, green: 14 / 255, blue: 23 / 255, alpha: 0.75
        )
        blur.layer.cornerRadius = 5
        blur.layer.cornerCurve = .continuous
        blur.clipsToBounds = true
        blur.layer.borderWidth = 0.5
        blur.layer.borderColor = UIColor(white: 1, alpha: 0.3).cgColor

        blur.translatesAutoresizingMaskIntoConstraints = false
        label.translatesAutoresizingMaskIntoConstraints = false
        addSubview(blur)
        blur.contentView.addSubview(label)

        NSLayoutConstraint.activate([
            blur.leadingAnchor.constraint(equalTo: leadingAnchor),
            blur.trailingAnchor.constraint(equalTo: trailingAnchor),
            blur.topAnchor.constraint(equalTo: topAnchor),
            blur.bottomAnchor.constraint(equalTo: bottomAnchor),
            label.leadingAnchor.constraint(equalTo: blur.contentView.leadingAnchor, constant: 7),
            label.trailingAnchor.constraint(equalTo: blur.contentView.trailingAnchor, constant: -7),
            label.topAnchor.constraint(equalTo: blur.contentView.topAnchor, constant: 3),
            label.bottomAnchor.constraint(equalTo: blur.contentView.bottomAnchor, constant: -3),
        ])

        let diameter = RouteGeometry.Design.dotRadius * 2
        dot.bounds = CGRect(x: 0, y: 0, width: diameter, height: diameter)
        dot.layer.cornerRadius = RouteGeometry.Design.dotRadius
        dot.layer.borderWidth = RouteGeometry.Design.dotStrokeWidth
        // `circle-stroke-color: "#12110f"` — the redesign's near-black, which is what separates a
        // dot from cartography of any brightness.
        dot.layer.borderColor = UIColor(
            red: 0x12 / 255, green: 0x11 / 255, blue: 0x0f / 255, alpha: 1
        ).cgColor
        addSubview(dot)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        // The card is lifted above the coordinate by `centerOffset`; the dot goes back down to it.
        dot.center = CGPoint(x: bounds.midX, y: bounds.height + Self.cardGap)
    }

    /// Gap between the dot and the card above it.
    private static let cardGap: CGFloat = 8

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    override func prepareForReuse() {
        super.prepareForReuse()
        label.text = nil
    }

    override var annotation: MKAnnotation? {
        didSet {
            label.text = annotation?.title ?? nil
            // The dot takes the day's core colour, so the point and the line between points read
            // as one thing. Derived from the day index rather than passed in — the annotation
            // already carries it, and a second source would be a second thing to keep in step.
            if let stop = annotation as? StopAnnotation {
                let core = RouteGeometry.palette(forDay: stop.dayIndex).core
                dot.backgroundColor = UIColor(
                    red: core.red, green: core.green, blue: core.blue,
                    alpha: RouteGeometry.Design.dotOpacity
                )
            }
            // Sized to the text so `collisionMode = .circle` has a real footprint to work with;
            // a zero-sized view would never be decluttered against anything.
            frame.size = systemLayoutSizeFitting(UIView.layoutFittingCompressedSize)
            // The card sits above the point it names rather than on top of it, so the dot below
            // stays visible.
            centerOffset = CGPoint(x: 0, y: -(frame.height / 2) - Self.cardGap)
        }
    }
}
