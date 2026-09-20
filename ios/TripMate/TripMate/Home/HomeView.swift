import SwiftUI
import TripMateKit

/// The landing, as the app's first tab.
///
/// **Rebuilt rather than mirrored.** The web page is 11,304pt of scroll at 375px across six
/// bands; this keeps the bands and their spine — a right-aligned `✳ LABEL` over a hairline, then
/// a Melodrama heading — and rebuilds every composition beneath it. See
/// `docs/superpowers/specs/2026-09-19-ios-landing-design.md`.
///
/// **It is a real screen with a working capsule**, not a first-run that vanishes, so the hero has
/// to leave room for that capsule at rest — see `heroHeight`.
struct HomeView: View {
    let plan: PlanStore
    /// Opens the wizard, seeded from whatever the capsule already holds.
    let onPlan: () -> Void
    let onTab: (AppTab) -> Void

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    HeroView(height: Self.heroHeight(in: proxy.size, safeTop: proxy.safeAreaInsets.top))
                    EntryCapsule(plan: plan, onPlan: onPlan)
                        .padding(.horizontal, Token.padCompact)
                        .padding(.top, 18)

                    Group {
                        JourneyBand().padding(.top, 52)
                        MethodBand().padding(.top, 44)
                        PlansBand(onPick: { example in
                            // A card seeds the destination and nothing else. `planExamples.ts`
                            // stores a season rather than a date for exactly this reason: a
                            // stored date goes stale and prefills a value the wizard's own
                            // minimum rejects.
                            plan.draft.destination = example.whereText
                            onPlan()
                        })
                        .padding(.top, 52)
                        ReachBand().padding(.top, 44)
                        LandingFooter(onTab: onTab)
                    }
                    .padding(.horizontal, Token.padCompact)

                    // Clear the tab bar. Nothing else on this screen knows it is there.
                    Color.clear.frame(height: Token.barHeight + Token.gapRows * 3)
                }
            }
            .scrollIndicators(.hidden)
            .ignoresSafeArea(edges: .top)
            // **Home paints its own ground.** The map is still mounted behind every tab, and
            // without this it showed through beneath the capsule — two worlds at once. The web
            // gets this free because its landing is a document; here the scenery is a sibling.
            .background(Token.canvas)
        }
    }

    /// **Derived from the tab bar, not chosen.**
    ///
    /// The capsule is the screen's primary action and has to be whole at rest. Usable height is
    /// the display minus the home indicator, the bar and its gap; the hero gets what is left
    /// after the capsule. At a flat 640 the "Plan it" row sat *underneath* the tab bar — found by
    /// building the mockup, and a mistake the web cannot make because it has no permanent bottom
    /// chrome.
    static func heroHeight(in size: CGSize, safeTop: CGFloat) -> CGFloat {
        let usable = size.height - Token.barHeight - Token.gapRows * 2 - EntryCapsule.height
        // A floor so a small display still shows a photograph rather than a letterbox.
        return max(usable, 320)
    }
}

/// The photograph, the word, and nothing else.
private struct HeroView: View {
    let height: CGFloat

    /// Decoded once. A hero that re-decodes on every scroll frame is the cheapest possible
    /// self-inflicted jank.
    static let poster: UIImage? = Bundle.main
        .url(forResource: "hero-poster", withExtension: "heic")
        .flatMap { try? Data(contentsOf: $0) }
        .flatMap(UIImage.init(data:))

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            // ponytail: the poster frame only, and knowingly the wrong resolution. The 100-frame
            // film plays here once an iOS tier exists in `scripts/build-frame-sequence.mjs` — the
            // `port` tier this is cut from is 540x960, a 2.17x upscale on a 3x phone, which
            // `DESIGN.md:1099` rejects as mush. Composition now, pixels with the tier.
            //
            // Loaded by path rather than `Image("name")`: the folder is a
            // `PBXFileSystemSynchronizedRootGroup`, so files bundle without an asset catalog,
            // and `UIImage(named:)` does not reliably find a loose `.heic`.
            if let poster = HeroView.poster {
                Image(uiImage: poster)
                    .resizable()
                    .scaledToFill()
                    .frame(height: height)
                    .clipped()
            } else {
                Token.canvas
            }

