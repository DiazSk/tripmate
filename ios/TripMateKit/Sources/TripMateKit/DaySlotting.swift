import Foundation

/// Where in a day a newly-found place goes, and what clock time it gets.
///
/// `DayFit` answers *which day* a searched place belongs to, from geometry. This answers the other
/// half: given that day and a part of it the traveller picked, **which position in the running
/// order and what time** — without moving anything already in the plan.
///
/// **No model call.** A day already has times in it; "what time is free between these two stops"
/// is arithmetic, and arithmetic is instant, offline and the same answer every time it is asked.
///
/// Ported from `src/lib/daySlotting.ts`, whose 22 cases are ported with it.
public enum DaySlotting {

    /// The windows a new stop may be *assigned* into, deliberately narrower than the bands
    /// `DaySchedule.timeOfDay` reads an existing stop back out of.
    ///
    /// Classification has to cover the whole clock — a 5am flight is somebody's morning — but
    /// assignment does not: nothing this app puts into a day unprompted belongs at 5am.
    ///
    /// **The invariant these preserve:** any time assigned from a window classifies back into the
    /// same slot under `DaySchedule.timeOfDay`. The stop list groups by that function, so a stop
    /// the traveller filed under Morning appearing beneath an AFTERNOON heading would be the
    /// feature contradicting itself on screen. Every window sits strictly inside its band, and
    /// `plan` clamps to the window even when the day is too full to honour it, precisely so this
    /// cannot break.
    public struct Window: Sendable {
        public let start: Int, end: Int, anchor: Int
    }

    public static let windows: [TimeOfDay: Window] = [
        .morning: Window(start: 8 * 60, end: 12 * 60, anchor: 10 * 60),
        .afternoon: Window(start: 12 * 60, end: 17 * 60, anchor: 14 * 60 + 30),
        .evening: Window(start: 17 * 60, end: 22 * 60, anchor: 19 * 60),
    ]

    /// Minutes between one stop ending and the next beginning. A city block, a coffee, a wrong
    /// turn — **not** a routed travel time, which this has no router to compute and no business
    /// pretending to.
    public static let transitBufferMin = 15

    /// How long a stop with nothing said about it is assumed to take, **for spacing only**.
    ///
    /// Never written into the plan: `durationLabel` stays empty on a searched place, because an
    /// hour is this module's working assumption and not a fact anyone supplied. It exists so the
    /// *next* stop is not scheduled on top of it.
    public static let defaultVisitMin = 60

    // MARK: - Suggesting a slot

    /// Words in a place's own name that outrank its category.
    ///
    /// A category is a coarse bucket — "restaurant" covers a breakfast counter and a tasting menu
    /// — and the name is very often the finer signal. Ordered: the first list that matches wins,
    /// so a "Sunrise Rooftop Bar" reads as evening only if nothing in the morning list hit first.
    ///
    /// **Whole words, and that is load-bearing**: "Sunset Boulevard Diner" must not be filed as a
    /// morning venue for containing "sun", and "Winery Lane Coffee" is a coffee shop rather than
    /// an evening venue that happens to contain "wine". The web does this with `\b` in a regex;
    /// splitting the name into words is the same rule and one line.
    static let nameHints: [(slot: TimeOfDay, words: Set<String>)] = [
        (.morning, ["breakfast", "brunch", "bakery", "bakehouse", "coffee", "espresso",
                    "patisserie", "sunrise"]),
        (.evening, ["night", "nightclub", "club", "rooftop", "sunset", "cocktail", "wine",
                    "jazz", "tavern", "pub", "brewery", "dinner"]),
    ]

