import SwiftUI

/// The app's four destinations.
///
/// **Home is the entry, Trips is what you kept, Map is the ground, Profile is the person.**
///
/// It was three. Home arrived with the landing, which is a real always-reachable screen carrying
/// the entry capsule rather than a first-run that vanishes — so it needed a home in the bar, and
/// the web's `/` is the entry point too. "Plan a trip" still is not a tab: it is an action, and
/// it now lives in the capsule on Home as well as the button on Trips.
enum AppTab: String, CaseIterable, Identifiable {
    case home, trips, map, profile

    var id: String { rawValue }

    /// Always drawn. Icon-only tabs fail at the first unfamiliar glyph and fail VoiceOver
    /// outright, and there are three of them — there is no width argument for hiding these.
    var label: String {
        switch self {
        case .home: "Home"
        case .trips: "Trips"
        case .map: "Map"
        case .profile: "Profile"
        }
    }

    var symbol: String {
        switch self {
        case .home: "house"
        case .trips: "bookmark"
        case .map: "map"
        case .profile: "person"
        }
    }
}

/// One bar, every screen — the rule `DESIGN.md:737` states and three rejected approaches defend.
///
/// **Hand-rolled rather than `TabView`, and the reason is the map.** A `TabView` here would have
/// to sit *inside* the shell's `ZStack` holding only panel content, because the map is mounted
/// once behind everything and a `TabView` whose tabs each contained it would mount three. Sitting
/// there, its bar is at the bottom of the panel's frame — and the map, which is outside it and
/// ignores the safe area, learns nothing about how tall that bar is. The camera would be back on
/// a transcribed constant that drifts from what is drawn, which is exactly the `navHeight = 44`
/// failure this phase exists to stop repeating. Here the height *is* `Token.barHeight`, read by
/// this `.frame` and by `WorldMapView.fit` and by nothing else.
///
/// **Liquid Glass is NOT among the costs, and an earlier reading of this said it was.**
/// `glassEffect`, `GlassEffectContainer`, `glassEffectID`, `glassEffectUnion` and
/// `glassEffectTransition` are all declared public API on `SwiftUICore` in the 27.0 SDK — a
/// `View` extension and a container, not a `TabView` affordance. So the material and the
/// selection morph are both reachable from here, and are used below. What is genuinely
/// `TabView`-only is *behaviour*: `tabBarMinimizeBehavior` (hand-rolled as `compact`), the
/// `tabViewBottomAccessory` slot, the `.search` tab role's separate pill, and the iPad sidebar
/// adaptation. None of those is the effect.
///
/// **What it does cost, stated rather than glossed:** there is no public `.isTab` trait, so
/// VoiceOver announces "Trips, selected, button" instead of "Trips, tab, one of four". That is a
/// real loss. Double-tap-to-scroll-to-top goes too, and it is not missed.
struct TabBar: View {
    @Binding var selection: AppTab
    /// Scrolling down shrinks the whole bar; scrolling up grows it back. **The hand-rolled
    /// stand-in for iOS 26's `tabBarMinimizeBehavior`**, which only applies to a system
    /// `TabView` — the thing this is not, for the reason in the docstring above.
    ///
    /// Both at once: the labels go **and** the whole bar scales down, so it reads as one thing
    /// getting out of the way rather than a row losing its captions. Scale alone kept the
    /// labels legible and made it look like a zoom; hiding alone left a full-height bar with
    /// nothing in it.
    var compact = false

    /// The namespace the pill flies across.
    ///
    /// **`glassEffectID` was tried here first and cross-faded instead of flying** — recorded and
    /// measured frame by frame: the old pill faded out at Home while a new one faded in at
    /// Profile, nothing crossed the bar. The pair never forms, because the two glass shapes are
    /// nested (the pill sits inside the `HStack` the bar's own `.glassEffect` is applied to)
    /// rather than being siblings in the container.
    ///
    /// **Making them siblings in a `ZStack` was worse.** Two `glassEffect`s stacked washed the
    /// whole bar out: every label went ghostly and the band headline behind showed through at
    /// full strength. `matchedGeometryEffect` is the older, duller primitive and it simply
    /// works, so the bar keeps one glass layer and the pill flies on geometry.
    @Namespace private var glass

    var body: some View {
        HStack(spacing: 0) {
            ForEach(AppTab.allCases) { tab in
                Button { selection = tab } label: {
                    cell(for: tab)
                }
                .buttonStyle(.plain)
            }
        }
        .frame(height: compact ? 46 : Token.barHeight)
        // **Real Liquid Glass, and `.ultraThinMaterial` was not it.** That is the pre-26 blur:
        // frosted, flat, no refraction of what passes behind it, no specular edge, no reaction
        // to a press. `glassPanel` still draws every other surface — this is the one place the
        // system material is worth the divergence, because the bar is the only chrome sitting
        // over moving content on every screen.
        //
        // Tinted with the same slate at the same alpha `glassPanel` uses, so the bar stays on
        // the Darken-Never-Lighten side of `DESIGN.md` rather than reading as a bright pane
        // laid over a dark app. Untinted glass over the map lightens it.
        .glassEffect(
            .regular.tint(Token.surfaceDeep.opacity(Token.panelOpacity)),
            in: Capsule()
        )
        .overlay(Capsule().strokeBorder(Token.cardBorder, lineWidth: 1))
        // Anchored to the bottom so the bar shrinks in place rather than sliding up as it goes.
        .scaleEffect(compact ? 0.90 : 1, anchor: .bottom)
        // **On the bar, not in the button, because the button is not the only way here.** The
        // landing footer's `+Memories` and `+Profile` set the tab, and so does pressing `Plan
        // it` on the capsule — three call sites, and a `withAnimation` in the tap handler
        // covered one of them, so the pill teleported from the other two.
        //
        // A spring with a little bounce rather than a duration curve: the pill should arrive
        // and settle, which is what separates a flight from a slide.
        .animation(.snappy(duration: 0.35, extraBounce: 0.12), value: selection)
    }

    private func cell(for tab: AppTab) -> some View {
        let isSelected = tab == selection
        return VStack(spacing: 2) {
            Image(systemName: isSelected ? "\(tab.symbol).fill" : tab.symbol)
                .textStyle(.detail)
                // The outline/fill swap is a different glyph, so by default it cuts. The system
                // bar dissolves it, and this is the modifier that does it.
                .contentTransition(.symbolEffect(.replace))
            if !compact {
                Text(tab.label)
                    .textStyle(.micro)
                    // A fixed-height bar cannot grow for Dynamic Type, so the label shrinks
                    // rather than clipping. Checked at AX3.
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .transition(.opacity)
            }
        }
        // `DesignTokens` lists "the selected day" among the accent's sanctioned uses — action and
        // current position, never a readout. A selected tab is that same class of thing.
        .foregroundStyle(isSelected ? Token.accent : Token.muted)
        .frame(maxWidth: .infinity)
        .frame(height: compact ? 46 : Token.barHeight)
        .background {
            if isSelected {
                Capsule()
                    .foregroundStyle(.clear)
                    // `.interactive()` belongs on the pill rather than the bar: the cell is what
                    // gets pressed, and on the bar it flexed the whole row under any tap.
                    .glassEffect(
                        .regular.tint(Token.accent.opacity(0.30)).interactive(),
                        in: Capsule()
                    )
                    .padding(6)
                    .matchedGeometryEffect(id: "selection", in: glass)
            }
        }
        // Without this a `.plain` button hit-tests only its drawn glyph and text, leaving most
        // of a third of the bar dead. `MapSearchView`'s result rows record the same finding.
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(tab.label)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}
