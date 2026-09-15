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
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    override func prepareForReuse() {
        super.prepareForReuse()
        label.text = nil
    }

    override var annotation: MKAnnotation? {
        didSet {
            label.text = annotation?.title ?? nil
            // Sized to the text so `collisionMode = .circle` has a real footprint to work with;
            // a zero-sized view would never be decluttered against anything.
            frame.size = systemLayoutSizeFitting(UIView.layoutFittingCompressedSize)
            // The card sits above the point it names rather than centred on it, so the ground
            // rings under it stay visible.
            centerOffset = CGPoint(x: 0, y: -(frame.height / 2) - 8)
        }
    }
}
