import AVFoundation
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
    @Environment(Chrome.self) private var chrome
    let plan: PlanStore
    /// Opens the wizard, seeded from whatever the capsule already holds.
    let onPlan: () -> Void
    let onTab: (AppTab) -> Void

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                ScrollViewReader { scroll in
                VStack(alignment: .leading, spacing: 0) {
                    HeroView(height: Self.heroHeight(in: proxy.size, safeTop: proxy.safeAreaInsets.top))
                    // **The capsule scrolls itself clear when the suggestion list opens.**
                    // Keyboard avoidance lifts the *field* into view and knows nothing about a
                    // list that appears under it, and the tab bar floats over the bottom of the
                    // page — between them three of five suggestions were unreachable. The
                    // bottom spacer below is what gives this somewhere to scroll to.
                    EntryCapsule(plan: plan, onPlan: onPlan) { expanded in
                        guard expanded else { return }
                        withAnimation(.easeOut(duration: 0.25)) {
                            scroll.scrollTo(Self.capsuleID, anchor: .bottom)
                        }
                    }
                        .id(Self.capsuleID)
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

                }
                }
            }
            .scrollIndicators(.hidden)
            .shrinksTabBar(chrome)
            .ignoresSafeArea(edges: .top)
            // **Home paints its own ground.** The map is still mounted behind every tab, and
            // without this it showed through beneath the capsule — two worlds at once. The web
            // gets this free because its landing is a document; here the scenery is a sibling.
            .background(Token.canvas)
        }
    }

    private static let capsuleID = "entry-capsule"

    /// **The hero is what is left after the capsule, and nothing else is subtracted here.**
    ///
    /// The capsule is the screen's primary action and has to be whole at rest. At a flat 640 the
    /// "Plan it" row sat *underneath* the tab bar — a mistake the web cannot make, because it
    /// has no permanent bottom chrome.
    ///
    /// The bar used to be subtracted here by hand. It is not any more: `AppShell` gives this
    /// page the same bottom `safeAreaInset` every other page gets, which already takes the bar
    /// and its gap out of `proxy.size`. Subtracting it a second time reserved the bar twice and
    /// cost the photograph 68pt.
    static func heroHeight(in size: CGSize, safeTop: CGFloat) -> CGFloat {
        let usable = size.height - EntryCapsule.height
        // A floor so a small display still shows a photograph rather than a letterbox.
        return max(usable, 320)
    }
}

/// The Petra clip, played once.
///
/// **A single H.264 file, not the 100 AVIF frames.** The frames exist because the *web* scrubs
/// them against scroll position, which a video cannot do. Nothing here scrubs: the film plays
/// once on appear and holds. So it is one hardware-decoded asset at 1.74 MB against 6.7 MB of
/// stills, with none of the streaming-decode machinery a frame player would need — holding 100
/// decoded 760x1080 frames is ~330 MB, so they could never all be resident anyway.
///
/// **It does not loop and it does not replay.** `DESIGN.md` records that the landing's motion is
/// the globe's and everything else moves once; a hero that restarts every time you tap Home is
/// an animation you cannot get away from.
private struct HeroFilm: UIViewRepresentable {
    func makeUIView(context: Context) -> PlayerView {
        let view = PlayerView()
        guard let url = Bundle.main.url(forResource: "hero-film", withExtension: "mp4")
        else { return view }
        let player = AVPlayer(url: url)
        // Silent by construction — the clip carries no audio track — but muted anyway so it
        // cannot interrupt anything the traveller is already listening to.
        player.isMuted = true
        player.actionAtItemEnd = .pause
        view.player = player
        player.play()
        return view
    }

    func updateUIView(_ uiView: PlayerView, context: Context) {}

    /// A view whose backing layer *is* the player layer, so the layer resizes with the view
    /// instead of needing a frame set by hand on every layout pass.
    final class PlayerView: UIView {
        override static var layerClass: AnyClass { AVPlayerLayer.self }
        private var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
        var player: AVPlayer? {
            get { playerLayer.player }
            set {
                playerLayer.player = newValue
                // The clip is cut to the hero's own aspect, so this crops almost nothing — it
                // is here for the displays whose hero is a slightly different shape.
                playerLayer.videoGravity = .resizeAspectFill
            }
        }
    }
}

