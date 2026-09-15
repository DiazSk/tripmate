import SwiftUI

/// The design system, ported from `DESIGN.md` rather than invented.
///
/// That file is rewritten from the built web app and is the source of truth for anything visual,
/// so these are transcriptions. When one disagrees with `DESIGN.md`, this file is the bug.
///
/// Only what the shell actually uses is here. The rest arrives with the screens that need it —
/// a token nothing references is a decision nobody made.
enum Token {

    // MARK: Colors

    /// `canvas` — the ground behind everything, including before the map has drawn a frame.
    static let canvas = Color(red: 0x09 / 255, green: 0x1b / 255, blue: 0x20 / 255)
    /// `surface-deep` — the slate every panel is made of.
    static let surfaceDeep = Color(red: 13 / 255, green: 46 / 255, blue: 55 / 255)
    /// `accent` — one warm accent, reserved for interaction. Never decorative.
    static let accent = Color(red: 0xfb / 255, green: 0x98 / 255, blue: 0x26 / 255)
    /// `card-border` — the 1px white hairline every surface carries.
    static let cardBorder = Color.white.opacity(0.12)
    static let muted = Color.white.opacity(0.6)

    /// `money` — gold, and **deliberately not `accent`**.
    ///
    /// The budget bar used to fill in amber, back when that was the one colour painting the
    /// primary button, the day label, this fill and the selected tab all at once. There was no way
    /// to tell an action from a readout, so a *healthy* budget at 90% rendered as a nearly-full bar
    /// in the please-click-me colour and read as an alarm. A figure is information, not an
    /// invitation, so it never borrows the action colour.
    static let money = Color(red: 0xe9 / 255, green: 0xb4 / 255, blue: 0x4c / 255)
    static let moneySoft = Color(red: 0xe9 / 255, green: 0xb4 / 255, blue: 0x4c / 255).opacity(0.18)
    /// `alert` — what the bar becomes over budget, where it also says so in words underneath.
    /// Nothing about the gold fill means "warning"; this does.
    static let alert = Color(red: 0xe4 / 255, green: 0x55 / 255, blue: 0x3f / 255)
    static let alertSoft = Color(red: 0xe4 / 255, green: 0x55 / 255, blue: 0x3f / 255).opacity(0.16)

    // MARK: Material

    /// `.glass-itinerary` — *the only card treatment in the app*; there is no solid-surface
    /// variant. The web spec is slate at 0.62 under a 56px saturated blur.
    ///
    /// On iOS the blur is a real `Material`, which is both cheaper and better than
    /// `backdrop-filter`: `DESIGN.md` records that every map frame re-blurs every panel above the
    /// canvas, and that whole hazard does not exist here because UIKit composites materials on
    /// the GPU without re-rasterising what is behind them.
    static let panelOpacity: Double = 0.62

    // MARK: Shape

    /// `rounded.lg` — 16px, the documented radius for every card and panel.
    static let radiusLarge: CGFloat = 16
    static let radiusMedium: CGFloat = 12
    static let radiusSmall: CGFloat = 6

    // MARK: Rhythm

    /// Panels pad at 20 and 24 from `sm` up.
    static let padCompact: CGFloat = 20
    static let padRegular: CGFloat = 24
    /// Stacked panels gap at 24; rows within a panel at 12-16; chips at 6.
    static let gapPanels: CGFloat = 24
    static let gapRows: CGFloat = 12

    /// The chrome bar's height, so the panel can clear it the way `--nav-h` does on the web.
    static let navHeight: CGFloat = 44

    // MARK: The docked panel

    /// `w-[40%] min-w-[360px] max-w-[520px]`, straight from `DockedPanel`.
    ///
    /// The bounds are what make the iPhone Duo interesting: unfolded is 626pt wide, so the panel
    /// takes its 360pt floor and leaves ~266pt of live map beside it. Folded is 466pt, where 40%
    /// is 186pt — under the floor — so the panel goes full-bleed and covers the map, which is
    /// exactly the behaviour the web app's `sm` breakpoint already describes.
    static let panelFraction: CGFloat = 0.40
    static let panelMinWidth: CGFloat = 360
    static let panelMaxWidth: CGFloat = 520
}

extension View {
    /// The one panel treatment: glass, hairline, 16px radius.
    func glassPanel(radius: CGFloat = Token.radiusLarge) -> some View {
        background(Token.surfaceDeep.opacity(Token.panelOpacity))
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(Token.cardBorder, lineWidth: 1)
            )
    }
}
