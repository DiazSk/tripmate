import Foundation

/// What to say while a model is working.
///
/// **Flavour over a truth, never instead of one.** The stage line underneath still reports what
/// the server is actually doing — reading the place, writing the days, putting it on the map —
/// and these words make no claim of their own. That split is the point: a rotating verb that
/// *asserted* a step ("costing it out") would be lying whenever the run was somewhere else, and
/// the stages arrive minutes apart, so it would be lying most of the time.
///
/// The rotation is derived from the clock rather than driven by a timer, so there is no state to
/// own, nothing to invalidate on disappear, and a `TimelineView` can render it directly.
public enum Thinking {

    /// Present participles only, and deliberately about *thinking* rather than about travel.
    /// A word naming a planning step would read as progress and there is none to report here.
    public static let words = [
        "Thinking", "Considering", "Weighing", "Synthesising", "Composing",
        "Deliberating", "Reasoning", "Drafting", "Refining", "Pondering",
    ]

    /// How long each word holds. Long enough to read, short enough that a four-minute run does
    /// not look frozen.
    public static let period: TimeInterval = 2.5

    /// The word showing at a given instant.
    ///
    /// **`floor`, not `Int(_:)`, and the difference is only visible before 2001.**
    /// `timeIntervalSinceReferenceDate` is negative then, and `Int(-0.5)` truncates toward zero
    /// while `floor` goes down — so truncation makes index 0 last twice as long and, worse, the
    /// remainder goes negative and subscripting traps. A simulator with a reset clock is exactly
    /// where that would be found.
    public static func word(at instant: Date, period: TimeInterval = period) -> String {
        let step = Int(floor(instant.timeIntervalSinceReferenceDate / period))
        let index = ((step % words.count) + words.count) % words.count
        return words[index]
    }
}
