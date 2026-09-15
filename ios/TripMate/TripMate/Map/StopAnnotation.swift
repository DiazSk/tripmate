import MapKit
import TripMateKit
import UIKit

final class StopAnnotation: NSObject, MKAnnotation {
    let coordinate: CLLocationCoordinate2D
    let title: String?
    let dayIndex: Int
    /// Compared against for emphasis — the drawn index, which is what the route's legs are in.
    let indexWithinDay: Int
    /// Reported back when this card is tapped, because the panel counts in raw indices.
    let rawIndex: Int

    init(stop: RouteStop) {
        self.coordinate = CLLocationCoordinate2D(
            latitude: stop.point.lat, longitude: stop.point.lng
        )
        self.title = stop.name
        self.dayIndex = stop.dayIndex
        self.indexWithinDay = stop.indexWithinDay
        self.rawIndex = stop.rawIndex
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

    /// The stop being pointed at, in the accent. `--accent` means "you are pointing at this" and
    /// nothing else, so an emphasised stop also ignores the distance reveal below — a stop
    /// somebody selected is named whether or not the camera is close enough to have earned it.
    var isEmphasised = false {
        didSet {
            guard isEmphasised != oldValue else { return }
            applyPalette()
            apply(distanceM: lastDistanceM)
        }
    }

    override init(annotation: MKAnnotation?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)

        // MapKit's own collision handling, in place of the web's hand-rolled scan. A suppressed
        // card loses its *name*, not its presence — the dot is a subview drawn at full opacity
        // regardless, which is the same guarantee the web layer makes.
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
        // Scaling has to pivot on the card's bottom edge, not its middle, or the card drifts off
        // the dot it names as it shrinks. The layout below sets `position` to match.
        blur.layer.anchorPoint = CGPoint(x: 0.5, y: 1)

        addSubview(blur)
        blur.contentView.addSubview(label)

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

    /// Laid out by hand rather than by constraints, and that is a deletion.
    ///
    /// Eight constraints used to pin the card to the view's bounds, which made the view's size the
    /// card's size and left nowhere for a scale pivot to live: `anchorPoint` reinterprets what
    /// `position` means, and autolayout sets `center` assuming the default. The card's size is one
    /// label plus padding, so computing it directly is both shorter and what the scale needs.
    override func layoutSubviews() {
        super.layoutSubviews()
        blur.bounds = CGRect(origin: .zero, size: Self.cardSize(for: label))
        blur.layer.position = CGPoint(x: bounds.midX, y: bounds.maxY)
        label.frame = blur.bounds.insetBy(dx: Self.cardPadding.width, dy: Self.cardPadding.height)
        // The card is lifted above the coordinate by `centerOffset`; the dot goes back down to it.
        dot.center = CGPoint(x: bounds.midX, y: bounds.height + Self.cardGap)
    }

    /// Fade and shrink the name with camera distance — `Framing.Reveal`, which is where the rule
    /// and its band live so the map and a test read the same numbers.
    ///
    /// **Only the card moves; the dot never does.** A name is a claim about a building and earns
    /// the screen when the building is something you can see, while the stop's presence is not
    /// conditional on anything. That split is the web layer's too.
    func apply(distanceM: Double) {
        lastDistanceM = distanceM
        if isEmphasised {
            blur.alpha = 1
            blur.transform = .identity
            return
        }
        blur.alpha = CGFloat(Framing.Reveal.opacity(atDistanceM: distanceM))
        let scale = CGFloat(Framing.Reveal.scale(atDistanceM: distanceM))
        blur.transform = CGAffineTransform(scaleX: scale, y: scale)
    }

    private var lastDistanceM: Double = .greatestFiniteMagnitude

    /// The label's own size plus the chip's padding. `systemLayoutSizeFitting` used to answer this
    /// through the constraints that are now gone.
    private static func cardSize(for label: UILabel) -> CGSize {
        let text = label.intrinsicContentSize
        return CGSize(
            width: (text.width + cardPadding.width * 2).rounded(.up),
            height: (text.height + cardPadding.height * 2).rounded(.up)
        )
    }

    private static let cardPadding = CGSize(width: 7, height: 3)

    /// Gap between the dot and the card above it.
    private static let cardGap: CGFloat = 8

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    override func prepareForReuse() {
        super.prepareForReuse()
        label.text = nil
        isEmphasised = false
    }

    override var annotation: MKAnnotation? {
        didSet {
            label.text = annotation?.title ?? nil
            applyPalette()
            // Sized to the text so `collisionMode = .circle` has a real footprint to work with;
            // a zero-sized view would never be decluttered against anything.
            frame.size = Self.cardSize(for: label)
            // The card sits above the point it names rather than on top of it, so the dot below
            // stays visible.
            centerOffset = CGPoint(x: 0, y: -(frame.height / 2) - Self.cardGap)
        }
    }

    /// The dot takes the day's core colour, so the point and the line between points read as one
    /// thing — or the accent when this is the stop being pointed at. Derived from the day index
    /// rather than passed in: the annotation already carries it, and a second source would be a
    /// second thing to keep in step.
    private func applyPalette() {
        guard let stop = annotation as? StopAnnotation else { return }
        let fill = isEmphasised
            ? RouteGeometry.accent
            : RouteGeometry.palette(forDay: stop.dayIndex).core
        dot.backgroundColor = UIColor(
            red: fill.red, green: fill.green, blue: fill.blue,
            alpha: RouteGeometry.Design.dotOpacity
        )
        blur.layer.borderColor = isEmphasised
            ? UIColor(red: fill.red, green: fill.green, blue: fill.blue, alpha: 0.8).cgColor
            : UIColor(white: 1, alpha: 0.3).cgColor
    }
}
