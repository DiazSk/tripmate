import MapKit
import SwiftUI
import TripMateKit


/// The seven things a traveller searches for, and the only vocabulary the chips speak.
///
/// **One enum holding three mappings that must agree**, because they did not have to and getting
/// them out of step is silent: what Apple is asked for (`categories`), what Apple answers with
/// (`of(_:)`, the reverse), and what the kit's `StopCategory(searchCategory:)` and
/// `DaySlotting.suggest` understand (`searchCategory`, which is the web's own spelling). A café
/// tapped on the basemap and a café typed into the box must reach the plan as the same kind of
/// stop, and they only do because both go through here.
///
/// The seven are the web's own chips (`MapSearchPanel.tsx`). Apple offers 84
/// `MKPointOfInterestCategory` values and all seven map cleanly onto groups of them.
enum PlaceKind: String, CaseIterable, Identifiable {
    case cafes, food, bars, sights, parks, shops, hotels

    var id: String { rawValue }

    var label: String {
        switch self {
        case .cafes: "Cafés"
        case .food: "Food"
        case .bars: "Bars"
        case .sights: "Sights"
        case .parks: "Parks"
        case .shops: "Shops"
        case .hotels: "Hotels"
        }
    }

    var symbol: String {
        switch self {
        case .cafes: "cup.and.saucer"
        case .food: "fork.knife"
        case .bars: "wineglass"
        case .sights: "building.columns"
        case .parks: "tree"
        case .shops: "bag"
        case .hotels: "bed.double"
        }
    }

    var categories: [MKPointOfInterestCategory] {
        switch self {
        case .cafes: [.cafe, .bakery]
        case .food: [.restaurant, .foodMarket]
        case .bars: [.nightlife, .brewery, .winery, .distillery]
        case .sights: [.museum, .landmark, .castle, .fortress, .nationalMonument, .aquarium, .zoo, .theater]
        case .parks: [.park, .nationalPark, .beach]
        case .shops: [.store]
        case .hotels: [.hotel]
        }
    }

    /// The string `StopCategory(searchCategory:)` and `DaySlotting.suggest` read — the web's own
    /// four, spelled the web's way. **`nil` for the three that are neither food nor a ticket**:
    /// a park costs nothing and a shop is not a visit anybody totals, so they become `other`,
    /// which is exactly what `stopCategoryFor` does with them.
    var searchCategory: String? {
        switch self {
        case .cafes: "cafe"
        case .food: "restaurant"
        case .bars: "bar"
        case .sights: "sights"
        case .parks, .shops, .hotels: nil
        }
    }

    /// The reverse: what Apple said this place is, folded back into our seven.
    ///
    /// First match wins and the lists are disjoint, so the order of `allCases` does not decide
    /// anything. `nil` for the other ~60 categories and for a result that is not a POI at all.
    static func of(_ category: MKPointOfInterestCategory?) -> PlaceKind? {
        guard let category else { return nil }
        return allCases.first { $0.categories.contains(category) }
    }
}

/// One place found near the current view.
struct SearchResult: Identifiable, Hashable {
    let id: String
    let name: String
    let subtitle: String
    let coordinate: CLLocationCoordinate2D
    /// What Apple calls this place, folded into our own seven. `nil` when it is not a POI at all
    /// — an address, a locality — which is also the honest answer for `stopCategoryFor`.
    let kind: PlaceKind?
    /// **Kept whole so `mapItemDetailSheet` can be handed it.** Apple's own place sheet carries
    /// the opening hours, the rating and the photos that `MKMapItem` itself does not expose, so
    /// the card below shows what we know and defers the rest rather than inventing it.
    let item: MKMapItem

    /// **Identity is the place, not the fields.** Two results on one building are the same
    /// place to a traveller, and `navigationDestination(item:)` needs a `Hashable` that agrees
    /// with that — hashing an `MKMapItem` reference would push a second card for the same café.
    static func == (a: SearchResult, b: SearchResult) -> Bool { a.id == b.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }

