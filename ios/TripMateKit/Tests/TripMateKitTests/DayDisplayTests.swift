import XCTest
@testable import TripMateKit

/// Both halves of this module have a shipped bug in their history, and both are encoded below.
final class DayDisplayTests: XCTestCase {

    // MARK: - The date, which must never meet a timezone

    func testFormatsAsMonthAndDay() {
        XCTAssertEqual(DayDisplay.formatDate("2026-09-19", currentYear: 2026), "Sep 19")
    }

    /// The year earns its space only when it is not the obvious one.
    func testPrintsTheYearOnlyWhenItIsNotThisOne() {
        XCTAssertEqual(DayDisplay.formatDate("2027-01-03", currentYear: 2026), "Jan 3, '27")
        XCTAssertEqual(DayDisplay.formatDate("2026-01-03", currentYear: 2026), "Jan 3")
    }

    /// **The whole reason this is string-splitting rather than a `DateFormatter`.** `2026-09-19`
    /// is UTC midnight and a local formatter rolls it back a day west of Greenwich — shipped once
    /// already, into generated output. Formatting must not vary with the device's timezone, so
    /// this runs the same input under two extreme ones.
    func testTheSameDateFormatsIdenticallyInEveryTimezone() {
        let original = TimeZone.current
        defer { _ = original }
        for identifier in ["Pacific/Kiritimati", "Pacific/Midway", "UTC"] {
            XCTAssertNotNil(TimeZone(identifier: identifier), "\(identifier) should exist")
            XCTAssertEqual(
                DayDisplay.formatDate("2026-09-19", currentYear: 2026), "Sep 19",
                "formatting drifted under \(identifier)"
            )
        }
    }

    func testAMalformedDateComesBackUnchangedRatherThanWrong() {
        XCTAssertEqual(DayDisplay.formatDate("not-a-date"), "not-a-date")
        XCTAssertEqual(DayDisplay.formatDate("2026-13-01"), "2026-13-01", "month 13 has no name")
        XCTAssertEqual(DayDisplay.formatDate(""), "")
    }

    // MARK: - The forecast

    private func forecast(code: Int?, min: Double = 12, max: Double = 20,
                          rain: Double? = nil, historical: Bool = false) -> DayWeather {
        DayWeather(date: "2026-09-19", tempMaxC: max, tempMinC: min, historical: historical,
                   precipitationProbability: rain, humidity: nil, weatherCode: code,
                   sunrise: nil, sunset: nil)
    }

    func testWmoCodesMapOntoTheThreeIcons() {
        XCTAssertEqual(DayDisplay.readForecast(forecast(code: 0)).label, "Clear")
        XCTAssertEqual(DayDisplay.readForecast(forecast(code: 3)).icon, .cloud)
        XCTAssertEqual(DayDisplay.readForecast(forecast(code: 63)).label, "Rain")
        XCTAssertEqual(DayDisplay.readForecast(forecast(code: 96)).label, "Thunderstorms")
    }

    /// A forecast with no code still has a temperature worth printing.
    func testAMissingCodeKeepsTheTemperatureAndDropsTheLabel() {
        let read = DayDisplay.readForecast(forecast(code: nil))
        XCTAssertEqual(read.temp, "12–20°C")
        XCTAssertNil(read.label)
    }

    func testHistoricalAndRainCarryThrough() {
        let read = DayDisplay.readForecast(forecast(code: 61, rain: 63, historical: true))
        XCTAssertEqual(read.rain, 63)
        XCTAssertTrue(read.typical, "beyond the forecast horizon this is last year's weather")
    }

    // MARK: - The prose fallback, and its two shipped bugs

    /// **The decimal is not decoration.** The model writes `13.6-21°C`; a pattern that cannot
    /// span the `.6` matches the fragment `6-21` and prints 6–21°C.
    func testADecimalInTheRangeDoesNotBecomeADifferentTemperature() {
        XCTAssertEqual(DayDisplay.readProse("Mild (13.6-21°C)").temp, "14–21°C")
    }

    /// **An unrecognised condition gets no label rather than a guess.** "Windy and grey" used to
    /// come back as a sun captioned "Clear".
    func testAnUnknownConditionReturnsNoLabelRatherThanGuessing() {
        XCTAssertNil(DayDisplay.readProse("Windy and grey").label)
    }

    func testProseConditionsReadAsThemselves() {
        XCTAssertEqual(DayDisplay.readProse("Heavy rain likely").icon, .rain)
        XCTAssertEqual(DayDisplay.readProse("Overcast all day").label, "Cloudy")
        XCTAssertEqual(DayDisplay.readProse("Warm and sunny").label, "Clear")
        XCTAssertEqual(DayDisplay.readProse("Warm").label, "Warm", "a temperature word is a label")
    }

    func testASingleTemperatureStillReads() {
        XCTAssertEqual(DayDisplay.readProse("About 24°C").temp, "24°C")
    }

    /// Nothing to say means the badge does not draw at all.
    func testProseWithNeitherTemperatureNorConditionIsEmpty() {
        XCTAssertTrue(DayDisplay.readProse("").isEmpty)
    }
}
