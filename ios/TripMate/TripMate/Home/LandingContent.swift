import Foundation

/// The landing's copy, transcribed from `sceneBeats.ts` and `planExamples.ts`.
///
/// **Static, not fetched.** It is marketing copy that changes when someone rewrites it, and a
/// route to serve twelve fixed strings would be a deployment dependency for a screen that has to
/// work on a plane. The web holds it the same way — as data files, not as a CMS.
enum Landing {

    struct Beat: Identifiable {
        let headline: String
        let label: String
        let prose: String
        let photo: String
        var id: String { label }
    }

    /// What a plan actually knows. Four, in the order the web runs them.
    static let beats: [Beat] = [
        Beat(
            headline: "One 20-minute window, every evening",
            label: "The Blue Hour",
            prose: "Dusk decides whether a city reads as ordinary or unforgettable — every stop "
                 + "we place is timed around catching it.",
            photo: "vernazza-blue-hour"
        ),
        Beat(
            headline: "Lodging, food, and transit — itemized",
            label: "Real Prices",
            prose: "Say what you want to spend and get a plan that actually spends it, priced in "
                 + "before you land — not a lowball guess.",
            photo: "spice-market-barrels"
        ),
        Beat(
            headline: "Real forecast, up to 16 days out",
            label: "Live Weather",
            prose: "Indoor days when it rains, golden hour when it doesn't — the plan already "
                 + "knows before you pack.",
            photo: "storm-over-forest-ridge"
        ),
        Beat(
            headline: "Budget · Mid-range · Luxury",
            label: "Three Ways To Travel",
            prose: "Every tier is priced against your actual dates before you commit to any of "
                 + "them.",
            photo: "balcony-morning-view"
        ),
    ]

    struct Step: Identifiable {
        let number: String
        let title: String
        let prose: String
        var id: String { number }
    }

    static let steps: [Step] = [
        Step(number: "01", title: "You set the constraints",
             prose: "Where, when, how much, and who is going. The budget is a target to hit, not "
                  + "a ceiling to stay under."),
        Step(number: "02", title: "Real data goes in first",
             prose: "Forecast for your actual dates, public holidays, opening hours and travel "
                  + "times — fetched before a single word is written."),
        Step(number: "03", title: "Written, then critiqued",
             prose: "A second pass reviews the finished plan against your budget and pace, and "
                  + "rewrites the days it finds fault with."),
        Step(number: "04", title: "Every place is checked",
             prose: "Coordinates are corrected against OpenStreetMap, so the pins land where the "
                  + "place actually is rather than where the model guessed."),
    ]

    /// **Each card stores a season, never a date.** `planExamples.ts` records why: a stored date
    /// goes stale and prefills a value the wizard's own `min` rejects. The dates below are the
    /// card's *copy*; what a tap actually seeds is the destination.
    struct Example: Identifiable {
        let title: String
        let price: Int
        let whereText: String
        let whenText: String
        let lengthText: String
        let partyText: String
        let photo: String
        var id: String { title }
    }

    static let examples: [Example] = [
        Example(title: "Nine slow days in Tuscany", price: 2600,
                whereText: "Val d'Orcia, Italy", whenText: "Sep 12–20, 2027",
                lengthText: "9 days, 8 nights", partyText: "2 adults",
                photo: "tuscany-cypress-road"),
        Example(title: "Jaipur on a real budget", price: 900,
                whereText: "Jaipur, India", whenText: "Nov 7–13, 2026",
                lengthText: "7 days, 6 nights", partyText: "1 adult",
                photo: "jaipur-amber-fort-elephant"),
        Example(title: "Sinaia when the weather decides", price: 1700,
                whereText: "Sinaia, Romania", whenText: "Feb 6–11, 2027",
                lengthText: "6 days, 5 nights", partyText: "2 adults, 1 child",
                photo: "peles-castle-romania-snow"),
        Example(title: "Wadi Rum, three ways to travel", price: 1200,
                whereText: "Wadi Rum, Jordan", whenText: "Mar 20–26, 2027",
                lengthText: "7 days, 6 nights", partyText: "2 adults",
                photo: "wadi-rum-desert"),
    ]
}
