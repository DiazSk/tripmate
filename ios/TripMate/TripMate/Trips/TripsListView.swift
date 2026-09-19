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
        .padding(Token.gapRows)
        // The permanent slate base a photograph will later fade in over.
        .background(Color.white.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: Token.radiusMedium, style: .continuous))
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