    init?(_ item: MKMapItem) {
        guard let name = item.name else { return nil }
        self.item = item
        self.name = name
        self.coordinate = item.location.coordinate
        self.kind = PlaceKind.of(item.pointOfInterestCategory)
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
        // **`MKMapItemIdentifier` where there is one** (iOS 18+), which is Apple's own stable id
        // for the place. The coordinate key below was a documented hack standing in for exactly
        // this; it survives as the fallback, because an identifier is only minted for places in
        // Apple's index and a geocoded address has none.
        self.id = item.identifier?.rawValue
            ?? "\(name)@\(item.location.coordinate.latitude),\(item.location.coordinate.longitude)"
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
    /// The chip that is pressed, if one is. **On its own it is a whole search**: standing in a
    /// city, "cafés near here" is the question, and typing the word "café" to ask it is a step
    /// the map does not need.
    var kind: PlaceKind?
    var results: [SearchResult] = []
    /// The result currently pinned on the map, or nil.
    var pin: SearchResult?
    /// Why there are no results, when that needs saying. Nil when results speak for themselves.
    var message: String?

    /// The add-a-stop sheet is up.
    var isAdding = false
    /// The place the sheet has pushed to its card, if any.
    ///
    /// **Both entries write these two and nothing else**: the day's own "Add a stop" opens the
    /// sheet on the list, and tapping a café Apple drew on the basemap opens it already pushed
    /// to that café's card. One presentation, one path through it, two ways in.
    var adding: SearchResult?
    /// The day the sheet was opened from, or `nil` when nothing chose one.
    ///
    /// **On the store rather than as view state, and that is a bug fix.** It was `@State` in
    /// `TripDetailView`, which only the day's own button ever wrote — so after one use of "Add a
    /// stop" on Day 1, a basemap tap inherited Day 1 instead of asking geometry. The entry that
    /// opens the sheet is the only thing that knows, so it is the only thing that sets it.
    var fromDay: Int?

    /// The debounce key. **`kind` is in it**, or pressing a chip would filter the next search
    /// rather than this one.
    var searchKey: String { "\(kind?.rawValue ?? "")|\(query)" }

    func open(_ result: SearchResult? = nil, fromDay day: Int? = nil) {
        adding = result
        fromDay = day
        isAdding = true
    }

    /// What "near this view" means, pushed in from the map when it settles.
    ///
    /// `@ObservationIgnored` on purpose: this is an *input* to searching that no view reads, and
    /// the map updates it on every camera idle. Observing it would invalidate the chrome each time.
    @ObservationIgnored var region: MKCoordinateRegion?

    func search() async {
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        // A chip alone is a search; text alone is a search; neither is not.
        guard text.count >= 2 || kind != nil else {
            results = []
            message = nil
            return
        }

        do {
            let items = text.count >= 2
                ? try await named(text).start().mapItems
                : try await MKLocalSearch(request: browse()).start().mapItems
            results = items.compactMap(SearchResult.init)
            // `[]` for "searched fine, nothing here" versus a message for "the search failed" —
            // the house fail-soft convention, and the reason the web panel says "search is busy"
            // rather than lying about the neighbourhood.
            message = results.isEmpty ? empty : nil
        } catch let error as MKError where error.code == .placemarkNotFound {
            results = []
            message = empty
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

    /// **"Nothing here by that name" is a lie when nothing was named.** A chip with no text asks
    /// what is nearby, so an empty answer is about the neighbourhood rather than the spelling.
    private var empty: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2
            ? "Nothing here by that name."
            : "No \(kind?.label.lowercased() ?? "places") in view. Pan the map or type a name."
    }

    /// Text, optionally narrowed to a chip's categories.
    private func named(_ text: String) -> MKLocalSearch {
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = text
        if let region { request.region = region }
        if let kind {
            request.pointOfInterestFilter = MKPointOfInterestFilter(including: kind.categories)
            // Without this a filtered search still returns addresses and localities, which carry
            // no category and so slip past the filter entirely.
            request.resultTypes = .pointOfInterest
        }
        return MKLocalSearch(request: request)
    }

    /// A chip with nothing typed: everything of that kind in view.
    ///
    /// `MKLocalPointsOfInterestRequest` rather than a `naturalLanguageQuery` of the chip's own
    /// label — searching the *word* "Cafés" matches places named that, which is a different
    /// question and a worse answer.
    private func browse() -> MKLocalPointsOfInterestRequest {
        let request = MKLocalPointsOfInterestRequest(
            coordinateRegion: region ?? MKCoordinateRegion(.world)
        )
        if let kind {
            request.pointOfInterestFilter = MKPointOfInterestFilter(including: kind.categories)
        }
        return request
    }

    func clear() {
        query = ""
        kind = nil
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
                .textStyle(.detail.weight(TextStyle.medium))
                .foregroundStyle(Token.muted)
            TextField("Search near this view…", text: Binding(
                get: { store.query }, set: { store.query = $0 }
            ))
            .textFieldStyle(.plain)
            .textStyle(.detail)
            .foregroundStyle(Token.foreground)
            .submitLabel(.search)
            .autocorrectionDisabled()
            if !store.query.isEmpty {
                Button { store.clear() } label: {
                    Image(systemName: "xmark.circle.fill")
                        .textStyle(.body)
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
                    .textStyle(.caption)
                    .foregroundStyle(Token.muted)
                    .padding(10)
            }
            ForEach(store.results.prefix(6)) { result in
                Button { store.select(result) } label: {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(result.name)
                            .textStyle(.detail.weight(TextStyle.medium))
                            .foregroundStyle(Token.foreground)
                        if !result.subtitle.isEmpty {
                            Text(result.subtitle)
                                .textStyle(.micro)
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
