import Foundation

/// Money, summed in exactly one place.
///
/// Ported from `src/lib/itinerary.ts`, and deliberately **not** put in a view. That file's own
/// docblock records three independent summations that once disagreed on screen, and notes that
/// `npm test` can only reach pure modules — so arithmetic left inside a component is arithmetic
/// nothing checks. The same holds here: `swift test` reaches this and cannot reach a SwiftUI body.
///
/// Every figure the UI shows comes from these functions. Adding a fourth reading of the same
/// numbers somewhere else is the defect this layout exists to prevent.

/// One day's spend, split the way the per-day breakdown displays it.
public struct DaySpend: Sendable, Equatable {
    public var food: Double = 0
    public var entry: Double = 0
    public var transit: Double = 0
    public var other: Double = 0
    /// Lodging. Named `stay` to match the breakdown tile rather than the field.
    public var stay: Double = 0
    public var total: Double = 0
}

public extension Itinerary {
    /// A copy with one actual cost written, or cleared.
    ///
    /// **`stop: nil` means the day's lodging.** The two live in different places on a `DayPlan`
    /// but are the same gesture to a traveller, and `Spend.of` reads them identically.
    ///
    /// **`amount: nil` clears back to the estimate**, which is what an emptied field means — the
    /// web's `onBlur` sends `undefined` for an empty string for exactly this reason. Passing 0 is
    /// a different statement ("this turned out to be free") and is kept.
    ///
    /// Out-of-range indices return the itinerary unchanged rather than trapping. A stale index
    /// can outlive the day it addressed — a shorter plan can arrive while a field is focused —
    /// and losing an edit is better than a crash on a screen someone is typing into.
    func settingActualCost(day: Int, stop: Int?, to amount: Double?) -> Itinerary {
        guard days.indices.contains(day) else { return self }
        var copy = self
        if let stop {
            guard copy.days[day].stops.indices.contains(stop) else { return self }
            copy.days[day].stops[stop].actualCost = amount
        } else {
            guard copy.days[day].lodging != nil else { return self }
            copy.days[day].lodging?.actualCost = amount
        }
        return copy
    }
}

/// One tile in the day's breakdown.
///
/// The SF Symbol travels with it rather than being matched up in the view: the whole point of
/// this type is that the label, the figure and the mark are one decision.
public struct SpendTile: Sendable, Equatable, Identifiable {
    public let label: String
    public let amount: Double
    public let symbol: String
    public var id: String { label }
}

/// One category's place in the day, for the band that draws the day's composition.
///
/// **`fraction` and `drawn` are separate fields on purpose.** The band floors a tiny segment so
/// it is visible at all, which makes what it draws *not* the true share; keeping the distorted
/// number in its own property is what stops it leaking into a printed figure. Anything with a
/// `%` or a `$` on screen reads `percent` or the tile; only geometry reads `drawn`.
public struct SpendShare: Sendable, Equatable, Identifiable {
    public let tile: SpendTile
    /// The true share of the day, `0...1`.
    public let fraction: Double
    /// What the band draws: floored, then renormalised so the segments still fill the track.
    public let drawn: Double
    /// The printed percentage as a whole number. **These sum to exactly 100.**
    public let percent: Int
    public var id: String { tile.label }
}

/// A span of the budget bar: one day's share of the track.
public struct BudgetSegment: Sendable, Equatable {
    public let dayIndex: Int
    /// This day's spend — **always the true total**, even where the span drawing it was truncated
    /// by the budget running out. The readout must not inherit the bar's clipping.
    public let spend: Double
    /// Percent of the track this day occupies.
    public let width: Double
    /// Percent offset of its leading edge.
    public let left: Double
}

public enum Spend {

    /// A stop or lodging's real cost once one has been entered, its estimate until then.
    ///
    /// Public because the rows print it too: once a traveller has said what they paid, that is
    /// the figure the line shows, and it must be the same one the totals used.
    public static func of(cost: Double, actual: Double?) -> Double {
        actual ?? cost
    }

    public static func byCategory(_ day: DayPlan) -> DaySpend {
        var sums = DaySpend()
        for stop in day.stops {
            let amount = of(cost: stop.cost, actual: stop.actualCost)
            switch stop.category {
            case .food:    sums.food += amount
            case .entry:   sums.entry += amount
            case .transit: sums.transit += amount
            case .other:   sums.other += amount
            }
        }
        if let lodging = day.lodging {
            sums.stay = of(cost: lodging.cost, actual: lodging.actualCost)
        }
        sums.total = sums.food + sums.entry + sums.transit + sums.other + sums.stay
        return sums
    }

    /// The day's spend as tiles, **with the empty categories dropped.**
    ///
    /// That filter is the feature. A day of sightseeing used to print
    /// `Food $0 · Entry $0 · Transit $0 · Stay $0` beside a Total nothing on screen accounted
    /// for — because `other` was summed into the total and never given a tile of its own. So a
    /// category with nothing in it gets no tile, and the tiles that remain always add up to the
    /// Total printed beneath them.
    ///
    /// **Total is deliberately not in this list.** It is the sum of these, not a sixth peer, and
    /// the view draws it as a rule beneath the row rather than as another tile.
    public static func tiles(_ spend: DaySpend) -> [SpendTile] {
        [
            SpendTile(label: "Food", amount: spend.food, symbol: StopCategory.food.symbol),
            SpendTile(label: "Entry", amount: spend.entry, symbol: StopCategory.entry.symbol),
            SpendTile(
                label: "Transit", amount: spend.transit, symbol: StopCategory.transit.symbol
            ),
            SpendTile(label: "Other", amount: spend.other, symbol: StopCategory.other.symbol),
            // Stay keeps a literal: lodging is not a `StopCategory` and never will be.
            SpendTile(label: "Stay", amount: spend.stay, symbol: "bed.double"),
        ].filter { $0.amount > 0 }
    }

