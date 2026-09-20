import SwiftUI
import TripMateKit

/// A bundled scene photograph, decoded once.
///
/// **Cached, because a `ScrollView` re-evaluates bodies constantly.** Decoding a 1,100px HEIC on
/// every pass is the cheapest possible self-inflicted jank, and there are nine of them.
enum SceneImage {
    nonisolated(unsafe) private static let cache = NSCache<NSString, UIImage>()

    static func named(_ name: String) -> UIImage? {
        if let hit = cache.object(forKey: name as NSString) { return hit }
        guard let url = Bundle.main.url(forResource: name, withExtension: "heic"),
              let data = try? Data(contentsOf: url),
              let image = UIImage(data: data)
        else { return nil }
        cache.setObject(image, forKey: name as NSString)
        return image
    }
}

private struct ScenePhoto: View {
    let name: String
    let ratio: Double
    /// **0 for a full-bleed strip.** A rounded corner on an image that runs to both screen
    /// edges reads as a mistake: the radius has nothing to sit against, so it just clips the
    /// picture. Either it is inset and rounded, or it is full width and square.
    var radius: CGFloat = Token.radiusMedium

    var body: some View {
        // The slate under every photograph, as everywhere else: a picture that has not decoded
        // must not leave a hole in the page.
        Color.white.opacity(0.06)
            .aspectRatio(ratio, contentMode: .fit)
            .overlay {
                if let image = SceneImage.named(name) {
                    Image(uiImage: image).resizable().scaledToFill()
                }
            }
            .clipped()
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
    }
}

/// `✳ LABEL` over a hairline, then the heading.
///
/// **The page's spine, and the one thing that ports unchanged.** Every band on the web opens
/// exactly this way — one row, one rule, the label right-aligned against a bottom hairline.
struct BandOpener: View {
    let label: String
    let title: String
    /// The web alternates dense and quiet bands; quiet ones take the smaller heading.
    var quiet = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Spacer(minLength: 0)
                // **An SF Symbol, not the "✳" character.** The glyph has an emoji presentation
                // and the system picked it: it rendered as a green-filled tile that ignored the
                // tint entirely. A symbol takes `foregroundStyle` and scales with the text.
                Image(systemName: "asterisk")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(Token.accent)
                    // Decorative. A screen reader reading "asterisk" before every heading is
                    // four interruptions on one screen.
                    .accessibilityHidden(true)
                Text(label.uppercased())
                    .textStyle(.label)
                    .foregroundStyle(Token.foreground)
            }
            .padding(.bottom, 9)
            .overlay(alignment: .bottom) {
                Rectangle().fill(Token.cardBorder).frame(height: 1)
            }

            Text(title)
                .textStyle(.display.size(quiet ? 27 : 32))
                .foregroundStyle(Token.foreground)
                .padding(.top, 26)
                .accessibilityAddTraits(.isHeader)
        }
    }
}

/// What a plan actually knows.
struct JourneyBand: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            BandOpener(label: "Journey", title: "What a plan actually knows")
            ForEach(Array(Landing.beats.enumerated()), id: \.element.id) { index, beat in
                VStack(alignment: .leading, spacing: 0) {
                    // A sibling, not an overlay. As an overlay anchored to the top of a padded
                    // frame the rule sat flush under the previous paragraph and put all the
                    // space below itself — the gap has to be on both sides for it to read as a
                    // separator rather than an underline.
                    if index > 0 {
                        Rectangle()
                            .fill(Token.cardBorder)
                            .frame(height: 1)
                            .padding(.bottom, 22)
                    }
                    Text(beat.headline)
                        .textStyle(.bodyLarge.weight(TextStyle.medium))
                        .foregroundStyle(Token.accent)
                    Text(beat.label.uppercased())
                        .textStyle(.label)
                        .foregroundStyle(Token.muted)
                        .padding(.top, 5)
                    // **No hover tint.** The web fades a flat 0.16 veil on hover and never shows
                    // it on touch at all — so on a phone it already does not exist.
                    ScenePhoto(name: beat.photo, ratio: 11.0 / 12.0)
                        .padding(.top, 12)
                    Text(beat.prose)
                        .textStyle(.detail)
                        .foregroundStyle(Token.muted)
                        .padding(.top, 12)
                }
                .padding(.top, index == 0 ? 26 : 22)
            }
        }
    }
}

/// How it actually works.
struct MethodBand: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            BandOpener(label: "Method", title: "How it actually works", quiet: true)
            Text("Four steps, about five minutes. Most of it is the plan being checked rather "
                 + "than written.")
                .textStyle(.body)
                .foregroundStyle(Token.muted)
                .padding(.top, 12)

            ForEach(Landing.steps) { step in
                VStack(alignment: .leading, spacing: 0) {
                Rectangle()
                    .fill(Token.cardBorder)
                    .frame(height: 1)
                    .padding(.bottom, 16)
                HStack(alignment: .top, spacing: 10) {
                    Text(step.number)
                        .textStyle(.money.size(12))
                        .foregroundStyle(Token.muted)
                        .frame(width: 26, alignment: .leading)
                    VStack(alignment: .leading, spacing: 5) {
                        Text(step.title)
                            .textStyle(.body.weight(TextStyle.semibold))
                            .foregroundStyle(Token.foreground)
                        Text(step.prose)
                            .textStyle(.detail)
                            .foregroundStyle(Token.muted)
                    }
                }
                .accessibilityElement(children: .combine)
                }
                .padding(.top, 16)
            }
        }
    }
}

