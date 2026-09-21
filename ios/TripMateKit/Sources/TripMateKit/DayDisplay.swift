import Foundation

/// How a day states itself: its date, and what the sky is doing.
///
/// Pure, and in the kit rather than the view, because both halves have a shipped bug in their
/// history — see `formatDate` and `readProse`.
public enum DayDisplay {

    private static let months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ]

    /// `2026-09-19` → `Sep 19`, and `Sep 19, '27` in any year but this one.
    ///
    /// **No `Date` is constructed anywhere here, and that is the point.** `2026-09-19` is UTC
    /// midnight; a local-timezone formatter rolls it back a day anywhere west of Greenwich, which
    /// this codebase has already shipped once into generated output. Splitting the string cannot
    /// have a timezone, so the bug is unreachable rather than avoided — which is also less code
    /// than configuring a `DateFormatter` correctly.
    /// `year` is injectable only so the year-suffix rule is testable without a clock.
    public static func formatDate(_ iso: String, currentYear year: Int? = nil) -> String {
        guard let date = split(iso) else { return iso }
        let base = "\(months[date.month - 1]) \(date.day)"
        // The year is only worth the space when it is not the obvious one.
        let current = year ?? Calendar.current.component(.year, from: Date())
        return date.year == current ? base : "\(base), '\(suffix(date.year))"
    }

    /// `2026-09-19` → `Saturday, 19 September`. The plan sheet's masthead, set in the serif.
    ///
    /// **Still no `Date`, and now not even a `Calendar`.** The same UTC-midnight trap applies
    /// (`formatDate`'s comment has the detail), and a weekday is the one part that looks like it
    /// needs a calendar — so the weekday comes out of Zeller's congruence instead, which is
    /// arithmetic on the three integers `split` already produced. A formatter here would be the
    /// fourth place in this codebase to reach for a timezone it does not want.
    ///
    /// The year is never printed: this sits under a `DAY n OF m` overline inside a trip whose
    /// dates the traveller chose, where a year is noise.
    public static func formatDateline(_ iso: String) -> String {
        guard let date = split(iso) else { return iso }
        return "\(weekdays[weekdayIndex(date)]), \(date.day) \(fullMonths[date.month - 1])"
    }

    /// Zeller's congruence, returning 0 = Sunday so it indexes `weekdays` directly.
    private static func weekdayIndex(_ date: (year: Int, month: Int, day: Int)) -> Int {
        // January and February count as months 13 and 14 of the preceding year.
        let m = date.month < 3 ? date.month + 12 : date.month
        let y = date.month < 3 ? date.year - 1 : date.year
        let k = y % 100
        let j = y / 100
        let h = (date.day + (13 * (m + 1)) / 5 + k + k / 4 + j / 4 + 5 * j) % 7
        // Zeller yields 0 = Saturday; shift so 0 = Sunday.
        return (h + 6) % 7
    }

    private static let weekdays = [
        "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
    ]

    private static let fullMonths = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ]

    /// `2026-09-12`, `2026-09-20` → `Sep 12 – 20`. One month named once.
    ///
    /// **The collapse tests the month *and* the year, and the second half is the whole reason
    /// this is not two `formatDate` calls with a dash between them.** `2026-09-19` to
    /// `2027-09-19` is the same month number a year apart, and collapsing it prints `Sep 19 –
    /// 19`, which says a trip lasted a day when it lasted a year.
    ///
    /// When the year does need saying it goes on the **end**, not the start: `Sep 19 – 23, '27`
    /// reads as one range in 2027, where `Sep 19, '27 – 23` reads as a typo. The web never hits
    /// this — it prints no year at all — so there is no shape to copy here.
    ///
    /// No `Date`, for the reason `formatDate` gives above. An unparseable side falls through to
    /// the raw strings rather than inventing a date, which is what the list renders today.
    public static func formatRange(
        _ start: String, _ end: String, currentYear year: Int? = nil
    ) -> String {
        guard let from = split(start), let to = split(end) else { return "\(start) – \(end)" }
        let current = year ?? Calendar.current.component(.year, from: Date())
        guard from.year == to.year, from.month == to.month else {
            return formatDate(start, currentYear: current)
                + " – " + formatDate(end, currentYear: current)
        }
        let head = "\(months[from.month - 1]) \(from.day)"
        let tail = from.year == current ? "\(to.day)" : "\(to.day), '\(suffix(from.year))"
        return "\(head) – \(tail)"
    }

    /// The one parser both spellings share, so they cannot disagree about what a date is.
    private static func split(_ iso: String) -> (year: Int, month: Int, day: Int)? {
        let parts = iso.split(separator: "-", omittingEmptySubsequences: false).map { Int($0) }
        guard parts.count == 3, let y = parts[0], let m = parts[1], let d = parts[2],
              months.indices.contains(m - 1)
        else { return nil }
        return (y, m, d)
    }

    private static func suffix(_ year: Int) -> String { String(String(year).suffix(2)) }

    public enum WeatherIcon: String, Sendable, Equatable {
        case sun, cloud, rain

        /// SF Symbols, chosen to read at caption size rather than for taxonomy — the same
        /// three-icon reduction the web makes.
        public var symbol: String {
            switch self {
            case .sun: "sun.max"
            case .cloud: "cloud"
            case .rain: "cloud.rain"
            }
        }
    }

    public struct WeatherRead: Sendable, Equatable {
        public var icon: WeatherIcon
        public var temp: String?
        public var label: String?
        /// Rain probability, only when a real forecast supplied one.
        public var rain: Double?
        /// The figures are last year's same-date weather, not a forecast.
        public var typical: Bool

        /// Nothing to say, so the badge does not draw — `DESIGN.md`: don't show a chip for a
        /// value that isn't there.
        public var isEmpty: Bool { temp == nil && label == nil }
    }

    public static func read(_ day: DayPlan) -> WeatherRead {
        day.weatherDetail.map(readForecast) ?? readProse(day.weather)
    }

    /// WMO codes as Open-Meteo returns them, mapped onto the three icons the system draws.
    static func readForecast(_ w: DayWeather) -> WeatherRead {
        let temp = w.tempMinC.isFinite && w.tempMaxC.isFinite
            ? "\(Int(w.tempMinC.rounded()))–\(Int(w.tempMaxC.rounded()))°C"
            : nil
        func read(_ icon: WeatherIcon, _ label: String?) -> WeatherRead {
            WeatherRead(icon: icon, temp: temp, label: label,
                        rain: w.precipitationProbability, typical: w.historical)
        }
        guard let code = w.weatherCode else { return read(.sun, nil) }
        switch code {
        case 95...: return read(.rain, "Thunderstorms")
        case 85...: return read(.cloud, "Snow showers")
        case 80...: return read(.rain, "Showers")
        case 71...: return read(.cloud, "Snow")
        case 61...: return read(.rain, "Rain")
        case 51...: return read(.rain, "Drizzle")
        case 45...: return read(.cloud, "Fog")
        case 3: return read(.cloud, "Overcast")
        case 1...: return read(.cloud, "Partly cloudy")
        default: return read(.sun, "Clear")
        }
    }

    private static let tempWords = ["hot", "warm", "mild", "cool", "cold"]

    /// For itineraries saved before `weatherDetail` existed: condense the model's free text
    /// ("Warm (24-32°C) with high rain chance") to an icon and a temperature.
    ///
    /// **Two shipped bugs are encoded here as requirements.** The decimal in the range is not
    /// decoration — the model writes `13.6-21°C`, and a pattern that cannot span the `.6` matches
    /// the *fragment* `6-21` and prints 6–21°C. And an unrecognised condition returns **no**
    /// label rather than a guess: "Windy and grey" used to come back as a sun captioned "Clear".
    static func readProse(_ weather: String) -> WeatherRead {
        let lower = weather.lowercased()
        let num = #"-?\d+(?:\.\d+)?"#
        let temp = firstMatch(#"(\#(num))\s*[-–—]\s*(\#(num))\s*°?\s*C"#, in: weather, groups: 2)
            .map { "\(Int($0[0].rounded()))–\(Int($0[1].rounded()))°C" }
            ?? firstMatch(#"(\#(num))\s*°\s*C"#, in: weather, groups: 1)
                .map { "\(Int($0[0].rounded()))°C" }

        func read(_ icon: WeatherIcon, _ label: String?) -> WeatherRead {
            WeatherRead(icon: icon, temp: temp, label: label, rain: nil, typical: false)
        }
        if lower.contains(anyOf: ["rain", "shower", "storm", "wet"]) { return read(.rain, "Rain likely") }
        if lower.contains(anyOf: ["snow", "sleet"]) { return read(.cloud, "Snow") }
        if lower.contains(anyOf: ["cloud", "overcast"]) { return read(.cloud, "Cloudy") }
        if lower.contains(anyOf: ["clear", "sunny", "sun"]) { return read(.sun, "Clear") }
        let word = tempWords.first { lower.contains($0) }
        return read(.sun, word.map { $0.prefix(1).uppercased() + $0.dropFirst() })
    }

    /// The captured numbers of the first match, or nil. Enough regex for two patterns; a
    /// `Regex` literal would need the pattern known at compile time, and these are built.
    private static func firstMatch(_ pattern: String, in s: String, groups: Int) -> [Double]? {
        guard let re = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
              let m = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s))
        else { return nil }
        let values = (1...groups).compactMap { i -> Double? in
            Range(m.range(at: i), in: s).flatMap { Double(s[$0]) }
        }
        return values.count == groups ? values : nil
    }
}

private extension String {
    func contains(anyOf needles: [String]) -> Bool { needles.contains { contains($0) } }
}
