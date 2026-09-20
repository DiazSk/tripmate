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
        let parts = iso.split(separator: "-", omittingEmptySubsequences: false).map { Int($0) }
        guard parts.count == 3, let y = parts[0], let m = parts[1], let d = parts[2],
              months.indices.contains(m - 1)
        else { return iso }
        let base = "\(months[m - 1]) \(d)"
        // The year is only worth the space when it is not the obvious one.
        let current = year ?? Calendar.current.component(.year, from: Date())
        return y == current ? base : "\(base), '\(String(y).suffix(2))"
    }

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
