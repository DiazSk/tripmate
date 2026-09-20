import Foundation

/// The one guardrail decidable from what is already on the device.
///
/// The web runs four checks (`guardrails.ts`) — overlap, not-enough-travel-time, a long day
/// without a break, and trip-over-budget. Three of them need travel estimates between stops,
/// which need OSRM, which iOS does not have. **This one needs only `time` and `durationLabel`,
/// both already decoded**, and `DaySchedule.minutes(fromClock:)` already parses half of it.
///
/// It reports what the plan says about itself, not what a router thinks. A stop that starts
/// before the previous one has finished is a contradiction inside the model's own output —
/// no estimate, no tolerance, nothing to be wrong about.
public enum Overlap {

    /// A stop that begins before its predecessor ends.
    public struct Finding: Sendable, Equatable {
        /// Index into `day.stops` of the stop that starts too early.
        public let stopIndex: Int
        public let previous: String
        public let stop: String
        /// How many minutes the two collide by. Always positive.
        public let minutes: Int
    }

    /// **Document order, not time order.** A day's stops are a sequence the traveller walks;
    /// sorting by clock first would hide the case worth reporting, which is the model emitting
    /// them out of order in the first place.
    ///
    /// Stops with an unparseable or missing `time` bind nothing and are skipped — the same
    /// rule `DaySchedule.group` uses. A missing `durationLabel` is treated as zero rather than
    /// as a default hour: inventing a length and then reporting a clash caused by the invention
    /// is exactly the error this check exists to avoid.
    public static func findings(in day: DayPlan) -> [Finding] {
        var out: [Finding] = []
        var previous: (name: String, end: Int)?

        for (index, stop) in day.stops.enumerated() {
            guard let start = DaySchedule.minutes(fromClock: stop.time) else { continue }
            if let last = previous, start < last.end {
                out.append(
                    Finding(
                        stopIndex: index,
                        previous: last.name,
                        stop: stop.name,
                        minutes: last.end - start
                    )
                )
            }
            let end = start + (duration(stop.durationLabel) ?? 0)
            // Carry the later end forward: a long stop still constrains the one after next if
            // the one between it was shorter.
            if previous == nil || end >= previous!.end {
                previous = (stop.name, end)
            }
        }
        return out
    }

    /// `1.5 hours`, `45 min`, `2 hr 30 min` → minutes. nil when nothing parses.
    ///
    /// Ported from `parseDurationLabel` (`daySlotting.ts:73`), including its two guards: a
    /// result over 24 hours or at or below zero is refused rather than believed.
    public static func duration(_ label: String) -> Int? {
        let pattern = #"(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive)
        else { return nil }
        let range = NSRange(label.startIndex..., in: label)
        var total = 0.0
        var matched = false
        for match in regex.matches(in: label, range: range) {
            guard let value = Range(match.range(at: 1), in: label).map({ String(label[$0]) }),
                  let unit = Range(match.range(at: 2), in: label).map({ String(label[$0]) }),
                  let amount = Double(value)
            else { continue }
            matched = true
            total += unit.lowercased().hasPrefix("h") ? amount * 60 : amount
        }
        let minutes = Int(total.rounded())
        guard matched, minutes > 0, minutes <= 24 * 60 else { return nil }
        return minutes
    }
}