    /// The day's categories as shares of it, biggest first — the day's *composition* rather
    /// than a list of its amounts.
    ///
    /// **Sorted descending, and that is what makes the band's alpha ramp mean something.** The
    /// palette allows this block exactly one colour (gold; jade acts and coral warns, and the
    /// route hues are map-native), so rank is carried by lightness. Against `tiles`' fixed
    /// category order the ramp would be arbitrary. Ties keep `tiles`' order, so the result is
    /// deterministic for a day with two equal categories.
    ///
    /// **`minimum` is a drawing floor, not a rounding rule.** A $2 category in a $665 day is
    /// 0.3% — at 362pt that is a sub-pixel segment, which draws as nothing or as a stray
    /// hairline against its own separator. Each share is floored to `minimum` and the set is
    /// then renormalised, so the segments still fill the track exactly and the distortion is
    /// confined to `drawn`.
    ///
    /// **`percent` uses largest remainder, so the parts add up.** Rounding 48.6 / 41.6 / 9.7
    /// each to nearest gives 49 + 42 + 10 = 101, and this module exists so that the parts and
    /// the total cannot disagree — `tiles` says as much about its own filter. Floor every
    /// share, then hand the leftover points to the largest fractional remainders.
    ///
    /// An empty or costless day returns `[]`, same as `tiles`.
    public static func shares(_ spend: DaySpend, minimum: Double = 0.035) -> [SpendShare] {
        let ordered = tiles(spend)
        let total = ordered.reduce(0) { $0 + $1.amount }
        guard total > 0 else { return [] }

        // `enumerated` before the sort, so the original index survives as the tie-break.
        let ranked = ordered.enumerated()
            .sorted { ($0.element.amount, -Double($0.offset)) > ($1.element.amount, -Double($1.offset)) }
            .map(\.element)

        let fractions = ranked.map { $0.amount / total }

        let floored = fractions.map { Swift.max($0, minimum) }
        let flooredTotal = floored.reduce(0, +)
        let drawn = floored.map { $0 / flooredTotal }

        var percents = fractions.map { Int(($0 * 100).rounded(.down)) }
        let leftover = 100 - percents.reduce(0, +)
        if leftover > 0 {
            let byRemainder = fractions.indices.sorted {
                let a = fractions[$0] * 100, b = fractions[$1] * 100
                let ra = a - a.rounded(.down), rb = b - b.rounded(.down)
                // Ties go to the larger share, then to the earlier index, so this is stable.
                return (ra, fractions[$0], -Double($1)) > (rb, fractions[$1], -Double($0))
            }
            for index in byRemainder.prefix(leftover) { percents[index] += 1 }
        }

        return ranked.indices.map {
            SpendShare(
                tile: ranked[$0], fraction: fractions[$0], drawn: drawn[$0], percent: percents[$0]
            )
        }
    }

    /// **Delegates rather than reducing again.** The breakdown's Total tile *is* this day's
    /// contribution to the budget bar, so the two cannot be allowed to drift.
    public static func day(_ day: DayPlan) -> Double {
        byCategory(day).total
    }

    public static func trip(_ days: [DayPlan]) -> Double {
        days.reduce(0) { $0 + day($1) }
    }

    /// How far past its own plan a day went, or nil.
    ///
    /// **Both halves already existed and the banner needed them to agree.** Asking
    /// `day(d) > planned(d)` in the view and then recomputing the difference is two chances to
    /// disagree about one fact; this makes the condition and the figure one decision.
    ///
    /// `nil` at exactly equal — a day that landed on its plan did not overspend, and a coral
    /// banner reading "ran $0 over" is a false alarm.
    public static func overspend(_ day: DayPlan) -> Double? {
        let over = self.day(day) - planned(day)
        return over > 0 ? over : nil
    }

    /// What the plan *said* a day would cost — the one summation that deliberately ignores
    /// actuals, because it is the baseline an overspend is measured against.
    public static func planned(_ day: DayPlan) -> Double {
        (day.lodging?.cost ?? 0) + day.stops.reduce(0) { $0 + $1.cost }
    }

    /// The budget bar's fill, cut into one span per day.
    ///
    /// **Not a fourth summation.** Each width is `day(d) / budget` and the bar's total is
    /// `trip(days)`, which is *defined* as the sum of `day`. The spans therefore add to the fill
    /// by construction rather than by coincidence.
    ///
    /// **One denominator, always the budget.** A span's length means the same thing under, at and
    /// over budget. Over budget the days fill in order, the day that crosses is drawn partial, and
    /// days after it get nothing — which is not a fallback but the honest reading: *the budget ran
    /// out on day four*. The rejected alternative rescaled every span by `budget / spent` so all
    /// days stay visible; that quietly swaps the denominator the moment you cross, so one length
    /// would mean "share of budget" on Monday and "share of spend" on Tuesday.
    ///
    /// Zero-spend days are dropped rather than emitted at zero width, because a zero-width span
    /// still draws its separator — a hairline sitting on the bar marking nothing.
    public static func budgetSegments(_ days: [DayPlan], budget: Double) -> [BudgetSegment] {
        guard budget > 0 else { return [] }

        var out: [BudgetSegment] = []
        var used: Double = 0
        for (dayIndex, dayPlan) in days.enumerated() {
            // Clamped at zero: a negative cost off the model would otherwise *give back* room to
            // the days after it. The readout still reports the true figure.
            let spend = max(0, day(dayPlan))
            let width = min(100 - used, (spend / budget) * 100)
            guard width > 0 else { continue }
            out.append(BudgetSegment(dayIndex: dayIndex, spend: spend, width: width, left: used))
            used += width
        }
        return out
    }
}
