import MapKit
import TripMateKit

/// Ask Apple where a place actually is.
///
/// **Deliberately the thinnest possible thing, because there is nothing here worth testing.**
/// Every judgement — what string to ask about, which answer to believe — is in `StopResolution`
/// in the Kit, where `swift test` can reach it. What is left is build a request, call it, map
/// the results to points. A test over this would be a test of Apple's index.
///
/// **Apple's geocoder rather than the server's OpenStreetMap path, and that is the whole
/// premise.** Apple's geocoder, Apple's basemap and Apple's Look Around are one dataset, so a
/// coordinate resolved here lands where MapKit will draw it and where the imagery was captured.
/// Measured: at the model's fabricated points Look Around covered 0 of 4 stops; at the points
/// this returns it covered 3 of 5. A second provider would break that alignment and add a
/// tiebreak nobody could adjudicate.
enum StopResolver {

    /// Candidate points for a place name, nearest-first as Apple ranks them.
    ///
    /// Returns `[]` for "asked fine, nothing matched" and **also** for every failure — this is a
    /// best-effort repair, and a caller that cannot tell the two apart still does the right
    /// thing, which is keep the coordinate the model gave. That is the one place this departs
    /// from the house fail-soft convention of distinguishing them, and it departs on purpose:
    /// there is no third behaviour to select.
    static func candidates(
        for query: String,
        near centre: GeoPoint,
        spanM: Double,
        category: StopCategory
    ) async -> [GeoPoint] {
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = query
        request.region = MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: centre.lat, longitude: centre.lng),
            latitudinalMeters: spanM,
            longitudinalMeters: spanM
        )
        if let filter = Self.filter(for: category) {
            request.pointOfInterestFilter = filter
            // Without this a filtered search still returns addresses and localities, which carry
            // no category and so slip past the filter entirely — the same trap `MapSearchStore`
            // documents. The cost is that a piazza Apple indexes as an address disappears, which
            // is acceptable only because missing means "keep the model's guess".
            request.resultTypes = .pointOfInterest
        }

        do {
            let response = try await MKLocalSearch(request: request).start()
            // Five is the scan depth, not a ranking. `StopResolution.accepts` is the score, and
            // looking past the first result costs nothing while stopping one Siena hit from
            // throwing away a correct Pienza second.
            return response.mapItems.prefix(5).map {
                GeoPoint(lat: $0.location.coordinate.latitude, lng: $0.location.coordinate.longitude)
            }
        } catch {
            return []
        }
    }

    /// The stop's own category, narrowed to what Apple can filter on.
    ///
    /// Reuses `PlaceKind.categories` rather than writing a second mapping — the add-a-stop flow
    /// already has to keep Apple's vocabulary and ours in step, and two copies would drift.
    /// `transit` and `other` get no filter: a car rental desk and a viewpoint are not reliably
    /// any one `MKPointOfInterestCategory`, and a wrong filter returns nothing at all.
    private static func filter(for category: StopCategory) -> MKPointOfInterestFilter? {
        let kinds: [PlaceKind]
        switch category {
        case .food: kinds = [.cafes, .food, .bars]
        case .entry: kinds = [.sights]
        case .transit, .other: return nil
        }
        return MKPointOfInterestFilter(including: kinds.flatMap(\.categories))
    }
}
