import Foundation

/// The parts of a day a stop list is chunked by, in the order they occur.
///
/// **Three, and a fourth was built and cut on measurement.** A separate "Night" from 9pm reads
/// well in the abstract — a 6:30pm dinner and a midnight bar are not the same evening — but
/// against this app's own output it manufactured groups of one: across four days of the Mumbai
/// plan it produced 4 headings over 6 stops, 4 over 5, and 4 over 5, so the headings nearly
/// outnumbered the rows they organised. Folding it into Evening gives 2-3 groups of 1-3 stops on
/// the same data, which is chunking rather than confetti.
///
/// The cost, stated: a 1am stop is labelled Evening. That is the colloquial reading anyway, and
/// every row carries its own clock time regardless.
public enum TimeOfDay: String, Sendable, CaseIterable {
    case morning = "Morning", afternoon = "Afternoon", evening = "Evening"
}

public enum DaySchedule {

    /// Minutes since midnight, or `nil` if this is not a time.
    ///
    /// The model is asked for a clock time and generally sends `"1:00 PM"`, but nothing enforces
    /// it — the same reason `normalizeDays` exists — so this takes 24-hour (`"13:00"`), 12-hour
    /// with a meridiem in any case or spacing, and returns `nil` for anything else rather than
    /// guessing.
    ///
    /// **`12 AM` is midnight and `12 PM` is noon.** The one case where the 12-hour clock does not
    /// simply add twelve, and the one this would otherwise get exactly backwards.
    public static func minutes(fromClock time: String?) -> Int? {
        guard let time else { return nil }
        let pattern = #"^\s*(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?\s*$"#
        guard let re = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
              let m = re.firstMatch(in: time, range: NSRange(time.startIndex..., in: time))
        else { return nil }

        func group(_ i: Int) -> String? {
            Range(m.range(at: i), in: time).map { String(time[$0]) }
        }
        guard let hourText = group(1), var hour = Int(hourText) else { return nil }
        let minute = group(2).flatMap(Int.init) ?? 0
        guard minute <= 59 else { return nil }

        if let meridiem = group(3)?.lowercased().first {
            guard (1...12).contains(hour) else { return nil }
            if hour == 12 { hour = 0 }
            if meridiem == "p" { hour += 12 }
        } else if hour > 23 {
            return nil
        }
        return hour * 60 + minute
    }

    /// **Boundaries are the ordinary English ones, not even quarters.** Morning opens at 5am,
    /// afternoon starts at noon by definition, and evening at 5pm — which is where this plan's
    /// dinners land. Evening runs to 5am, so it is the fallthrough rather than a range: it is the
    /// bucket that wraps past midnight.
    public static func timeOfDay(_ minutesSinceMidnight: Int) -> TimeOfDay {
        let m = ((minutesSinceMidnight % 1440) + 1440) % 1440
        if m >= 5 * 60 && m < 12 * 60 { return .morning }
        if m >= 12 * 60 && m < 17 * 60 { return .afternoon }
        return .evening
    }

    public struct StopGroup: Sendable, Equatable, Identifiable {
        /// `nil` when not one stop in the day carried a readable time — one group holding
        /// everything, drawn with **no heading**. A "Morning" over a day whose timing is unknown
        /// invents a fact, and the system's rule is not to label a value that isn't there.
        public let label: TimeOfDay?
        /// Each stop with **the index it had in the day's own array** — the index the map camera
        /// and the emphasis highlight both speak in.
        public let stops: [(stop: Stop, index: Int)]

        public var id: String { "\(label?.rawValue ?? "—")-\(stops.first?.index ?? -1)" }

        public static func == (a: StopGroup, b: StopGroup) -> Bool {
            a.label == b.label && a.stops.map(\.index) == b.stops.map(\.index)
        }
    }

    /// Chunk a day's stops into consecutive parts of the day.
    ///
    /// **Order is never changed.** This walks the list as given and starts a new group only when
    /// the label changes, so a plan that puts a 9am stop after a 3pm one produces
    /// `Afternoon → Morning` rather than being silently re-sorted behind the traveller's back.
    /// The order is the model's decision and sometimes the traveller's; this is a heading, not a
    /// sort.
    ///
    /// A stop with no readable time joins the group in progress rather than forming an
    /// "Unscheduled" bucket — a lone untimed stop between two afternoon ones is an afternoon
    /// stop. Leading untimed stops borrow the first real label, so nothing is filed under a guess.
    /// The hours a group of stops runs between, as `11:00 – 14:30`, for the section rule that
    /// opens it.
    ///
    /// **Start times only, never a computed end.** A stop's length is `durationLabel`, free
    /// prose the model writes ("about 2 hours", "1.5 hours"), so an end time would be parsed out
    /// of a sentence and printed as though it were a fact. The first and last *starts* are
    /// exact.
    ///
    /// `nil` when fewer than two stops carry a readable clock, because a span needs two ends and
    /// `11:00 – 11:00` is not one.
    public static func span(_ stops: [Stop]) -> String? {
        let times = stops.compactMap { minutes(fromClock: $0.time) }
        guard let first = times.first, let last = times.last, first != last else { return nil }
        return "\(clock(first)) – \(clock(last))"
    }

    /// Minutes past midnight back to a 24-hour clock. Zero-padded so a column of these lines up.
    private static func clock(_ minutes: Int) -> String {
        String(format: "%02d:%02d", minutes / 60, minutes % 60)
    }

    public static func group(_ stops: [Stop]) -> [StopGroup] {
        let labels = stops.map { minutes(fromClock: $0.time).map(timeOfDay) }
        var current = labels.first(where: { $0 != nil }) ?? nil

        var groups: [(label: TimeOfDay?, stops: [(stop: Stop, index: Int)])] = []
        for (index, stop) in stops.enumerated() {
            let label = labels[index] ?? current
            current = label
            if let last = groups.last, last.label == label {
                groups[groups.count - 1].stops.append((stop, index))
            } else {
                groups.append((label, [(stop, index)]))
            }
        }
        return groups.map { StopGroup(label: $0.label, stops: $0.stops) }
    }
}