/// The photograph, the word, and nothing else.
struct HeroView: View {
    let height: CGFloat

    /// Decoded once. A hero that re-decodes on every scroll frame is the cheapest possible
    /// self-inflicted jank.
    static let poster: UIImage? = Bundle.main
        .url(forResource: "hero-poster", withExtension: "heic")
        .flatMap { try? Data(contentsOf: $0) }
        .flatMap(UIImage.init(data:))

    var body: some View {
        ZStack(alignment: .bottom) {
            // **The poster under the film, never removed.** The player takes a moment to
            // produce its first frame, and frame one of the clip *is* this image — so the
            // hand-off is a visual no-op rather than a flash of canvas. Same reasoning the web
            // gives for its own poster.
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

            HeroFilm()
                .frame(height: height)
                .clipped()

            // Lands on the canvas at the bottom so the photograph dissolves into the page rather
            // than ending on a line.
            LinearGradient(
                colors: [.clear, Token.canvas.opacity(0.15), Token.canvas.opacity(0.75), Token.canvas],
                startPoint: .top, endPoint: .bottom
            )

            Text("Somewhere.")
                .textStyle(.display.size(46))
                .foregroundStyle(Token.foreground)
                .frame(maxWidth: .infinity)
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
    /// Fired when the suggestion list opens or closes, so the page can scroll it clear of the
    /// keyboard and the tab bar. The capsule does not own the scroll view.
    var onSuggestionsChange: (Bool) -> Void = { _ in }

    /// Three rows plus the action, measured rather than guessed — `HomeView.heroHeight` subtracts
    /// this, so a wrong number here puts the action under the tab bar.
    ///
    /// **A resting measure.** The suggestion list grows the capsule past it while somebody is
    /// typing; the page is a `ScrollView`, so that scrolls rather than clipping, and the hero
    /// is sized for the state the screen sits in.
    static let height: CGFloat = 250

    @State private var suggest = DestinationSuggest()
    @FocusState private var typingDestination: Bool

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
                    // A place name is not a sentence, same reason the wizard's field gives.
                    .textInputAutocapitalization(.words)
                    .focused($typingDestination)
                    .onChange(of: plan.draft.destination) { _, text in
                        guard typingDestination else { return }
                        suggest.query(text)
                    }
                }
            }
            // Inline under the field, not an overlay — an overlay here would cover Arriving,
            // and a suggestion that hides the next question is how you fill one field and lose
            // another. Same call the wizard makes, in this surface's ink.
            if showingSuggestions {
                hairline
                DestinationSuggestionList(
                    results: suggest.results,
                    ink: .black,
                    // Jade on the cream capsule is 2:1; the mark takes the capsule's own ink.
                    mark: .black.opacity(0.45)
                ) { line in
                    plan.draft.destination = line
                    suggest.clear()
                    typingDestination = false
                }
            }
            hairline
            // **The wizard's own `DateField`**, not a second picker: same graphical month view,
            // same popover, and the same rule that departure cannot precede arrival — which is
            // enforced by the picker's own range rather than by validation after the fact.
            row("Arriving", placeholder: "Add dates") {
                DateField(
                    value: Binding(get: { plan.draft.startDate },
                                   set: { plan.draft.startDate = $0 }),
                    earliest: Tiers.todayISO(),
                    foreground: .black
                )
            }
            hairline
            row("Leaving", placeholder: "Add dates") {
                DateField(
                    value: Binding(get: { plan.draft.endDate },
                                   set: { plan.draft.endDate = $0 }),
                    earliest: plan.draft.startDate,
                    foreground: .black
                )
            }

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
        .onChange(of: typingDestination) { wasTyping, _ in
            if wasTyping { suggest.clear() }
        }
        .onChange(of: showingSuggestions) { _, open in onSuggestionsChange(open) }
    }

    private var showingSuggestions: Bool { typingDestination && !suggest.results.isEmpty }

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

}
