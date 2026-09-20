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
    /// Plans generated but never kept. **Fetched from the same route with a different status**,
    /// which the client has always supported and nothing has ever called — so a plan a traveller
    /// generated and did not keep has been invisible on this platform until now.
    private(set) var drafts: [TripSummary] = []
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

    /// Which stop is being pointed at, within the active day, or nil.
    ///
    /// **The touch answer to the web's hover.** `mapCamera` carries `hoveredIndex` *and*
    /// `activeIndex` because a pointer can rest on one thing while another is selected; a finger
    /// cannot, so those two collapse into this one. It lives beside `activeDay` for the same
    /// reason: the panel row and the map both answer to it, and a second copy would be a second
    /// source of truth.
    private(set) var emphasis: Int?

    func selectDay(_ index: Int) {
        activeDay = index
        // A stop index only means anything within its own day.
        emphasis = nil
    }

    /// Point at a stop, or at nothing. Tapping the one already pointed at lets go of it, which is
    /// what makes the map's own deselect and the panel row agree.
    func emphasise(_ index: Int?) {
        emphasis = (index == emphasis) ? nil : index
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
            // Both in one flight. Two awaits would double the wall-clock wait on a screen that
            // renders nothing until the first one lands, and split one failure into two.
            async let saved = api.listTrips(status: .saved)
            async let unkept = api.listTrips(status: .draft)
            (trips, drafts) = try await (saved, unkept)
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
            emphasis = nil
        } catch {
            message = Self.describe(error)
        }
        isLoading = false
    }

    func closeTrip() {
        open = nil
    }

    /// Record what a stop or the lodging actually cost. `stop: nil` is the lodging.
    ///
    /// **Written locally first, then sent.** The figure is already on screen in three places —
    /// the row, the day's breakdown and the budget bar — and a traveller who types 47 and waits
    /// for a round trip before seeing it reads the app as broken. The web does the same:
    /// `setItinerary` then a fire-and-forget `persist`.
    ///
    /// **A failure puts the old value back.** Optimism without a rollback is just being wrong
    /// quietly, and this is money. The message says the amount did not save, in those words,
    /// because "try again" is not actionable for a number the traveller can see on screen.
    func setActualCost(day: Int, stop: Int?, to amount: Double?) async {
        guard let trip = open else { return }
        let previous = trip.itinerary
        let updated = previous.settingActualCost(day: day, stop: stop, to: amount)
        guard updated != previous else { return }

        open?.itinerary = updated
        message = nil
        do {
            _ = try await api.updateTrip(id: trip.id, itinerary: updated)
        } catch {
            open?.itinerary = previous
            message = "That amount didn't save. Check your connection and re-enter it."
        }
    }

    /// Put a found place into a day, at the part of the day the traveller chose.
    ///
    /// **No new server API.** The insert is local arithmetic (`Itinerary.addingPlace`, which is
    /// `DaySlotting` underneath) and persistence is the `updateTrip` that `setActualCost` has
    /// been using since B2 — the whole feature is a PATCH of the itinerary it already sends.
    ///
    /// Optimistic with a rollback, the shape the three above set. Here the rollback matters more
    /// than usual: the sheet has already dismissed by the time the request lands, so a silent
    /// failure would leave a stop on screen that the server has never heard of and that vanishes
    /// on the next open.
    func addPlace(_ name: String, at point: GeoPoint, category: String?, day: Int, slot: TimeOfDay) async {
        guard let trip = open else { return }
        let previous = trip.itinerary
        let updated = previous.addingPlace(name, at: point, category: category, toDay: day, slot: slot)
        guard updated != previous else { return }

        open?.itinerary = updated
        // Show the day the stop landed in, or the traveller is told it worked and shown a
        // different day. `selectDay` clears the emphasis, which a new stop would invalidate
        // anyway — the indices below it have all moved.
        selectDay(day)
        message = nil
        do {
            _ = try await api.updateTrip(id: trip.id, itinerary: updated)
        } catch {
            open?.itinerary = previous
            message = "\(name) didn't save to your plan. Check your connection and try again."
        }
    }

    /// Delete a trip or discard a draft.
    ///
    /// **Routed off the row, not off the visible tab.** The web makes the same point at
    /// `TripsView.tsx:421-424`: the tab is where you happen to be standing, and the row already
    /// knows what it is. Deleting the last draft while the drafts tab is open sends you back to
    /// memories, and a splice keyed on the tab would then remove the wrong thing.
    ///
    /// Optimistic with a rollback, the shape `setActualCost` above sets: the tile is already
    /// gone from the screen, so there is nothing to spin over, and a failure has to put it back
    /// rather than leave a trip the traveller believes is deleted.
    func delete(_ summary: TripSummary) async {
        let isDraft = summary.resolvedStatus == .draft
        // The whole array, not an index: the list can be re-sorted or reloaded between these
        // two lines, and an index would then restore into the wrong slot.
        let previousTrips = trips
        let previousDrafts = drafts
        if isDraft {
            drafts.removeAll { $0.id == summary.id }
        } else {
            trips.removeAll { $0.id == summary.id }
        }
        // A deleted trip cannot stay open behind the wall.
        if open?.id == summary.id { open = nil }
        message = nil
        do {
            try await api.deleteTrip(id: summary.id)
        } catch {
            trips = previousTrips
            drafts = previousDrafts
            message = isDraft
                ? "That draft didn't discard. Check your connection and try again."
                : "That trip didn't delete. Check your connection and try again."
        }
    }

    /// Promote the open draft to a kept trip.
    ///
    /// **This closes a data-loss hole rather than adding a feature.** `updateTrip(status:)` has
    /// existed since B2 and nothing on iOS has ever called it, so a plan generated on the phone
    /// could not be kept at all — and `purgeStaleDrafts` sweeps unkept drafts after 30 days.
    /// The web's `/trip/[id]` has carried a "Keep this trip" button the whole time.
    ///
    /// Optimistic with a rollback, the shape `setActualCost` and `delete` set: the banner is
    /// the only thing on screen that answers to this, so waiting on a round trip to dismiss it
    /// reads as a dead button.
    func keep() async {
        guard let trip = open, trip.resolvedStatus == .draft else { return }
        let previousTrips = trips
        let previousDrafts = drafts
        open?.status = .saved
        // The wall keys off these two lists, so the row has to move as well as the flag.
        if let index = drafts.firstIndex(where: { $0.id == trip.id }) {
            trips.insert(drafts.remove(at: index), at: 0)
        }
        message = nil
        do {
            _ = try await api.updateTrip(id: trip.id, itinerary: trip.itinerary, status: .saved)
        } catch {
            open?.status = .draft
            trips = previousTrips
            drafts = previousDrafts
            message = "That didn't save. Check your connection and try again."
        }
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
