import SwiftUI

/// How much of the display the panel is covering, measured rather than assumed.
///
/// The camera has to know this: a route framed at the viewport's centre puts half the day under
/// the panel and leaves a matching band of dead space on the other side. The web renderer
/// measures the panel's *real* edge for the same reason, rather than hardcoding the 40% — the
/// panel clamps to a 360-520pt range, so the fraction it actually occupies changes with the
/// display.
struct PanelMetrics: Equatable, Sendable {
    /// Which stop the sheet is at, for the content that has to answer to it.
    ///
    /// **On this value rather than in a second environment key**, because this is already the
    /// one thing that says what the chrome is doing, and `AppShell` already computes it. A page
    /// that is not in a sheet reads `.large` — it is not collapsed, which is the only question
    /// anyone asks of this.
    var detent: SheetDetent = .large
    var viewWidth: CGFloat = 0
    /// The strip left over for the map. Equal to `viewWidth` when the panel is full-bleed, which
    /// is the phone layout — there is no strip to aim at and centred framing is correct.
    var freeWidth: CGFloat = 0

    /// What the chrome covers at the bottom, from the screen's edge.
    ///
    /// **This used to say the bar was the exception — "the same height on every screen at every
    /// width, so it is a constant and `Token.barHeight` is the whole story".** It is not. The
    /// bar shrinks to 46 and is then drawn at 0.90 of that, so it covers 41.4 while the camera
    /// was being handed 56; and the bar sits inside the safe area while its one reader is
    /// full-bleed, so what it covers from the screen's edge is `safe.bottom` more again. Both
    /// terms are now in the value `AppShell` computes, via `TabBar.drawnHeight(compact:)`.
    ///
    /// So the sheet is not the exception either, it is merely the larger mover: 184pt or 53% or
    /// nearly the display, changing under a drag. A value that moves is what this type carries —
    /// and the lesson of the bar is that the other one was moving too, quietly.
    var bottomInset: CGFloat = 0
}

private struct PanelMetricsKey: EnvironmentKey {
    static let defaultValue = PanelMetrics()
}

extension EnvironmentValues {
    var panelMetrics: PanelMetrics {
        get { self[PanelMetricsKey.self] }
        set { self[PanelMetricsKey.self] = newValue }
    }
}
