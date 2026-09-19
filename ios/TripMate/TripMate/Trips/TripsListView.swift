import SwiftUI
import TripMateKit

/// The memories wall, as the docked panel sees it.
///
/// The web version is a photo collage: each card resolves a real destination photograph over a
/// permanent slate base. That base is not a placeholder — `DESIGN.md`'s Constant-Ground Rule says
/// a slow photo lookup must never blank a card and a resolved one must never repaint the tile. So
/// a card with no photograph yet is the correct *base state*, not a stub, and the photo layer
/// arrives with the image pipeline rather than being faked here.
struct TripsListView: View {
    let store: TripsStore
    let onOpen: (TripSummary) -> Void
    let onPlan: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Token.gapPanels) {
            HStack(alignment: .firstTextBaseline) {
                Text("Memories")
                    .textStyle(.display)
                    .foregroundStyle(Token.foreground)
                Spacer(minLength: 8)
                // Only once there is a wall to add to. On the empty state the invitation below
                // carries the button, because a heading with an action beside it and nothing
                // underneath reads as a toolbar for an empty room.
                if !store.trips.isEmpty {
                    Button("Plan a trip", action: onPlan)
                        .buttonStyle(PrimaryButtonStyle())
                }
            }

            if let message = store.message {
                Notice(text: message)
            }

            if store.trips.isEmpty {
                if store.isLoading {
                    ProgressView().tint(Token.accent)
                } else {
                    invitation
                }
            } else {
                ScrollView {
                    VStack(spacing: Token.gapRows) {
                        ForEach(store.trips, id: \.id) { trip in
                            Button { onOpen(trip) } label: { TripRow(trip: trip) }
                                .buttonStyle(.plain)
                        }
                    }
                }
            }

            Spacer(minLength: 0)
        }
    }

    /// An invitation, not an apology — `DESIGN.md`'s empty-state rule. The headline names the
    /// space, one line explains it, and no "nothing here yet".
    private var invitation: some View {
        VStack(alignment: .leading, spacing: Token.gapRows) {
            Text("Plan your first trip")
                .textStyle(.title)
                .foregroundStyle(Token.foreground)
            Text("Tell us where and when, and the days come back written.")
                .textStyle(.body)
                .foregroundStyle(Token.muted)
            Button("Plan a trip", action: onPlan)
                .buttonStyle(PrimaryButtonStyle())
                .padding(.top, 4)
        }
    }
}

private struct TripRow: View {
    let trip: TripSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // **A bounded tile, and no type on it** — the Photograph-Is-Not-A-Surface Rule.
            // `DESIGN.md:388` measures why: across eight cities mean luminance runs 0.040-0.348
            // and Kyoto peaks at 0.947, where white body text is 2.41:1 under a 60% scrim and
            // 3.56:1 under 75%. A scrim makes *large* type safe and small type only apparently
            // safe, so the card puts every word on its own material instead.
            //
            // **16:10, not a fixed height.** The web arrived here from `h-[200px]`: uncapped, a
            // card passes 600px wide and 600x200 is a 3:1 letterbox that centre-crops straight
            // through the one tall landmark that made a destination recognisable.
            PlacePhotoView(name: trip.destination, large: true)
                .aspectRatio(16.0 / 10.0, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: Token.radiusMedium, style: .continuous))

            VStack(alignment: .leading, spacing: 4) {
                Text(trip.destination)
                    .textStyle(.heading)
                    .foregroundStyle(Token.foreground)
                    .frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: 6) {
                    Text("\(trip.startDate) → \(trip.endDate)")
                    Text("·")
                    Text(trip.budget, format: .currency(code: "USD").precision(.fractionLength(0)))
                }
                .textStyle(.money)
                .foregroundStyle(Token.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 2)
        }
        .padding(10)
        .background(Token.surfaceDeep.opacity(Token.panelOpacity))
        .clipShape(RoundedRectangle(cornerRadius: Token.radiusLarge, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Token.radiusLarge, style: .continuous)
                .strokeBorder(Token.cardBorder, lineWidth: 1)
        )
    }
}

/// A soft failure, in the form the web app uses for one: muted text inside the panel rather than
/// the red block, which is reserved for a hard validation error.
struct Notice: View {
    let text: String

    var body: some View {
        Text(text)
            .textStyle(.detail)
            .foregroundStyle(Token.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Token.gapRows)
            .background(Color.white.opacity(0.05))
            .clipShape(RoundedRectangle(cornerRadius: Token.radiusSmall, style: .continuous))
    }
}
