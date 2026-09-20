import Foundation

/// The one sentence the memories wall says about itself.
///
/// In the kit rather than the view because it is three branches, a plural and a string split —
/// and because the web shipped a bug here worth not repeating: its hero draws at most five
/// tiles, and an early version built this sentence from that same five-item slice, so a
/// traveller with nine trips read a count of nine beside "from X to Y" naming two trips that
/// were not the first and last. `TripsView.tsx:194` fixed it by reading the *whole* list for the
/// copy and the slice only for the grid. This reads the whole list; there is no slice here to
/// get wrong.
public enum TripsCopy {

    /// `4 trips remembered, from Val d'Orcia to Kyoto.`
    ///
    /// Saved trips only. Drafts are not remembered — that is what makes them drafts — and
    /// counting them here would contradict the tab sitting directly under this line.
    public static func countLine(_ trips: [TripSummary]) -> String {
        let count = trips.count
        let head = "\(count) \(count == 1 ? "trip" : "trips") remembered"
        guard let first = trips.first.map({ place($0.destination) }),
              let last = trips.last.map({ place($0.destination) })
        else { return head + "." }
        // One trip, or several that all name the same place, cannot be a journey "from X to Y".
        return first == last ? "\(head), starting with \(first)." : "\(head), from \(first) to \(last)."
    }

    /// `Val d'Orcia, Italy` → `Val d'Orcia`. The country is the same word on every card and
    /// carries nothing in a sentence naming two of them.
    ///
    /// **`prefix(while:)` and not `split(separator: ",")`.** `split` drops empty components, so
    /// a destination that somehow begins with a comma returns the *country* as its first
    /// element — a silent wrong answer where this returns an empty string and reads as one.
    private static func place(_ destination: String) -> String {
        String(destination.prefix(while: { $0 != "," }))
            .trimmingCharacters(in: .whitespaces)
    }
}
