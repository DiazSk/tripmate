import Foundation

/// The three faces, and the machinery that makes a wrong value hard to write.
///
/// **This file exists because the same defect shipped three times.** Each was a value
/// transcribed from a *superseded* version of the design: the retired teal/amber palette, then
/// `.kerning(-2.5)` — which is -0.089em at 28pt, almost exactly the **retired** face's -0.076em
/// that `globals.css:366` records replacing — and then `.system(size: 28, weight: .semibold)`
/// where the spec is Melodrama at **400**. Correcting 66 literals would have invited a fourth.
///
/// So tracking is never written in points here. `TextStyle` holds it as the `em` the stylesheet
/// holds it as, and resolves `em × size` itself.
public enum Typeface: Sendable {
    /// Display serif. **Never below 28pt** — `globals.css:1600`: its thin strokes vanish there,
    /// "and the first build of this pass put a spindly serif wordmark in the navbar to prove it."
    case melodrama
    /// The text face. Everything structural, including the 16-24px heading step, which stays
    /// here *because* Melodrama cannot hold that size.
    case switzer
    /// Figures. Replaces `.monospacedDigit()`, which asked the system face for something this
    /// face is for.
    case tabular

    /// The PostScript name is not guessable from the file name — read off each file with
    /// `CTFontManagerCreateFontDescriptorsFromURL`, because two of the three default to a named
    /// instance nobody would predict (`SwitzerVariable-Regular_Thin`, `TabularVariable-Bold_Light`).
    public var fileName: String {
        switch self {
        case .melodrama: "melodrama-variable"
        case .switzer: "switzer-variable"
        case .tabular: "tabular-variable"
        }
    }

    /// **The default weight of every file is wrong for this design**, which is why nothing here
    /// uses `Font.custom` on its own: Melodrama's file defaults to 300 where the spec wants 400,
    /// and Tabular's to 700. Measured with `CTFontCopyVariationAxes`, not assumed.
    public var weightRange: ClosedRange<Float> {
        switch self {
        case .melodrama, .tabular: 300...700
        case .switzer: 100...900
        }
    }
}

/// One text role: a size, a weight on the variable axis, a tracking in `em`, and a line height
/// as a multiple — the four things the stylesheet states together.
///
/// There is deliberately **no initialiser taking tracking in points.** That is the whole guard.
public struct TextStyle: Sendable, Equatable {
    public var face: Typeface
    public var size: Double
    /// A `wght` axis value, not a `Font.Weight`. The axis is continuous and the stylesheet
    /// speaks in these numbers.
    public var wght: Float
    /// As `em`, exactly as `--tracking-*` states it.
    public var trackingEm: Double
    /// A multiple of the size, as CSS `line-height` states it.
    public var lineHeight: Double

    /// Resolved tracking. **The one place `em` becomes points.**
    public var tracking: Double { trackingEm * size }

    public func weight(_ value: Float) -> TextStyle {
        var copy = self
        copy.wght = value
        return copy
    }

    public func size(_ value: Double) -> TextStyle {
        var copy = self
        copy.size = value
        return copy
    }
}

// MARK: - The scale

public extension TextStyle {
    /// Common `wght` values, named. The axis takes any number in range; these are the three the
    /// design actually uses.
    static let regular: Float = 400
    static let medium: Float = 500
    static let semibold: Float = 600

    /// `.font-display-xl` (`globals.css:1655`) — Melodrama 400, `--tracking-display`, 1.04.
    /// The app's genuine display type: the memories wall's title, a trip's destination.
    ///
    /// **Weight 400, and 600 is a known-rejected value** — `globals.css:2232`: "at 600 the thin
    /// strokes thicken toward the thick ones and the face stops being the reason it was chosen."
    static let display = TextStyle(
        face: .melodrama, size: 28, wght: regular, trackingEm: -0.018, lineHeight: 1.04
    )

    /// The heading step, 16-24pt, in the text face — `.font-display` (`globals.css:1606`), which
    /// is the **sans** class despite its name. `--tracking-heading`.
    static let title = TextStyle(
        face: .switzer, size: 22, wght: semibold, trackingEm: -0.012, lineHeight: 1.15
    )
    static let heading = TextStyle(
        face: .switzer, size: 17, wght: semibold, trackingEm: -0.012, lineHeight: 1.2
    )
    static let headingSmall = TextStyle(
        face: .switzer, size: 15, wght: semibold, trackingEm: -0.012, lineHeight: 1.25
    )

    /// Body and below: `--tracking-body` is `0em`, so none of these track.
    static let bodyLarge = TextStyle(
        face: .switzer, size: 16, wght: regular, trackingEm: 0, lineHeight: 1.45
    )
    static let body = TextStyle(
        face: .switzer, size: 14, wght: regular, trackingEm: 0, lineHeight: 1.45
    )
    static let detail = TextStyle(
        face: .switzer, size: 13, wght: regular, trackingEm: 0, lineHeight: 1.45
    )
    static let caption = TextStyle(
        face: .switzer, size: 12, wght: regular, trackingEm: 0, lineHeight: 1.4
    )
    static let micro = TextStyle(
        face: .switzer, size: 11, wght: regular, trackingEm: 0, lineHeight: 1.4
    )

    /// `--tracking-label`, `0.18em` — the only positive tracking in the system, and the reason
    /// it is large is that these are uppercase micro-labels where the letters need air.
    static let label = TextStyle(
        face: .switzer, size: 10, wght: semibold, trackingEm: 0.18, lineHeight: 1.2
    )

    /// Figures, in the face that exists for them.
    static let money = TextStyle(
        face: .tabular, size: 13, wght: medium, trackingEm: 0, lineHeight: 1.3
    )
    static let moneyLarge = TextStyle(
        face: .tabular, size: 15, wght: semibold, trackingEm: 0, lineHeight: 1.3
    )
}

