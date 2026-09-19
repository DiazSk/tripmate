import Foundation

/// A spending style, ported from `src/lib/tiers.ts`.
///
/// **Nothing selects one of these, and that is the point.** The web app had a tier picker and
/// removed it along with the stored preference: `closestTier` derives the style from the trip's own
/// budget, so a stored style could only ever contradict the number the traveler just typed.
/// `TravelerProfile` still carries a dead `tier` key from that era; nothing reads it, and nothing
/// here writes one.
///
/// `imageSrc`/`imageAlt` do not port — they name SVGs in the web app's `public/`, and the review
/// screen says the style in words.
public struct Tier: Sendable, Equatable {
    public let id: TierId
    public let name: String
    public let description: String
    public let dailyRate: Double
    public let nightlyLodgingRate: Double
    public let headline: String
}

public enum Tiers {

    public static let all: [Tier] = [
        Tier(
            id: .budget,
            name: "Budget",
            description: "Hostels, street food and casual eats, public transit",
            dailyRate: 70,
            nightlyLodgingRate: 40,
            headline: "Needs flexibility built in."
        ),
        Tier(
            id: .midrange,
            name: "Mid-range",
            description: "Boutique hotels, casual-to-nice restaurants, taxis",
            dailyRate: 150,
            nightlyLodgingRate: 150,
            headline: "Comfort, without the compromise."
        ),
        Tier(
            id: .luxury,
            name: "Luxury",
            description: "5-star hotels, fine dining, private tours and transport",
            dailyRate: 350,
            nightlyLodgingRate: 500,
            headline: "Nothing left to chance."
        ),
    ]

    public static func tier(_ id: TierId) -> Tier {
        all.first { $0.id == id } ?? all[0]
    }

    /// Days at the daily rate plus *nights* at the lodging rate — one fewer night than days.
    public static func estimateTotal(_ tier: Tier, days: Int) -> Double {
        let nights = Double(max(days - 1, 0))
        return tier.dailyRate * Double(days) + tier.nightlyLodgingRate * nights
    }

    /// The style whose estimate lands nearest the budget.
    ///
    /// Ties go to the **earlier** tier, because the comparison is strictly `<`. That matters at the
    /// exact midpoint between two styles and is the web's behaviour, not an accident of it.
    public static func closest(budget: Double, days: Int) -> TierId {
        var best = all[0]
        var bestDiff = Double.infinity
        for tier in all {
            let diff = abs(estimateTotal(tier, days: days) - budget)
            if diff < bestDiff {
                bestDiff = diff
                best = tier
            }
        }
        return best.id
    }

    /// Inclusive day count between two ISO dates, floored at 1.
    ///
    /// **Parsed as UTC, deliberately.** `2026-09-19` is UTC midnight, and a local-timezone
    /// formatter rolls it back a day anywhere west of Greenwich — a bug this codebase has already
    /// shipped once, into generated output. `ISO8601DateFormatter` with `.withFullDate` reads the
    /// date-only form in UTC, which is the same thing JavaScript's `new Date("YYYY-MM-DD")` does.
    public static func tripDays(from startDate: String, to endDate: String) -> Int {
        guard let start = isoDate(startDate), let end = isoDate(endDate) else { return 1 }
        let days = (end.timeIntervalSince(start) / 86_400).rounded()
        return max(Int(days) + 1, 1)
    }

    public static let maxTripDays = 30

    public static func isTripTooLong(from startDate: String, to endDate: String) -> Bool {
        tripDays(from: startDate, to: endDate) > maxTripDays
    }

    /// Today, as the ISO date the trip form wants.
    ///
    /// **Local, not UTC** — the web uses `toLocaleDateString("sv-SE")` for exactly this reason:
    /// `toISOString()` would be UTC and offer "yesterday" as the earliest start date to anyone west
    /// of Greenwich in the evening. A traveler picking dates means their own calendar.
    public static func todayISO(_ now: Date = Date(), calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: now)
        return String(
            format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0
        )
    }

    // MARK: - Time of day

    /// `TripLogistics`' `"HH:MM"`, which is **24-hour and locale-independent** — it is what
    /// `<input type="time">` hands the web, and the prompt reads it literally.
    ///
    /// Kept beside `todayISO` because it is the same class of hazard: a value the traveler sees
    /// in their own locale and the server must receive in one fixed format. A 12-hour slip here
    /// sends `11:00` for an 11 PM arrival and nothing downstream can tell.
    public static func hhmm(_ date: Date, calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
    }

    /// The inverse, on an arbitrary day — only the time of day is meaningful.
    public static func time(fromHHMM value: String, calendar: Calendar = .current) -> Date? {
        let parts = value.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2, (0...23).contains(parts[0]), (0...59).contains(parts[1])
        else { return nil }
        return calendar.date(from: DateComponents(hour: parts[0], minute: parts[1]))
    }

    private static func isoDate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate, .withDashSeparatorInDate]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter.date(from: value)
    }
}
