import Foundation

public extension TripSummary {
    /// `"Val d'Orcia, Italy"` → `"Italy"`. The last comma-separated part, which is the country
    /// in every destination the geocoder returns and in everything a traveller types by hand.
    ///
    /// No comma means one word for the whole place, so the place is the answer — counting
    /// `"Tokyo"` as a country is wrong in a geography lesson and right in "how many places have
    /// you been", which is what the figure above it says.
    var country: String {
        destination
            .split(separator: ",")
            .last
            .map { $0.trimmingCharacters(in: .whitespaces) }
            ?? destination
    }
}