    /// What time of day this place probably wants, as the picker's default.
    ///
    /// A *suggestion*: all three slots stay one tap away, so being wrong costs a tap rather than a
    /// wrong plan. It reads the place alone and deliberately not the day — "when is this place
    /// good" and "when does this day have room" are different questions, and the second is
    /// `plan`'s.
    ///
    /// The category defaults are about when a place is reliably *open and at its best* rather than
    /// when it is conceivable: cafés are a morning thing, bars often do not open before evening at
    /// all, and a restaurant searched for while planning is far more often dinner than lunch.
    /// Everything else gets Afternoon, the band that is never closed and never absurd.
    public static func suggest(name: String, category: String?) -> TimeOfDay {
        let words = Set(
            name.lowercased().split { !$0.isLetter && !$0.isNumber }.map(String.init)
        )
        for hint in nameHints where !hint.words.isDisjoint(with: words) { return hint.slot }
        switch category {
        case "cafe": return .morning
        case "bar", "restaurant": return .evening
        default: return .afternoon
        }
    }

    // MARK: - Placing it

    public struct SlotPlan: Sendable, Equatable {
        /// Where the new stop goes in the day's `stops` array. Nothing already there moves.
        public let index: Int
        /// The clock time to give it, in the plan's own format.
        public let time: String
        /// True when the chosen part of the day had no clear gap and the stop was fitted in
        /// anyway. **Surfaced rather than swallowed**: it is the difference between "we found it a
        /// slot" and "your afternoon is now shoulder to shoulder", and the traveller is the one
        /// who can decide whether that matters.
        public let tight: Bool
    }

    /// A stop reduced to what slotting needs. One whose clock time will not parse is dropped and
    /// bounds nothing — the same treatment `DaySchedule.group` gives it.
    ///
    /// A missing `durationLabel` is spaced as `defaultVisitMin` here, which is the opposite of
    /// `Overlap`'s rule (zero) and both are right: `Overlap` reports a contradiction and must not
    /// manufacture one, while this is choosing where to put something and has to assume the stop
    /// before it takes *some* time.
    private static func anchors(_ stops: [Stop]) -> [(index: Int, start: Int, end: Int)] {
        stops.enumerated().compactMap { index, stop in
            guard let start = DaySchedule.minutes(fromClock: stop.time) else { return nil }
            return (index, start, start + (Overlap.duration(stop.durationLabel) ?? defaultVisitMin))
        }
    }

    /// Where in the day a new stop goes, given the part of the day the traveller chose.
    ///
    /// **Nothing already in the plan moves.** The new stop is inserted at the end of its chosen
    /// part of the day. That is the predictable answer, and predictable matters more than optimal:
    /// a traveller who adds three cafés to a morning gets them in the order they added them rather
    /// than watching the plan re-sort itself around a hunt for the widest gap.
    ///
    /// The time is the window's anchor pulled into whatever room actually exists between the
    /// neighbours — so a morning already running to 11:30 puts the new stop at 11:45 rather than
    /// insisting on ten o'clock and scheduling it on top of something.
    public static func plan(
        _ stops: [Stop], slot: TimeOfDay, visitMinutes: Int = defaultVisitMin
    ) -> SlotPlan {
        // Every slot has a window; the dictionary is a lookup table, not a source of absence.
        let window = windows[slot]!
        let anchors = anchors(stops)

        // The last stop beginning before this window closes, and the first at or after it. Read in
        // array order — the plan's own running order — rather than sorted by time, because a day
        // whose times are out of order is a day the traveller is looking at, and re-deriving an
        // order it does not have would move things behind their back.
        let before = anchors.last { $0.start < window.end }
        let after = anchors.first { anchor in
            anchor.start >= window.end && (before.map { anchor.index > $0.index } ?? true)
        }

        let index = before.map { $0.index + 1 } ?? (after?.index ?? stops.count)

        let earliest = before.map { max(window.start, $0.end + transitBufferMin) } ?? window.start
        // **`visitMinutes` is measured against the next stop, not the end of the window.**
        // Requiring the whole visit to fit inside the window was the first version and it is wrong
        // about what a window is: a coffee at half past eleven is a morning coffee even though you
        // leave at half past twelve. Measured against a real case — a day whose only morning stop
        // was a two-hour market from nine — that rule declared an 11:15 slot impossible and
        // reported an ordinary morning as full.
        let latest = min(
            window.end - 1,
            after.map { $0.start - visitMinutes - transitBufferMin } ?? Int.max
        )

        var tight = false
        var time: Int
        if earliest <= latest {
            time = min(max(window.anchor, earliest), latest)
        } else {
            // No clean gap. Sit directly after the previous stop rather than at the anchor, never
            // past where the next one starts — then clamp back inside the window, because a stop
            // filed under Morning must still read as morning in the list. The cost of that clamp
            // is a time that can coincide with a neighbour's, which is what `tight` reports.
            tight = true
            time = before?.end ?? window.start
            if let after { time = min(time, after.start) }
        }

        // Floored to a five-minute grid, because a plan is written in times a person would say.
        // The clamped tight case forced this: the last minute of the afternoon window is 16:59,
        // and "4:59 PM" in an itinerary reads as a bug rather than as a tight fit. Floor rather
        // than round, so the result can never drift *past* `latest` and into the next stop.
        let grid = (min(max(time, window.start), window.end - 1) / 5) * 5
        return SlotPlan(index: index, time: formatClock(max(grid, window.start)), tight: tight)
    }

