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
    static func of(cost: Double, actual: Double?) -> Double {
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

    /// **Delegates rather than reducing again.** The breakdown's Total tile *is* this day's
    /// contribution to the budget bar, so the two cannot be allowed to drift.
    public static func day(_ day: DayPlan) -> Double {
        byCategory(day).total
    }

    public static func trip(_ days: [DayPlan]) -> Double {
        days.reduce(0) { $0 + day($1) }
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
