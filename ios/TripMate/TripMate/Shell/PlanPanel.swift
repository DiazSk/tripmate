import SwiftUI
import TripMateKit

/// The plan, read against the map. `DockedPanel` on the web.
///
/// Takes a `Trip?` and shows an invitation when there isn't one — deliberately no sample data
/// baked in. The models carry no public memberwise initialiser yet (they are decode-only until
/// the edit flows need to construct one), so a placeholder trip would have to be fake JSON
/// decoded at launch, which is a thing to delete later rather than a thing to build on.
struct PlanPanel: View {
    let trip: Trip?

    var body: some View {
        VStack(alignment: .leading, spacing: Token.gapPanels) {
            if let trip {
                header(for: trip)
                days(of: trip)
            } else {
                invitation
            }
            Spacer(minLength: 0)
        }
        .padding(Token.padCompact)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .glassPanel()
        .padding(Token.padCompact)
    }

    private func header(for trip: Trip) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(trip.destination)
                .font(.system(size: 28, weight: .semibold))
                .kerning(-2.5)   // DESIGN.md: tracking tightens as type grows.
                .foregroundStyle(.white)
            Text("\(trip.startDate) → \(trip.endDate)")
                .font(.system(size: 14))
                .monospacedDigit()   // `tabular-nums` on every date and figure.
                .foregroundStyle(Token.muted)
        }
    }

    private func days(of trip: Trip) -> some View {
        VStack(alignment: .leading, spacing: Token.gapRows) {
            ForEach(Array(trip.itinerary.days.enumerated()), id: \.offset) { index, day in
                HStack(alignment: .firstTextBaseline, spacing: Token.gapRows) {
                    Text("\(index + 1)")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Token.accent)
                        .frame(width: 16, alignment: .leading)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(day.title ?? day.date)
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(.white)
                        Text("\(day.stops.count) stops")
                            .font(.system(size: 13))
                            .foregroundStyle(Token.muted)
                    }
                }
            }
        }
    }

    /// An invitation, not an apology — `DESIGN.md`'s empty-state rule. The headline names the
    /// space, one line explains it, and the action is a verb. No "nothing here yet".
    private var invitation: some View {
        VStack(alignment: .leading, spacing: Token.gapRows) {
            Text("Plan your first trip")
                .font(.system(size: 28, weight: .semibold))
                .kerning(-2.5)
                .foregroundStyle(.white)
            Text("Tell us where and when, and the days come back written.")
                .font(.system(size: 14))
                .foregroundStyle(Token.muted)
        }
    }
}
