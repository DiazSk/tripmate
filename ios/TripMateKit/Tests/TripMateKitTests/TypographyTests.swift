import XCTest
@testable import TripMateKit

/// The guards that make the type scale's third shipped defect its last.
///
/// Three values were transcribed from a *superseded* version of the design before these existed:
/// the retired teal/amber palette, `.kerning(-2.5)` (the retired face's tracking), and
/// `.system(size: 28, weight: .semibold)` where the spec is Melodrama at 400. Each was invisible
/// to the compiler and to every test. These are the cheapest things that would have caught the
/// last two.
final class TypographyTests: XCTestCase {

    /// Every style the app can use. A new one must be added here, which is the point — the
    /// coverage tests below are only as good as this list.
    private static let scale: [(name: String, style: TextStyle)] = [
        ("display", .display), ("title", .title), ("heading", .heading),
        ("headingSmall", .headingSmall), ("bodyLarge", .bodyLarge), ("body", .body),
        ("detail", .detail), ("caption", .caption), ("micro", .micro), ("label", .label),
        ("money", .money), ("moneyLarge", .moneyLarge),
    ]

    // MARK: - The defect that shipped

    /// **Tracking resolves as `em × size`, and nothing may hand-write it in points.**
    ///
    /// The bug was `.kerning(-2.5)` at 28pt — -0.089em, against the spec's -0.018em. Five times
    /// too tight, and close enough to the retired face's -0.076em to show where it came from.
    func testTrackingIsAlwaysTheEmValueTimesThePointSize() {
        for (name, style) in Self.scale {
            XCTAssertEqual(
                style.tracking, style.trackingEm * style.size, accuracy: 1e-9,
                "\(name) resolved tracking must be em × size"
            )
        }
    }

    /// The four `--tracking-*` tokens from `globals.css:367-370`, transcribed exactly. If one of
    /// these drifts, the stylesheet and the app disagree and nothing else will say so.
    func testTrackingTokensMatchTheStylesheet() {
        XCTAssertEqual(TextStyle.display.trackingEm, -0.018)      // --tracking-display
        XCTAssertEqual(TextStyle.heading.trackingEm, -0.012)      // --tracking-heading
        XCTAssertEqual(TextStyle.body.trackingEm, 0)              // --tracking-body
        XCTAssertEqual(TextStyle.label.trackingEm, 0.18)          // --tracking-label
    }

    /// The display style at 28pt must resolve to about -0.50pt, **not** -2.5.
    func testTheDisplayStyleResolvesToTheValueTheBugGotWrong() {
        XCTAssertEqual(TextStyle.display.tracking, -0.504, accuracy: 0.001)
        XCTAssertGreaterThan(TextStyle.display.tracking, -1, "nowhere near the -2.5 that shipped")
    }

    /// The label is the only positive tracking in the system, and `.kerning(0.6)` shipped where
    /// `0.18em` at 10pt is 1.8pt — three times too tight.
    func testTheLabelTracksWideNotTight() {
        XCTAssertEqual(TextStyle.label.tracking, 1.8, accuracy: 0.001)
    }

    // MARK: - Rules from DESIGN.md, encoded rather than commented

    /// **`globals.css:1600`: Melodrama's thin strokes vanish below about 28px**, which is why the
    /// 16-24px heading step stays in Switzer. A comment cannot enforce that; this can.
    func testMelodramaIsNeverUsedBelowItsLegibilityFloor() {
        for (name, style) in Self.scale where style.face == .melodrama {
            XCTAssertGreaterThanOrEqual(
                style.size, 28,
                "\(name) sets Melodrama at \(style.size)pt — its strokes vanish below 28"
            )
        }
    }

    /// **Weight 600 on Melodrama is a known-rejected value** — `globals.css:2232`: "at 600 the
    /// thin strokes thicken toward the thick ones and the face stops being the reason it was
    /// chosen." The app shipped the equivalent as `.semibold`.
    func testMelodramaNeverRunsHeavierThanRegular() {
        for (name, style) in Self.scale where style.face == .melodrama {
            XCTAssertLessThanOrEqual(style.wght, 400, "\(name) sets Melodrama at \(style.wght)")
        }
    }

    /// A weight outside the file's axis silently clamps at render time, so a style that asks for
    /// one is a value nobody will see honoured.
    func testEveryStyleAsksForAWeightItsFaceActuallyHas() {
        for (name, style) in Self.scale {
            XCTAssertTrue(
                style.face.weightRange.contains(style.wght),
                "\(name) wants \(style.wght), outside \(style.face.weightRange)"
            )
        }
    }

    /// Figures go in the face that exists for them, replacing `.monospacedDigit()` on the system
    /// face. Both money styles, and only those, are Tabular.
    func testFiguresUseTheFigureFace() {
        XCTAssertEqual(TextStyle.money.face, .tabular)
        XCTAssertEqual(TextStyle.moneyLarge.face, .tabular)
        for (name, style) in Self.scale where style.face == .tabular {
            XCTAssertTrue(name.hasPrefix("money"), "\(name) uses Tabular but is not a figure style")
        }
    }

    // MARK: - The derivations

    /// Resizing keeps the `em`, so tracking follows the size rather than being frozen at the
    /// original. This is what makes `.money.size(16)` safe at a call site.
    func testResizingRescalesTrackingRatherThanKeepingIt() {
        let resized = TextStyle.display.size(56)
        XCTAssertEqual(resized.trackingEm, -0.018, "the em is the spec and does not change")
        XCTAssertEqual(resized.tracking, -1.008, accuracy: 0.001, "the points follow the size")
    }

    func testWeightAndSizeChangeNothingElse() {
        let base = TextStyle.detail
        let heavier = base.weight(TextStyle.semibold)
        XCTAssertEqual(heavier.wght, 600)
        XCTAssertEqual(heavier.face, base.face)
        XCTAssertEqual(heavier.size, base.size)
        XCTAssertEqual(heavier.trackingEm, base.trackingEm)
    }

    /// Line height is a multiple, as CSS states it — never points. The app converts to SwiftUI's
    /// `lineSpacing` against the loaded font's own metrics, which cannot be done here.
    func testLineHeightsAreMultiplesInAPlausibleRange() {
        for (name, style) in Self.scale {
            XCTAssertTrue(
                (1.0...1.6).contains(style.lineHeight),
                "\(name) has line height \(style.lineHeight), which reads as points not a multiple"
            )
        }
    }
}
