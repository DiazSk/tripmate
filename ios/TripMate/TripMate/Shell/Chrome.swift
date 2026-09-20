import Observation
import SwiftUI

/// Whether the tab bar is currently out of the way.
///
/// **Shared state rather than a binding chain, because three unrelated scrollers drive it** —
/// Home, the trips list and the plan sheet — and the bar lives above all of them in the shell.
/// Threading a binding through each would be three parameters on three views to carry one bool.
@MainActor
@Observable
final class Chrome {
    private(set) var barCompact = false

    /// Last offset we judged against, not the last one seen: comparing against every frame makes
    /// a single finger-tremor flip the bar.
    @ObservationIgnored private var anchor: CGFloat = 0

    /// **8pt of travel before it reacts.** Below that a scroll view's own rubber-banding at the
    /// top of a list toggles it on its own, which reads as the bar flickering while you hold
    /// still.
    private static let threshold: CGFloat = 8

    func scrolled(to offset: CGFloat) {
        // Near the top the bar is always full. Otherwise the top of a list would show a shrunken
        // bar purely because you arrived there by scrolling up.
        guard offset > 24 else {
            anchor = offset
            if barCompact { withAnimation(.snappy(duration: 0.3, extraBounce: 0.1)) { barCompact = false } }
            return
        }
        let delta = offset - anchor
        guard abs(delta) > Self.threshold else { return }
        anchor = offset
        let next = delta > 0
        guard next != barCompact else { return }
        withAnimation(.snappy(duration: 0.3, extraBounce: 0.1)) { barCompact = next }
    }
}

extension View {
    /// Report this scroll view's offset to the chrome, so the bar can get out of the way.
    func shrinksTabBar(_ chrome: Chrome) -> some View {
        onScrollGeometryChange(for: CGFloat.self) { $0.contentOffset.y } action: { _, offset in
            chrome.scrolled(to: offset)
        }
    }
}
