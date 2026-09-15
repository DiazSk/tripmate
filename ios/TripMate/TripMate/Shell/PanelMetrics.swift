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
