import SwiftUI
import TripMateKit

/// One trip, read against the map. `ItineraryCard.tsx` is the model.
///
/// Read-only by design at this stage. The web card also carries inline actual-cost entry, day
/// retitling, the staggered generation reveal and unseen-change dots on the tabs — all of which
/// belong to the edit and generation flows. Building their affordances before the flows exist
/// would be chrome that does nothing.
struct TripDetailView: View {
    let trip: Trip
    let activeDay: Int
    /// Which stop is being pointed at, as a raw index into `DayPlan.stops`.
    let emphasis: Int?
    let onSelectDay: (Int) -> Void
    let onEmphasise: (Int) -> Void
    let onBack: () -> Void

    private var days: [DayPlan] { trip.itinerary.days }

    var body: some View {
        VStack(alignment: .leading, spacing: Token.gapPanels) {
            header
            BudgetBarView(days: days, budget: trip.budget, activeDayIndex: activeDay)
            if days.count > 1 { dayTabs }
            stops
            Spacer(minLength: 0)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button(action: onBack) {
                HStack(spacing: 4) {
                    Image(systemName: "chevron.left")
                    Text("Memories")
                }
                .textStyle(.detail.weight(TextStyle.medium))
                .foregroundStyle(Token.muted)
            }
            .buttonStyle(.plain)

            Text(trip.destination)
                .textStyle(.display)
                .foregroundStyle(Token.foreground)

            Text("\(trip.startDate) → \(trip.endDate)")
                .textStyle(.money)
                .foregroundStyle(Token.muted)
        }
    }

    /// The day tabs own day selection. The budget bar below highlights the same index as a
    /// *readout* — making thirty spans tappable would duplicate this navigation and add thirty
    /// tab stops to a panel whose job is reading.
    private var dayTabs: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(days.indices, id: \.self) { index in
                    let isActive = index == activeDay
                    Button { onSelectDay(index) } label: {
                        Text("Day \(index + 1)")
                            .textStyle(.caption.weight(TextStyle.semibold))
                            .foregroundStyle(isActive ? Token.accentForeground : Token.muted)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(isActive ? Token.accent : Color.white.opacity(0.08))
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    @ViewBuilder
    private var stops: some View {
        if days.indices.contains(activeDay) {
            let day = days[activeDay]
            ScrollView {
                VStack(alignment: .leading, spacing: Token.gapRows) {
                    if let summary = day.summary {
                        Text(summary)
                            .textStyle(.detail)
                            .foregroundStyle(Token.muted)
                    }
                    ForEach(Array(day.stops.enumerated()), id: \.offset) { index, stop in
                        StopRow(
                            stop: stop,
                            isEmphasised: index == emphasis,
                            onTap: { onEmphasise(index) }
                        )
                    }
                    if let lodging = day.lodging {
                        LodgingRow(lodging: lodging)
                    }
                }
            }
        }
    }
}

/// A stop's two lines, in the order `DESIGN.md` specifies: `why` first — why this stop suits
/// *this* traveler — then `note`, the practical detail. `why` is optional because itineraries
/// saved before the field existed do not carry it.
private struct StopRow: View {
    let stop: Stop
    /// The row and its point on the map take the accent together, which is the whole reason the
    /// index lives in the store rather than in either view.
    let isEmphasised: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) { content }
            .buttonStyle(.plain)
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(stop.name)
                    .textStyle(.headingSmall.weight(TextStyle.medium))
                    .foregroundStyle(Token.foreground)
                Spacer(minLength: 8)
                Text(stop.cost, format: .currency(code: "USD").precision(.fractionLength(0)))
                    .textStyle(.money)
                    .foregroundStyle(Token.money)
            }
            HStack(spacing: 6) {
                Text(stop.time)
                Text("·")
                Text(stop.durationLabel)
            }
            .textStyle(.money.size(12))
            .foregroundStyle(Token.muted)

            if let why = stop.why {
                Text(why)
                    .textStyle(.detail)
                    .foregroundStyle(.white.opacity(0.85))
            }
            Text(stop.note)
                .textStyle(.detail)
                .foregroundStyle(Token.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Token.gapRows)
        .background(Color.white.opacity(isEmphasised ? 0.10 : 0.06))
        .clipShape(RoundedRectangle(cornerRadius: Token.radiusMedium, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Token.radiusMedium, style: .continuous)
                .strokeBorder(Token.accent.opacity(isEmphasised ? 0.55 : 0), lineWidth: 1)
        )
    }
}

private struct LodgingRow: View {
    let lodging: Lodging

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(lodging.name)
                    .textStyle(.body.weight(TextStyle.medium))
                    .foregroundStyle(Token.foreground)
                Text(lodging.note)
                    .textStyle(.caption)
                    .foregroundStyle(Token.muted)
            }
            Spacer(minLength: 8)
            Text(lodging.cost, format: .currency(code: "USD").precision(.fractionLength(0)))
                .textStyle(.money)
                .foregroundStyle(Token.money)
        }
        .padding(Token.gapRows)
        .background(Token.moneySoft)
        .clipShape(RoundedRectangle(cornerRadius: Token.radiusMedium, style: .continuous))
    }
}

/// Spent against budget, cut into one span per day.
///
/// Every number comes from `Spend` in TripMateKit — the bar adds no arithmetic of its own, which
/// is the whole reason that module exists. The days are **not** colour-coded: hue encodes
/// categories that have no natural order, days have both an order and a position, and the
/// per-day breakdown elsewhere in this card genuinely *is* categorical, so a multi-coloured bar
/// above it would invite exactly the wrong reading. Separation is one slate at an alpha instead.
struct BudgetBarView: View {
    let days: [DayPlan]
    let budget: Double
    let activeDayIndex: Int?

    private var spent: Double { Spend.trip(days) }
    private var isOver: Bool { budget > 0 && spent > budget }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(spent, format: .currency(code: "USD").precision(.fractionLength(0)))
                    .textStyle(.moneyLarge)
                    .foregroundStyle(isOver ? Token.alert : Token.money)
                Text("of")
                    .textStyle(.caption)
                    .foregroundStyle(Token.muted)
                Text(budget, format: .currency(code: "USD").precision(.fractionLength(0)))
                    .textStyle(.money)
                    .foregroundStyle(Token.muted)
            }

            GeometryReader { proxy in
                HStack(spacing: 0) {
                    ForEach(Spend.budgetSegments(days, budget: budget), id: \.dayIndex) { segment in
                        Rectangle()
                            .fill(fill(for: segment.dayIndex))
                            .frame(width: proxy.size.width * segment.width / 100)
                            // A hairline of the panel's own material, plus an alternating
                            // lightness step so adjacent days stay legible where a 30-day trip
                            // makes the spans narrow.
                            .overlay(alignment: .trailing) {
                                Rectangle()
                                    .fill(Token.canvas.opacity(0.35))
                                    .frame(width: 1)
                            }
                    }
                    Spacer(minLength: 0)
                }
            }
            .frame(height: 8)
            .background(Color.white.opacity(0.08))
            .clipShape(Capsule())

            if isOver {
                Text("Over budget by \((spent - budget), format: .currency(code: "USD").precision(.fractionLength(0)))")
                    .textStyle(.money.size(12))
                    .foregroundStyle(Token.alert)
            }
        }
    }

    private func fill(for dayIndex: Int) -> Color {
        let base = isOver ? Token.alert : Token.money
        // The alternating step, and a lift for the day being read so the bar and the tabs point
        // at the same thing.
        if dayIndex == activeDayIndex { return base }
        return base.opacity(dayIndex.isMultiple(of: 2) ? 0.78 : 0.62)
    }
}