/// Four trips, already priced.
///
/// **A carousel, not a 3,475pt stack.** This is the clearest case on the page of a composition
/// that exists only because a desktop browser scrolls vertically: four cards down a column is
/// fourteen viewports of the same shape. Side by side they are one screen and a swipe.
struct PlansBand: View {
    let onPick: (Landing.Example) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            BandOpener(label: "Plans", title: "Four trips, already priced")
            Text("Every figure below is what the planner returns for those dates and that "
                 + "budget — not a starting price with the real one further in.")
                .textStyle(.body)
                .foregroundStyle(Token.muted)
                .padding(.top, 12)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 14) {
                    ForEach(Landing.examples) { example in
                        ExampleCard(example: example, onPick: { onPick(example) })
                    }
                }
                .scrollTargetLayout()
                .padding(.horizontal, Token.padCompact)
            }
            .scrollTargetBehavior(.viewAligned)
            // Full-bleed: the rail runs to both edges so a card is visibly cut off, which is
            // what says "there is more this way" without a caption doing it.
            .padding(.horizontal, -Token.padCompact)
            .padding(.top, 24)

            Text("Swipe for four")
                .textStyle(.caption)
                .foregroundStyle(Token.muted)
                .padding(.top, 11)
        }
    }
}

private struct ExampleCard: View {
    let example: Landing.Example
    let onPick: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ScenePhoto(name: example.photo, ratio: 16.0 / 10.0)

            VStack(alignment: .leading, spacing: 0) {
                Text(example.title)
                    .textStyle(.bodyLarge.weight(TextStyle.medium))
                    .foregroundStyle(Token.foreground)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("FROM")
                        .textStyle(.label)
                        .foregroundStyle(Token.muted)
                    // Melodrama for a price to be *felt*, in the money colour — `DESIGN.md`'s
                    // `.price-display`. A figure is information, never the action colour.
                    Text(example.price, format: .currency(code: "USD").precision(.fractionLength(0)))
                        .textStyle(.moneyLarge)
                        .foregroundStyle(Token.money)
                }
                .padding(.top, 9)

                VStack(alignment: .leading, spacing: 3) {
                    meta("Where", example.whereText)
                    meta("When", example.whenText)
                    meta("Length", example.lengthText)
                    meta("Party", example.partyText)
                }
                .padding(.top, 9)
                .overlay(alignment: .top) {
                    Rectangle().fill(Token.cardBorder).frame(height: 1)
                }
                .padding(.top, 11)
            }
            .padding(.horizontal, 14)
            .padding(.top, 13)

            Button(action: onPick) {
                Text("Plan a trip like this")
                    .textStyle(.detail.weight(TextStyle.semibold))
                    .foregroundStyle(Token.foreground)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .overlay(
                        RoundedRectangle(cornerRadius: Token.radiusSmall + 4, style: .continuous)
                            .strokeBorder(Token.cardBorder, lineWidth: 1)
                    )
            }
            .buttonStyle(.plain)
            .padding(14)
        }
        .frame(width: 268)
        .background(Token.surfaceDeep.opacity(Token.panelOpacity))
        .clipShape(RoundedRectangle(cornerRadius: Token.radiusLarge, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Token.radiusLarge, style: .continuous)
                .strokeBorder(Token.cardBorder, lineWidth: 1)
        )
    }

    private func meta(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(label.uppercased())
                .textStyle(.label)
                .foregroundStyle(Token.muted)
                .frame(width: 52, alignment: .leading)
            Text(value)
                .textStyle(.money.size(12))
                .foregroundStyle(Token.foreground)
        }
    }
}

/// Anywhere you can name.
struct ReachBand: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            BandOpener(label: "Reach", title: "Anywhere you can name", quiet: true)
            Text("The planner geocodes the destination you type, then pulls that place's real "
                 + "forecast, public holidays and opening hours. There is no list of supported "
                 + "cities to be missing from.")
                .textStyle(.body)
                .foregroundStyle(Token.muted)
                .padding(.top, 12)
            // **A pre-rendered image, not a ported `worldLand.ts`.** That is a ~38 KB Natural
            // Earth path and rendering it natively needs an SVG path parser — for a drawing that
            // never changes. A bundled asset is the same picture for none of the code.
            //
            // No plan markers on it. Three targets 13px apart fail WCAG 2.2 spacing, which is
            // why the web hides them below `lg`, and a native rebuild does not make them fit.
            // The density of the drawing is the argument here; four pins are not.
            ScenePhoto(name: "world-map", ratio: 1200.0 / 844.0)
                .padding(.top, 22)
                .accessibilityLabel("A world map. The planner works anywhere you can name.")
        }
    }
}

/// The end of a long read.
struct LandingFooter: View {
    let onTab: (AppTab) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Rectangle()
                .fill(Token.cardBorder)
                .frame(height: 1)
                .padding(.bottom, 46)
            ScenePhoto(name: "graubunden-autumn-valley", ratio: 16.0 / 5.0, radius: 0)
                .padding(.horizontal, -Token.padCompact)

            Text("TripMate")
                .textStyle(.display.size(26))
                .foregroundStyle(Token.foreground)
                .padding(.top, 22)

            // On the web these are links to other routes. Here they are the tab bar's own
            // destinations, so they switch tabs rather than navigating — the one place the
            // footer and the bar say the same thing, at the end of a long read.
            footerLink("Memories", tab: .trips)
            footerLink("Profile", tab: .profile)

            Text("Plans priced against real dates.\nWeather, holidays and opening hours included.")
                .textStyle(.detail)
                .foregroundStyle(Token.muted)
                .padding(.top, 22)
        }
    }

    private func footerLink(_ title: String, tab: AppTab) -> some View {
        Button { onTab(tab) } label: {
            HStack(spacing: 9) {
                Image(systemName: "plus")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Token.accent)
                    .accessibilityHidden(true)
                Text(title)
                    .textStyle(.title.size(21))
                    .foregroundStyle(Token.foreground)
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.top, 8)
    }
}