    /// Minutes since midnight → `"2:30 PM"`. The format every other time in the plan is written in.
    public static func formatClock(_ minutes: Int) -> String {
        let m = ((minutes % 1440) + 1440) % 1440
        let hour24 = m / 60
        let hour12 = hour24 % 12 == 0 ? 12 : hour24 % 12
        return String(format: "%d:%02d %@", hour12, m % 60, hour24 < 12 ? "AM" : "PM")
    }
}

extension StopCategory {
    /// A search category to one of the four a `Stop` has.
    ///
    /// The four exist to drive the day's spend tiles, so this is really asking **what kind of
    /// money is this** — a café and a restaurant are both `food`, a museum charges `entry`, and a
    /// park costs nothing, which is `other` rather than a fifth category nobody totals. Never
    /// `transit`: nothing you search for is a journey.
    public init(searchCategory: String?) {
        switch searchCategory {
        case "cafe", "restaurant", "bar": self = .food
        case "sights": self = .entry
        default: self = .other
        }
    }
}

extension Itinerary {
    /// Put a found place into a day, at the part of the day the traveller chose.
    ///
    /// **This used to append with no time on the web**, on the argument that a searched place has
    /// no time of its own and guessing one would put a claim in the plan nobody made. Half right:
    /// the guess was the problem, not the placement. "End of the day, no time" is itself a claim,
    /// and a worse one — it drops a breakfast spot after dinner. So the traveller picks the part
    /// of the day and `DaySlotting.plan` puts it where that answer means.
    ///
    /// `slot` is optional and omitting it appends, which is the only honest answer when nobody was
    /// asked. `durationLabel` is left blank either way, and that part of the original reasoning
    /// stands: how long you want to spend somewhere is not something a search result knows.
    ///
    /// Out-of-range `day` returns the itinerary unchanged rather than trapping — the caller is a
    /// picker over a list that can be reloaded underneath it.
    public func addingPlace(
        _ name: String, at point: GeoPoint, category: String?, toDay day: Int, slot: TimeOfDay?
    ) -> Itinerary {
        guard days.indices.contains(day) else { return self }
        var stops = days[day].stops
        // Planned before the stop is built, so `Stop.time` can stay `let` — `actualCost` is the
        // one field a traveller changes and the model says so.
        let plan = slot.map { DaySlotting.plan(stops, slot: $0) }
        let stop = Stop(
            name: name, lat: point.lat, lng: point.lng, time: plan?.time ?? "",
            category: StopCategory(searchCategory: category)
        )
        if let plan { stops.insert(stop, at: plan.index) } else { stops.append(stop) }

        var copy = self
        copy.days[day].stops = stops
        return copy
    }
}
