import Foundation
import Observation
import TripMateKit

/// What the read surfaces are looking at.
///
/// `@MainActor` rather than an actor of its own: every property here exists to be rendered, so
/// main-actor isolation is what the consumers need anyway, and a second isolation domain would
/// just add hops between the network and the view.
@MainActor
@Observable
final class TripsStore {
    private(set) var trips: [TripSummary] = []
    private(set) var open: Trip?
    private(set) var isLoading = false

    /// Which day is being read.
    ///
    /// **Here rather than in the detail view**, because two surfaces answer to it: the panel shows
    /// that day's stops and the map draws that day's route. Held in the view, the map would have
    /// no way to ask, and a second copy would be a second source of truth for one question.
    private(set) var activeDay = 0

    /// What the map should draw, derived rather than stored — so it cannot fall out of step with
    /// the day the panel is showing.
    var route: RoutePresentation? {
        guard let open else { return nil }
        return RoutePresentation(trip: open, dayIndex: activeDay)
    }

    func selectDay(_ index: Int) {
        activeDay = index
    }

    /// A message ready to show, not an `Error` for the view to interpret.
    ///
    /// The mapping lives here because `APIError`'s two non-failure cases carry the *server's own*
    /// copy — a route author wrote "slow down and try again shortly", and that is what should
    /// reach the traveler rather than this app's paraphrase of it.
    private(set) var message: String?

    private let api: TripMateAPI

    init(api: TripMateAPI) {
        self.api = api
    }

    func loadTrips() async {
        isLoading = true
        message = nil
        do {
            trips = try await api.listTrips(status: .saved)
            if trips.isEmpty { message = nil }
        } catch {
            message = Self.describe(error)
        }
        isLoading = false
    }

    func openTrip(id: String) async {
        isLoading = true
        message = nil
        do {
            open = try await api.trip(id: id)
            // Reset before the trip lands, not after: a stale index from a nine-day trip would
            // otherwise briefly address a day a three-day trip does not have.
            activeDay = 0
        } catch {
            message = Self.describe(error)
        }
        isLoading = false
    }

    func closeTrip() {
        open = nil
    }

    /// Turns an error into something worth reading.
    ///
    /// The `throttled` and `spendCapReached` cases pass the server's string through untouched —
    /// they are states, not failures, and they already have copy written for them. `.server` is
    /// deliberately *not* passed through: two routes return raw internal error text there, which
    /// is never something to show a traveler.
    private static func describe(_ error: Error) -> String {
        guard let apiError = error as? APIError else {
            return "Something went wrong. Try again."
        }
        switch apiError {
        case .throttled(let copy), .spendCapReached(let copy):
            return copy
        case .notEntitled:
            return "That needs an active subscription."
        case .unauthorized:
            return "Your session expired. Sign in again."
        case .notFound(let copy):
            return copy
        case .badRequest(let copy):
            return copy
        case .transport:
            return "Can't reach TripMate. Check your connection."
        case .server, .decoding, .unexpectedStatus:
            return "Something went wrong. Try again."
        }
    }
}
