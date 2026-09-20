import SwiftUI

/// How tall the sheet's content says it needs to be.
///
/// **A preference rather than a parameter, because the answer is known at the bottom of the
/// tree and needed at the top.** The wizard measures its own step inside a `ScrollView` — which
/// proposes unbounded height, so what comes back is the content's *ideal* height rather than the
/// height the sheet already forced on it. Measuring the constrained content would just report
/// the sheet's own height back to the sheet.
struct SheetFitKey: PreferenceKey {
    static let defaultValue: CGFloat? = nil

    static func reduce(value: inout CGFloat?, nextValue: () -> CGFloat?) {
        value = nextValue() ?? value
    }
}

extension View {
    /// Ask the sheet above to be this tall at its middle stop.
    func sheetFits(_ height: CGFloat) -> some View {
        preference(key: SheetFitKey.self, value: height)
    }
}

/// The plan over the map, at one of three heights.
///
/// **Hand-rolled, and the native sheet was tried first and photographed failing.** A SwiftUI
/// `.sheet` with `.presentationDetents` does work here — the map stays live behind it with
/// `.presentationBackgroundInteraction` — but it presents at window level and **covers the tab
/// bar**, which leaves the app with no navigation while a plan is open. Apps that ship both put
/// the tabs *inside* the sheet; that is a different design from the one chosen, and it would
/// undo P0.
///
/// The second reason is the same one that made the tab bar hand-rolled: the map has to inset its
/// framing by however tall this currently is, and a system sheet will not tell you. Here the
/// height is a value this view computes and publishes, so it cannot drift from what is drawn.
///
/// **It never covers the tab bar.** `large` stops short of it, so navigation is reachable at
/// every height — unlike a real sheet, deliberately.
struct PlanSheet<Content: View>: View {
    @Binding var detent: Detent
    /// What the content asked for, if it asked. `nil` keeps the flat 46%.
    var fitted: CGFloat?
    /// The space the sheet is allowed to live in — the shell's size, minus nothing.
    let available: CGSize
    let safeTop: CGFloat
    @ViewBuilder var content: () -> Content

    enum Detent: CaseIterable {
        case small, medium, large

        /// **`small` shows one line over a live map**, which is the composition the web cannot
        /// offer at any width on a phone. P7 replaces its content with the next stop and its walk;
        /// until then it is whatever the panel's own first row is.
        func height(in available: CGSize, safeTop: CGFloat, fitted: CGFloat? = nil) -> CGFloat {
            let large = available.height - safeTop - Token.barHeight - Token.gapRows * 2
            switch self {
            case .small: return 132
            // **The middle stop is the content's own height when it states one.** A flat 46%
            // is right for a day of an itinerary, which is a list that always overflows; it is
            // wrong for a four-field form, which then sits in the top third of a box it does
            // not fill. Clamped both ways: shorter than `small` is not a sheet, and taller than
            // `large` would cover the tab bar.
            case .medium: return min(max(fitted ?? available.height * 0.46, 132), large)
            // Stops clear of the status bar *and* the tab bar. A real sheet would cover both.
            case .large: return large
            }
        }
    }

    @GestureState private var drag: CGFloat = 0

    private var height: CGFloat {
        let target = detent.height(in: available, safeTop: safeTop, fitted: fitted)
        let bounds = Detent.allCases.map {
            $0.height(in: available, safeTop: safeTop, fitted: fitted)
        }
        // Rubber-band rather than hard-stop: a drag past the end that simply refuses to move
        // reads as a broken gesture rather than as a limit.
        return min(max(target - drag, bounds.min()! - 40), bounds.max()! + 40)
    }

    var body: some View {
        VStack(spacing: 0) {
            grabber
            content()
                // The grabber is already 44pt of clearance, so the content's own top inset is
                // paid twice here. At the small detent that is a third of the sheet.
                .padding(.top, -Token.padCompact)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .clipped()
        }
        // **Material before the frame that fills, and the order is the whole bug.** With
        // `.glassPanel()` after the expanding frame it paints the expanded rectangle — the glass
        // covered the entire display and the sheet's own height did nothing.
        .frame(height: height, alignment: .top)
        .glassPanel()
        .padding(.horizontal, Token.padCompact)
        // Sits on the tab bar's shoulder rather than under it.
        .padding(.bottom, Token.barHeight + Token.gapRows * 2)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .animation(.spring(response: 0.34, dampingFraction: 0.86), value: detent)
        // A step with more questions than the last is a taller sheet, and it should grow
        // rather than cut to the new height.
        .animation(.spring(response: 0.34, dampingFraction: 0.86), value: fitted)
    }

    private var grabber: some View {
        Capsule()
            .fill(Token.muted)
            .frame(width: 36, height: 5)
            // **A 44pt strip, not the 36x5 mark.** `DESIGN.md:549` sets 44 as the touch-target
            // floor and it is the floor here too — at the drawn size the gesture missed a
            // deliberate, slow drag aimed straight at it.
            .frame(maxWidth: .infinity, minHeight: 44)
            .contentShape(Rectangle())
            .gesture(
                DragGesture()
                    .updating($drag) { value, state, _ in state = value.translation.height }
                    .onEnded { value in
                        // Snap to whichever detent the release lands nearest, with the velocity
                        // folded in so a flick travels further than a slow drag of the same length.
                        let released = detent
                            .height(in: available, safeTop: safeTop, fitted: fitted)
                            - value.translation.height - value.velocity.height * 0.12
                        detent = Detent.allCases.min {
                            let a = $0.height(in: available, safeTop: safeTop, fitted: fitted)
                            let b = $1.height(in: available, safeTop: safeTop, fitted: fitted)
                            return abs(a - released) < abs(b - released)
                        } ?? detent
                    }
            )
            .accessibilityLabel("Plan panel")
            .accessibilityValue(detent == .small ? "collapsed" : detent == .medium ? "half" : "full")
            .accessibilityAdjustableAction { direction in
                let order = Detent.allCases
                guard let i = order.firstIndex(of: detent) else { return }
                let next = direction == .increment ? i + 1 : i - 1
                if order.indices.contains(next) { detent = order[next] }
            }
    }

    /// What the map must keep clear at the bottom, measured from the screen's edge.
    static func obstruction(
        _ detent: Detent, in available: CGSize, safeTop: CGFloat, fitted: CGFloat? = nil
    ) -> CGFloat {
        detent.height(in: available, safeTop: safeTop, fitted: fitted)
            + Token.barHeight + Token.gapRows * 2
    }
}
