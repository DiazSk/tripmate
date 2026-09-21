import MapKit
import Observation
import SwiftUI

/// Type-ahead for the destination field, from Apple's index rather than the server's.
///
/// **The web has a geocoder combobox here and the phone gets the platform's own.** Open-Meteo's
/// geocoder is what `/api/geocode` wraps, and it is a *coordinate lookup* that happens to accept
/// a name — it answers well for "Porto" and poorly for anything a traveller types loosely.
/// `MKLocalSearchCompleter` is built for exactly this keystroke-by-keystroke job, is free, needs
/// no key, and answers from the same index Maps does.
///
/// **It does not replace the geocode, and that is deliberate.** Picking a suggestion only fills
/// the text; `PlanStore.geocodeDestination()` still runs on blur, because the map preview and
/// the "we couldn't find that place" notice both read `GeocodedPlace`, and the server is sent
/// the same string the web would send. Two sources answering one question would be a second
/// source of truth for where the trip is.
///
/// `resultTypes` is `.address` and not `.pointOfInterest` for the same reason: a destination is
/// a place you go *to*, and offering "Café Guarany" as a trip destination would produce a
/// suggestion the geocoder then fails to find.
@MainActor
@Observable
final class DestinationSuggest: NSObject, MKLocalSearchCompleterDelegate {
    private(set) var results: [Suggestion] = []

    @ObservationIgnored private let completer = MKLocalSearchCompleter()

    struct Suggestion: Identifiable, Hashable, Sendable {
        let title: String
        let subtitle: String

        var id: String { line }
        /// "Porto, Portugal" — one line, because the field it fills is one line.
        var line: String { subtitle.isEmpty ? title : "\(title), \(subtitle)" }
    }

    override init() {
        super.init()
        completer.resultTypes = .address
        completer.delegate = self
    }

    /// **Two characters before asking.** One character matches most of the planet and returns a
    /// list nobody can use.
    func query(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 2 else {
            results = []
            return
        }
        completer.queryFragment = trimmed
    }

    func clear() {
        results = []
    }

    nonisolated func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) {
        // Read the non-Sendable completions here and carry only strings across. Five, because
        // the list sits under a field inside a sheet and a longer one covers the next question.
        let found = completer.results.prefix(5).map {
            Suggestion(title: $0.title, subtitle: $0.subtitle)
        }
        Task { @MainActor [found] in self.results = Array(found) }
    }

    nonisolated func completer(
        _ completer: MKLocalSearchCompleter, didFailWithError error: Error
    ) {
        // A failed lookup is not "no such place" — it is no answer. Saying nothing is right:
        // the field still works typed, and the geocode on blur is the real check.
        Task { @MainActor in self.results = [] }
    }
}

/// Apple's completions, as rows under whichever destination field asked for them.
///
/// Two fields ask — the wizard's dark trough and the home capsule's light one — and the rows
/// differ only in ink, so the tap contract lives here once. **Tapping fills the text and
/// nothing else:** the geocode still decides whether the place exists, so a suggestion the
/// geocoder cannot place lands on the existing soft notice rather than on a new error path.
struct DestinationSuggestionList: View {
    let results: [DestinationSuggest.Suggestion]
    var ink: Color = Token.foreground
    var mark: Color = Token.accent
    let onPick: (String) -> Void

    var body: some View {
        VStack(spacing: 0) {
            ForEach(results) { result in
                Button { onPick(result.line) } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "mappin.and.ellipse")
                            .textStyle(.micro)
                            .foregroundStyle(mark)
                        Text(result.line)
                            .textStyle(.detail)
                            .foregroundStyle(ink)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, Token.gapRows)
                    // The row is the target, not the words in it — and 44 is the floor.
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }
}
