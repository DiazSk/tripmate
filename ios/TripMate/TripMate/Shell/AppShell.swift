import SwiftUI

/// The app's one shell, ported from `src/components/AppShell.tsx`.
///
/// The web version stacks four layers by z-index: the map at 0, the world-pinned stop markers at
/// 5, a scrollable content overlay at 10 holding the docked plan panel, and app chrome at 20. Two
/// of those four translate and two do not:
///
/// - **The ordering is the design, and it ports exactly.** Markers sit *below* the panel because
///   they belong to the world behind the glass, so a panel occludes them the same way it occludes
///   the map. Putting them above was tried on the web and read wrong immediately.
/// - **The `pointer-events-none` machinery does not port, and good.** On the web the content
///   overlay spans the viewport, so without it every gesture lands there and the map canvas never
///   sees one — which then removes the overlay from hit-testing and breaks scrolling, needing a
///   second rule to undo. SwiftUI hit-tests the view that actually draws, so that mechanism and
///   both of its documented failure modes have no analogue here.
///
/// **The map is always full-bleed and the panel floats over it.** Not a split: `DockedPanel` on
/// the web is `fixed`, sitting *over* the globe rather than beside it, and the camera compensates
/// by framing routes clear of the panel instead of the layout carving space out. Copying that
/// keeps one map, one camera and one set of framing rules at every width.
///
/// ### Why this is hand-rolled rather than `ArrangementView`
///
/// iOS 27's `ArrangementView` is exactly this composition as a system container, and the iOS 27.0
/// SDK **does not declare it** — it exists as an exported symbol in `SwiftUICore.tbd` but appears
/// in no swiftinterface, so nothing can compile against it. See `ShellExclusions` for the same
/// story about `reservedRegions`.
///
/// This is not a workaround to unpick later. The layout below is driven entirely by the size it
/// is given and contains no fold-specific branch, which is what the design called for regardless;
/// adopting `ArrangementView` when it becomes declared API replaces one `ZStack`.
struct AppShell<World: View, Panel: View>: View {
    @ViewBuilder var world: () -> World
    @ViewBuilder var panel: () -> Panel

    @State private var exclusions = ShellExclusions()

    /// Below this width the panel covers the map; at or above it, the panel docks and leaves live
    /// map beside it.
    ///
    /// **600pt, derived rather than copied.** The web app switches at its `sm` breakpoint of
    /// 640px, and reusing that number here would be a real defect on the device this app is being
    /// shaped for: an unfolded iPhone Duo is **626pt** wide, so a 640 threshold would give it a
    /// full-bleed panel and no visible map — losing precisely the composition the form factor
    /// exists to enable.
    ///
    /// So the number comes from the parts instead: the panel's own 360pt floor, plus ~240pt of map
    /// — about a third of the width, enough to read a day's shape against. Unfolded Duo clears it
    /// at 626 and keeps 266pt of map; folded, at 466pt, it does not and the panel takes the
    /// screen. That is the same behaviour the web app's breakpoint describes, arrived at from this
    /// display's dimensions rather than a browser's.
    static var dockingThreshold: CGFloat { Token.panelMinWidth + 240 }

    var body: some View {
        GeometryReader { proxy in
            let isDocked = proxy.size.width >= Self.dockingThreshold
            let panelWidth = isDocked ? Self.panelWidth(in: proxy.size.width) : proxy.size.width

            ZStack {
                // Behind everything, including before the map has produced a frame. The web shell
                // does the same with `bg-canvas`: a map that has not streamed its first tile must
                // never show through to white.
                //
                // **Only the world ignores the safe area.** The map is full-bleed by design — it
                // is scenery, and letterboxing it would waste the display the whole composition
                // is built around. The panel and the chrome are *read*, so they stay inside it:
                // an earlier revision ignored the safe area on the whole shell and drew the
                // wordmark straight over the clock.
                Token.canvas
                    .ignoresSafeArea()

                world()
                    .ignoresSafeArea()

                if isDocked {
                    HStack(spacing: 0) {
                        Spacer(minLength: 0)
                        panel().frame(width: panelWidth)
                    }
                } else {
                    panel()
                }

                ChromeLayer()
            }
            // Measured rather than assumed, and set here because this is where the size is known.
            // The camera needs the panel's *real* edge: the panel clamps to a 360-520pt range, so
            // the fraction it occupies changes with the display, and a hardcoded 40% would frame
            // routes against an edge that is not there.
            .environment(
                \.panelMetrics,
                PanelMetrics(
                    viewWidth: proxy.size.width,
                    freeWidth: isDocked ? proxy.size.width - panelWidth : proxy.size.width
                )
            )
        }
        .environment(\.shellExclusions, exclusions)
        // One measurement of the hardware for the whole app; a second measurer would eventually
        // disagree with the first. Currently always empty — see `ShellExclusions`.
        .onGeometryChange(for: ShellExclusions.self) { proxy in
            proxy.activeExclusions()
        } action: { exclusions = $0 }
    }

    /// `w-[40%] min-w-[360px] max-w-[520px]`, straight from `DockedPanel`.
    static func panelWidth(in available: CGFloat) -> CGFloat {
        min(max(available * Token.panelFraction, Token.panelMinWidth), Token.panelMaxWidth)
    }
}

/// App chrome: above both the world and the panel, and deliberately outside the docking branch.
///
/// The web shell makes the navbar and map controls siblings of the content overlay rather than
/// children, so a page's own content column cannot move them. Same reasoning here: chrome is a
/// property of the app, not of whichever pane happens to be wide.
private struct ChromeLayer: View {
    @Environment(\.panelMetrics) private var panelMetrics

    /// "Search near this view" needs a view to be near. At full-bleed panel widths there is no
    /// live map, so the box would be chrome floating over the plan it is covering — which is the
    /// compromise `DESIGN.md` records the web app making on a phone, and it does not have to be
    /// made here.
    private var hasLiveMap: Bool { panelMetrics.freeWidth < panelMetrics.viewWidth }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("TripMate")
                    .textStyle(.heading)
                    .foregroundStyle(Token.foreground)
                Spacer()
            }
            .padding(.horizontal, Token.padCompact)
            .padding(.vertical, Token.gapRows)
            .background(.ultraThinMaterial)

            // Under the wordmark on the leading edge, where the web puts it — the docked panel
            // owns the trailing side at every width that has one.
            if hasLiveMap {
                HStack {
                    MapSearchView()
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, Token.padCompact)
                .padding(.top, Token.gapRows)
            }

            Spacer()
        }
    }
}
