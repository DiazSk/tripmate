import MapKit
import SwiftUI
import TripMateKit

/// One place found near the current view.
struct SearchResult: Identifiable, Equatable {
    let id: String
    let name: String
    let subtitle: String
    let coordinate: CLLocationCoordinate2D

    static func == (a: SearchResult, b: SearchResult) -> Bool { a.id == b.id }

    init?(_ item: MKMapItem) {
        guard let name = item.name else { return nil }
        self.name = name
        self.coordinate = item.location.coordinate
        // `shortAddress` — street and city, which is what tells two "Café Central"s apart.
        // `fullAddress` runs to five lines and this is a result row.
        //
        // `location`/`address` rather than `placemark`, which is deprecated as of iOS 26 and
        // deprecated *below* this app's 27.0 floor, so there is nothing to conditionalise.
        // Blank when it would only repeat the name, which is what `shortAddress` returns for a
        // result that *is* a locality — "Montepulciano / Montepulciano" is two lines saying one
        // thing.
        let address = item.address?.shortAddress
        self.subtitle = address == name ? "" : (address ?? "")
        // Coordinate-keyed, because `MKMapItem` has no stable identifier and two results on the
        // same building are the same place to a traveler.
        self.id = "\(name)@\(item.location.coordinate.latitude),\(item.location.coordinate.longitude)"
    }
}

/// The pin dropped on a searched place, distinct from a stop.
///
/// A plain `MKAnnotation` rather than another `StopAnnotationView`: a search result is not part of
/// the day, and drawing it as one would say it is.
final class SearchPinAnnotation: NSObject, MKAnnotation {
    let coordinate: CLLocationCoordinate2D
    let title: String?

    init(_ result: SearchResult) {
        self.coordinate = result.coordinate
        self.title = result.name
    }
}

/// Place search over `MKLocalSearch`.
///
/// **A swap, not a port, and the plan says so.** The web reads the basemap's own vector tiles as a
/// search index (`tilePlaces.ts`), which has no MapKit equivalent — there is no API to query
/// features in Apple's rendered map. It does not need one: `MKLocalSearch` scoped to the visible
/// rect serves the same product purpose against a better dataset than OpenFreeMap's tiles, and
/// `placeSearch.ts`'s whole swappable-provider apparatus — Google Places when keyed, Overpass
/// otherwise, across mirrors, with an `available: false` state for being rate-limited — collapses
/// into one platform call with no key and no quota.
///
/// **No `MKLocalSearchCompleter`.** A typeahead completion carries no coordinate, so selecting one
/// costs a second round trip to `MKLocalSearch` anyway — and the web panel is deliberately
/// debounced rather than live per keystroke. Debouncing the real search is the same behaviour with
/// one API and no delegate.
@MainActor
@Observable
final class MapSearchStore {
    var query = ""
    var results: [SearchResult] = []
    /// The result currently pinned on the map, or nil.
    var pin: SearchResult?
    /// Why there are no results, when that needs saying. Nil when results speak for themselves.
    var message: String?

    /// What "near this view" means, pushed in from the map when it settles.
    ///
    /// `@ObservationIgnored` on purpose: this is an *input* to searching that no view reads, and
    /// the map updates it on every camera idle. Observing it would invalidate the chrome each time.
    @ObservationIgnored var region: MKCoordinateRegion?

    func search() async {
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.count >= 2 else {
            results = []
            message = nil
            return
        }

        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = text
        if let region { request.region = region }

        do {
            let response = try await MKLocalSearch(request: request).start()
            results = response.mapItems.compactMap(SearchResult.init)
            // `[]` for "searched fine, nothing here" versus a message for "the search failed" —
            // the house fail-soft convention, and the reason the web panel says "search is busy"
            // rather than lying about the neighbourhood.
            message = results.isEmpty ? "Nothing here by that name." : nil
        } catch let error as MKError where error.code == .placemarkNotFound {
            results = []
            message = "Nothing here by that name."
        } catch is CancellationError {
            // A newer keystroke superseded this one. Leave what is on screen alone.
        } catch {
            results = []
            message = "Search is busy. Try again."
        }
    }

    func select(_ result: SearchResult) {
        pin = result
        results = []
        message = nil
        // **The query is deliberately left as typed.** Writing the chosen name into it changes
        // `query`, which is the debounce's `.task(id:)` key — so the picked result would
        // immediately search for its own name and reopen the list underneath the pin it just
        // dropped. Leaving the text alone also keeps the search available for the next attempt.
    }

    func clear() {
        query = ""
        results = []
        message = nil
        pin = nil
    }
}

/// The search box and its results, in the chrome above the map.
///
/// `MapSearchPanel.tsx` is 1,185 lines and `SearchPinCard.tsx` another 311; almost all of that is
/// the hover/pin/detail flow, the "add to day" picker and the distance readouts that belong to
/// editing. This is the read half: find a place, put it on the map.
struct MapSearchView: View {
    @Environment(MapSearchStore.self) private var store

    /// The web's debounce. Long enough that typing a word is one search rather than five.
    private static let debounce = Duration.milliseconds(320)

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            field
            if !store.results.isEmpty || store.message != nil { resultList }
        }
        .frame(maxWidth: 320, alignment: .leading)
        // `.task(id:)` is the whole debounce: SwiftUI cancels the previous one on every keystroke,
        // so the sleep only ever completes for the last character typed. No timer to clear and no
        // stale response to discard — the cancelled task's `await` throws instead.
        .task(id: store.query) {
            guard !store.query.isEmpty else {
                store.results = []
                store.message = nil
                return
            }
            try? await Task.sleep(for: Self.debounce)
            guard !Task.isCancelled else { return }
            await store.search()
        }
    }

    private var field: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Token.muted)
            TextField("Search near this view…", text: Binding(
                get: { store.query }, set: { store.query = $0 }
            ))
            .textFieldStyle(.plain)
            .font(.system(size: 13))
            .foregroundStyle(Token.foreground)
            .submitLabel(.search)
            .autocorrectionDisabled()
            if !store.query.isEmpty {
                Button { store.clear() } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(Token.muted)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 36)
        .glassPanel(radius: 18)
    }

    private var resultList: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let message = store.message {
                Text(message)
                    .font(.system(size: 12))
                    .foregroundStyle(Token.muted)
                    .padding(10)
            }
            ForEach(store.results.prefix(6)) { result in
                Button { store.select(result) } label: {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(result.name)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(Token.foreground)
                        if !result.subtitle.isEmpty {
                            Text(result.subtitle)
                                .font(.system(size: 11))
                                .foregroundStyle(Token.muted)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    // **Without this the row only responds on the text itself.** A `.plain`
                    // button hit-tests its label's drawn content, and a short place name leaves
                    // most of a 320pt row transparent — measured: taps landed 60pt right of
                    // "Montepulciano" and did nothing at all.
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .glassPanel(radius: Token.radiusMedium)
    }
}
