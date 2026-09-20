import SwiftUI

/// How much of the display the panel is covering, measured rather than assumed.
///
/// The camera has to know this: a route framed at the viewport's centre puts half the day under
/// the panel and leaves a matching band of dead space on the other side. The web renderer
/// measures the panel's *real* edge for the same reason, rather than hardcoding the 40% — the
/// panel clamps to a 360-520pt range, so the fraction it actually occupies changes with the
/// display.
struct PanelMetrics: Equatable, Sendable {
    var viewWidth: CGFloat = 0
    /// The strip left over for the map. Equal to `viewWidth` when the panel is full-bleed, which
    /// is the phone layout — there is no strip to aim at and centred framing is correct.
    var freeWidth: CGFloat = 0

    /// What the chrome covers at the bottom, from the screen's edge.
    ///
    /// **Measured rather than a token, and that is the difference from the tab bar.** The bar is
    /// the same height on every screen at every width, so it is a constant and `Token.barHeight`
    /// is the whole story. The sheet is not: it is 132pt or 46% or nearly the display, and it
    /// changes under a drag. A value that moves is exactly what this type exists to carry.
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