            // Lands on the canvas at the bottom so the photograph dissolves into the page rather
            // than ending on a line.
            LinearGradient(
                colors: [.clear, Token.canvas.opacity(0.15), Token.canvas.opacity(0.75), Token.canvas],
                startPoint: .top, endPoint: .bottom
            )

            Text("Somewhere.")
                .textStyle(.display.size(46))
                .foregroundStyle(Token.foreground)
                // **Three layers, and this is the mechanism contrast maths does not model.**
                // `DESIGN.md:1118`: the worst pixel under the hero is 1.92:1 over 36 of 80 frames,
                // and a scrim deep enough to fix that by itself would flatten the picture.
                .shadow(color: .black.opacity(0.55), radius: 1, y: 1)
                .shadow(color: .black.opacity(0.40), radius: 6, y: 2)
                .shadow(color: .black.opacity(0.25), radius: 20)
                .padding(.horizontal, Token.padCompact)
                .padding(.bottom, 22)
        }
        .frame(height: height)
        .frame(maxWidth: .infinity)
        .clipped()
    }
}

/// Where / Arriving / Leaving, and the one action.
///
/// **The one light surface in the whole app** — `DESIGN.md:683` calls it the highest-contrast
/// object without being the loudest colour. Everything else is the slate at an alpha.
///
/// **It writes to `PlanStore.draft`, the same `PlanDraft` the wizard edits.** Two entry points,
/// one model, one set of date rules. Tapping the action opens the wizard already holding
/// whatever was typed here rather than asking for it again.
struct EntryCapsule: View {
    let plan: PlanStore
    let onPlan: () -> Void

    /// Three rows plus the action, measured rather than guessed — `HomeView.heroHeight` subtracts
    /// this, so a wrong number here puts the action under the tab bar.
    static let height: CGFloat = 250

    var body: some View {
        VStack(spacing: 0) {
            row("Where", placeholder: "Where to?") {
                // The placeholder is drawn rather than passed to `TextField`: its own is styled
                // from the environment's foreground, which here is the near-black meant for the
                // *value*, and it came out invisible against the light capsule.
                ZStack(alignment: .leading) {
                    if plan.draft.destination.isEmpty {
                        Text("Where to?")
                            .textStyle(.bodyLarge)
                            .foregroundStyle(.black.opacity(0.40))
                    }
                    TextField("", text: Binding(
                        get: { plan.draft.destination },
                        set: { plan.draft.destination = $0 }
                    ))
                    .textFieldStyle(.plain)
                    .textStyle(.bodyLarge)
                    .foregroundStyle(.black)
                    .autocorrectionDisabled()
                }
            }
            hairline
            row("Arriving", placeholder: "Add dates") { dateText(plan.draft.startDate) }
            hairline
            row("Leaving", placeholder: "Add dates") { dateText(plan.draft.endDate) }

            Button(action: onPlan) {
                Text("Plan it")
                    .textStyle(.bodyLarge.weight(TextStyle.semibold))
                    .foregroundStyle(Token.accentForeground)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Token.accent)
                    .clipShape(RoundedRectangle(cornerRadius: Token.radiusMedium, style: .continuous))
            }
            .buttonStyle(.plain)
            .padding(10)
        }
        .background(Color(red: 0xf7 / 255, green: 0xf5 / 255, blue: 0xf2 / 255).opacity(0.94))
        // **18pt, not a full pill.** `DESIGN.md:697`: a full pill on a tall stacked box renders
        // as a lozenge, and on a phone this capsule is always stacked.
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .shadow(color: .black.opacity(0.45), radius: 16, y: 8)
    }

    private var hairline: some View {
        Rectangle().fill(Color.black.opacity(0.10)).frame(height: 1)
    }

    @ViewBuilder
    private func row<Content: View>(
        _ label: String, placeholder: String, @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased())
                .textStyle(.label)
                .foregroundStyle(.black.opacity(0.55))
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
    }

    /// The dates are read-only here and typed in the wizard, which owns the picker and the
    /// range rules. Showing them keeps the capsule honest about what it already knows.
    private func dateText(_ iso: String) -> some View {
        Text(iso.isEmpty ? "Add dates" : DayDisplay.formatDate(iso))
            .textStyle(.bodyLarge)
            .foregroundStyle(.black.opacity(iso.isEmpty ? 0.40 : 1))
    }
}
