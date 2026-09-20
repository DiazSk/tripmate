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
/// **What that costs, stated rather than glossed:** there is no public `.isTab` trait, so
/// VoiceOver announces "Trips, selected, button" instead of "Trips, tab, one of four". That is a
/// real loss. Double-tap-to-scroll-to-top and iOS 26's scroll-to-minimise go too, and neither is
/// missed.
struct TabBar: View {
    @Binding var selection: AppTab
    /// Scrolling down hides the label and shrinks the bar to its icons; scrolling up brings it
    /// back. **The hand-rolled stand-in for iOS 26's `tabBarMinimizeBehavior`**, which only
    /// applies to a system `TabView` — the thing this is not, for the reason in the docstring
    /// above.
    var compact = false

    var body: some View {
        HStack(spacing: 0) {
            ForEach(AppTab.allCases) { tab in
                Button { selection = tab } label: {
                    cell(for: tab)
                }
                .buttonStyle(.plain)
            }
        }
        .frame(height: compact ? 40 : Token.barHeight)
        .glassPanel(radius: (compact ? 40 : Token.barHeight) / 2)
    }

    private func cell(for tab: AppTab) -> some View {
        let isSelected = tab == selection
        return VStack(spacing: 2) {
            Image(systemName: isSelected ? "\(tab.symbol).fill" : tab.symbol)
                .textStyle(.detail)
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
        .frame(height: compact ? 40 : Token.barHeight)
        // Without this a `.plain` button hit-tests only its drawn glyph and text, leaving most
        // of a third of the bar dead. `MapSearchView`'s result rows record the same finding.
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(tab.label)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}
