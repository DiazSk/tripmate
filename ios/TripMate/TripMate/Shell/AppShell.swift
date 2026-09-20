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
struct AppShell<World: View, Panel: View, Home: View>: View {
    /// Which surface is showing. A binding rather than internal state: `RootView` owns it,
    /// because the panel's own content depends on it too.
    @Binding var tab: AppTab
    /// Whether the panel floats over the map, or covers it.
    ///
    /// **Only an open trip floats.** Every other surface is a page and takes the whole screen,
    /// the way the landing already does: a memories wall, a profile or a form has no relationship
    /// to the ground behind it, so a sheet there is a smaller page over scenery nobody is reading.
    /// A trip is the one thing that *is* about the map — the day is drawn on it — so that is the
    /// one thing the glass floats over.
    var panelFloats: Bool
    @ViewBuilder var world: () -> World
    @ViewBuilder var panel: () -> Panel
    @ViewBuilder var home: () -> Home

    @State private var exclusions = ShellExclusions()
    @State private var detent: SheetDetent = .medium
    /// Read here rather than inside the sheet, because the map's bottom inset is
    /// computed at this level too and both have to agree on one number.
    @State private var fitted: CGFloat?
    @State private var chrome = Chrome()

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
            // **`tab == .trips`, not `tab != .home`.** `panelFloats` answers "is a trip
            // open", which stays true while you are standing on Profile — so tapping Profile
            // with a trip open drew the profile inside the trip's floating panel. Trips is the
            // only tab that ever shows a trip or the wizard; nothing else can float.
            let floats = panelFloats && tab == .trips
            // Docking is the wide-screen answer to "the panel is covering the map", so it only
            // applies to the panel that is over the map at all.
            let isDocked = floats && proxy.size.width >= Self.dockingThreshold
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
                // wordmark straight over the clock. The same rule now keeps the tab bar off the
                // home indicator — same mistake, opposite edge.
                Token.canvas
                    .ignoresSafeArea()

                world()
                    .ignoresSafeArea()

                if tab == .home {
                    // **Home covers the map rather than floating over it.** The landing brings
                    // its own photography and the map behind it would be a second world showing
                    // through the first. The map stays mounted — it is one view for the app and
                    // rebuilding it per tab is the expensive mistake — it is simply not visible.
                    home()
                } else if isDocked {
                    // **The docked layout keeps the panel and does not get a sheet.** A sheet
                    // answers "the panel is covering the map"; at >=600pt it is not, and there is
                    // already live map beside it. Dragging a full-height column up and down would
                    // be motion in answer to a problem this width does not have.
                    HStack(spacing: 0) {
                        Spacer(minLength: 0)
                        panel()
                            .glassPanel()
                            .padding(.bottom, Token.barHeight + Token.gapRows)
                            .padding([.horizontal, .top], Token.padCompact)
                            .frame(width: panelWidth)
                    }
                } else if floats {
                    PlanSheet(
                        detent: $detent,
                        fitted: fitted,
                        available: proxy.size,
                        safeTop: proxy.safeAreaInsets.top,
                        content: panel
                    )
                } else {
                    // A page, on its own ground. `safeAreaInset` rather than bottom padding: it
                    // reaches the scroll views *inside* the page, so content passes under the
                    // glass bar and still stops above it — padding out here would leave a dead
                    // band the bar floats in.
                    panel()
                        .safeAreaInset(edge: .bottom) {
                            Color.clear.frame(height: Token.barHeight + Token.gapRows)
                        }
                        .background(Token.canvas.ignoresSafeArea())
                }

                ChromeLayer(tab: $tab, compact: chrome.barCompact)
            }
            // Measured rather than assumed, and set here because this is where the size is known.
            // The camera needs the panel's *real* edge: the panel clamps to a 360-520pt range, so
            // the fraction it occupies changes with the display, and a hardcoded 40% would frame
            // routes against an edge that is not there.
            .environment(
                \.panelMetrics,
                PanelMetrics(
                    detent: floats && !isDocked ? detent : .large,
                    viewWidth: proxy.size.width,
                    freeWidth: isDocked ? proxy.size.width - panelWidth : proxy.size.width,
                    // The tab bar alone where there is no sheet — the Map tab, and every docked
                    // width. The sheet's own height where there is one.
                    bottomInset: !floats || isDocked
                        ? Token.barHeight + Token.gapRows
                        : PlanSheet<Panel>.obstruction(
                            detent, in: proxy.size, safeTop: proxy.safeAreaInsets.top,
                            fitted: fitted
                        )
                )
            )
        }
        // The wizard states its height at the bottom of the tree; preferences travel up,
        // so this is the first place that can see it and also owns the map's inset.
        .onPreferenceChange(SheetFitKey.self) { fitted = $0 }
        .environment(chrome)
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
///
/// **The wordmark that used to head this is gone.** It held nothing — no buttons, no back, no
/// tabs, just `Text("TripMate")` — while every screen already draws its own large title
/// underneath it. A persistent bar naming the app is a web habit; the icon on the home screen
/// does that job here, and the ~56pt it cost at the top of every phone screen now goes to the
/// bar at the bottom, which at least navigates.
private struct ChromeLayer: View {
    @Binding var tab: AppTab
    let compact: Bool

    var body: some View {
        VStack(spacing: 0) {
            // **No search box here any more, and `MapSearchView` has no call site.** It was
            // drawn under the Map tab, which is cut — see `AppTab`. Left standing rather than
            // deleted because P2 is where it comes back, and re-finding it in history is worse
            // than a view that waits.
            Spacer()

            TabBar(selection: $tab, compact: compact)
                .padding(.horizontal, Token.padCompact)
                // Sitting on the safe area's own bottom edge. The safe area already holds it
                // clear of the home indicator, so no gutter of ours is needed on top of it.
                .padding(.bottom, 0)
        }
    }
}
