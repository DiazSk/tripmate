import SwiftUI
import TripMateKit

/// The design system, ported from `DESIGN.md` rather than invented.
///
/// That file is rewritten from the built web app and is the source of truth for anything visual,
/// so these are transcriptions. When one disagrees with `DESIGN.md`, this file is the bug.
///
/// Only what the shell actually uses is here. The rest arrives with the screens that need it —
/// a token nothing references is a decision nobody made.
enum Token {

    // MARK: Colors

    /// `--canvas` — the ground behind everything, including before the map has drawn a frame.
    ///
    /// **"Kiln": a warm near-neutral near-black.** These four values were the *previous* palette
    /// until this edit — a teal-black canvas `#091b20` over surface `13 46 55` with an amber
    /// accent `#fb9826`. `globals.css` names those exact numbers as its predecessor and says why
    /// they went: they were measured off an external reference and derived from nothing this
    /// product is. Transcribing them into Swift shipped a retired palette to a second platform.
    static let canvas = Color(red: 0x12 / 255, green: 0x11 / 255, blue: 0x10 / 255)
    /// `--surface-deep` — `rgb(28 26 24)`, one step up from canvas. The panels, the map control
    /// pills and the photo scrims are all this one colour at different alphas, and that shared
    /// origin is what makes them read as one material rather than four similar greys.
    static let surfaceDeep = Color(red: 28 / 255, green: 26 / 255, blue: 24 / 255)
    /// `--accent` — jade, and **action only**: buttons, the selected day, focus rings, the stop
    /// being pointed at on the map. Never a label, never a figure, never a fill that reports a
    /// number. `money` and `alert` exist so it never has to.
    static let accent = Color(red: 0x28 / 255, green: 0xb9 / 255, blue: 0x81 / 255)
    /// `--accent-foreground` — dark ink *on the accent*, drawn from the accent's own hue so a
    /// filled control reads as a solid object rather than a hole punched through to the canvas.
    /// **Not "text over something dark"** — `globals.css` warns about exactly that conflation, and
    /// the day tabs were making it in reverse by printing `canvas` over the accent fill.
    static let accentForeground = Color(red: 0x06 / 255, green: 0x24 / 255, blue: 0x1a / 255)
    /// `--foreground` / `--on-deep` — warm off-white, not pure white. Pure white over a warm
    /// ground reads as a cold hole in it.
    static let foreground = Color(red: 0xf7 / 255, green: 0xf5 / 255, blue: 0xf2 / 255)
    /// `card-border` — the 1px white hairline every surface carries.
    static let cardBorder = Color.white.opacity(0.12)
    /// `--muted` — the foreground at 0.62, not a sampled grey: every secondary tone is the one
    /// off-white at an alpha over the one ground, which is what stops the greys drifting apart.
    static let muted = Color(red: 0xf7 / 255, green: 0xf5 / 255, blue: 0xf2 / 255).opacity(0.62)

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

    /// `--nav-h` — 3.5rem. The bar's height, so the panel and the camera can clear it.
    ///
    /// **56 is the token; 44 is the floor inside it, and this held the floor.** The value here
    /// was `44` with a docstring claiming to be `--nav-h`, which is `3.5rem` = 56px
    /// (`globals.css:321`). 44 is the *touch-target* floor discussed in the comment sitting
    /// directly above that token — "below it the `min-h-11` children stop fitting" — so the
    /// number was read out of the prose instead of the declaration. `DESIGN.md` warns about
    /// exactly this: *"Grep for the value, not for the comment."* Fourth instance of that
    /// mistake in this app, after the retired palette, the tracking and the display weight.
    ///
    /// 44 gets no token of its own. It is a floor that 56 satisfies, not a number anything reads.
    static let barHeight: CGFloat = 56

    /// The hue the map draws this day's route in, as ink.
    ///
    /// **Ink, never a fill.** `DESIGN.md`'s rule is that map colours do not fill chrome — a
    /// jade button and a teal panel would both stop meaning anything. A *label* in the day's
    /// colour is the opposite: it is a legend, tying the rule above a group of stops to the
    /// line drawn through those same stops on the ground. `RouteGeometry` owns the palette so
    /// there is exactly one place the hues live, and this is the one conversion to `Color`.
    static func dayGlow(_ dayIndex: Int) -> Color {
        let glow = RouteGeometry.palette(forDay: dayIndex).glow
        return Color(red: glow.red, green: glow.green, blue: glow.blue)
    }

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
    /// `frosted: false` is the slate without the blur — the app's `.glass-itinerary.is-opaque`.
    ///
    /// **Not an omission, and the memory cards are why it exists.** `globals.css:3462` strips
    /// `backdrop-filter` from exactly those cards: nothing shows through an opaque fill, so the
    /// blur is a compositing layer rendering a blur of nothing. A tile inside `PlanSheet` is in
    /// the same position — the sheet has already frosted the map — so a second material there
    /// buys a second blur per tile and a slightly paler rectangle.
    func glassPanel(radius: CGFloat = Token.radiusLarge, frosted: Bool = true) -> some View {
        background(Token.surfaceDeep.opacity(Token.panelOpacity))
            // `AnyShapeStyle` because the two branches are different types, and a bare `if` in
            // a modifier chain needs a `@ViewBuilder` wrapper this does not otherwise want.
            .background(frosted ? AnyShapeStyle(.ultraThinMaterial) : AnyShapeStyle(.clear))
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(Token.cardBorder, lineWidth: 1)
            )
    }
}
