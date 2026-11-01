import ExpoModulesCore
import MapKit

/**
 * Places near a point, from Apple Maps, searched on the device.
 *
 * The Nearby sheet used to depend on the TripMate server alone, and the server on OpenStreetMap's
 * shared Overpass mirrors, which turn heavy search traffic away; a day of that left Nearby empty.
 * MapKit needs no key, never touches our server, and its places carry addresses and phone numbers.
 * The JS side maps Apple's categories to the app's own and falls back to the server when this
 * returns nothing, so every failure here resolves an empty list rather than rejecting.
 */
public class ApplePlacesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ApplePlaces")

    /// `categories` are `MKPointOfInterestCategory` raw values; an empty list means any kind of place.
    AsyncFunction("search") { (lat: Double, lng: Double, radius: Double, query: String?, categories: [String], promise: Promise) in
      let center = CLLocationCoordinate2D(latitude: lat, longitude: lng)
      let filter = categories.isEmpty
        ? MKPointOfInterestFilter.includingAll
        : MKPointOfInterestFilter(including: categories.map { MKPointOfInterestCategory(rawValue: $0) })

      let search: MKLocalSearch
      if let text = query?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = text
        request.region = MKCoordinateRegion(center: center, latitudinalMeters: radius * 2, longitudinalMeters: radius * 2)
        request.resultTypes = .pointOfInterest
        request.pointOfInterestFilter = filter
        // Without this the region is only a hint, and a typed search ranks by where the *phone*
        // is: "gelato" near Leopold Cafe in Mumbai, asked from Seattle, came back as 25 Seattle
        // gelaterias, every one dropped by the JS radius filter, so the sheet fell through to the
        // server and showed its "try again". Measured with the same MapKit call on macOS.
        if #available(iOS 18.0, *) {
          request.regionPriority = .required
        }
        search = MKLocalSearch(request: request)
      } else {
        let request = MKLocalPointsOfInterestRequest(center: center, radius: radius)
        request.pointOfInterestFilter = filter
        search = MKLocalSearch(request: request)
      }

      search.start { response, _ in
        // MapKit reports "nothing found" as an error too; both mean "ask the server instead".
        let items = response?.mapItems ?? []
        promise.resolve(items.compactMap { item -> [String: Any]? in
          guard let name = item.name, !name.isEmpty else { return nil }
          let at = item.placemark.coordinate
          var place: [String: Any] = ["name": name, "lat": at.latitude, "lng": at.longitude]
          if let category = item.pointOfInterestCategory?.rawValue { place["category"] = category }
          if let address = item.placemark.title { place["address"] = address }
          if let phone = item.phoneNumber { place["phone"] = phone }
          if let url = item.url?.absoluteString { place["website"] = url }
          return place
        })
      }
    }.runOnQueue(.main)
  }
}
