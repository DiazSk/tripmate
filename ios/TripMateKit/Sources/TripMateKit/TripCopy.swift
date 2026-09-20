import Foundation

/// The sentences the trip screen says about itself.
///
/// In the kit for the reason `TripsCopy` already is: `swift test` cannot reach a SwiftUI body,
/// so a string built inside a `View` is a string nothing can check. Two of these carry a rule
/// `DESIGN.md` states and no compiler enforces — *never signal a state with colour alone* — so
/// the overspend and draft lines are tested for carrying the word and the amount, not just for
/// being coral.
public enum TripCopy {

    /// `Day 3 of 9`. The pinned header's day control, and its accessibility value.
    public static func dayPosition(_ index: Int, of count: Int) -> String {
        "Day \(index + 1) of \(count)"
    }

    /// `Day 3 · Sep 14 · 5 stops` — the one line the capsule shows over a live map.
    ///
    /// The date goes through `DayDisplay.formatDate`, never the raw ISO string. This screen has
    /// already shipped `2026-09-12 → 2026-09-20` to a traveller once.
    public static func dayFacts(_ day: DayPlan, index: Int, currentYear: Int? = nil) -> String {
        let count = day.stops.count
        return [
            "Day \(index + 1)",
            DayDisplay.formatDate(day.date, currentYear: currentYear),
            "\(count) \(count == 1 ? "stop" : "stops")",
        ].joined(separator: " · ")
    }

    /// `Ran $48 over plan.` — nil when the day did not.
    ///
    /// **Carries the word and the amount.** The colour is the third signal, not the first: a
    /// traveller who cannot distinguish coral from bone still reads that this went over, and
    /// by how much.
    public static func overspend(_ day: DayPlan) -> String? {
        guard let over = Spend.overspend(day) else { return nil }
        return "Ran \(money(over)) over plan."
    }

    /// The draft notice. Names the sweep rather than saying "unsaved", because the thing worth
    /// knowing is that it disappears on its own.
    public static let draftNotice =
        "This plan is still a draft. Unkept drafts are cleared after 30 days."

    /// Whole dollars. Stops short of `Decimal`/currency-code work the app has no need for yet —
    /// every figure on this wire is USD, and `Spend` already rounds nothing.
    static func money(_ amount: Double) -> String {
        amount.formatted(.currency(code: "USD").precision(.fractionLength(0)))
    }
}
