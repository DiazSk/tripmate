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
        return RoutePresentation(trip: open, dayIndex: activeDay, corrections: corrections)
    }

    /// Real coordinates for stops the model placed badly, by day and then by stop name.
    ///
    /// **A side table, and nothing is written to `Stop`.** Every field on a stop but
    /// `actualCost` is `let`, and more to the point `setActualCost` and `addPlace` PATCH the
    /// *whole* itinerary — so folding these in would mean that typing one actual cost silently
    /// ships forty-nine device-geocoded coordinates to the server, a write nobody asked for,
    /// which the web would then draw over OpenFreeMap tiles.
    ///
    /// The shape is not new: `RouteGeometry.routeStops(streamed:corrections:)` has taken exactly
    /// this for the server's `day-coords` frames since B5. This is the same repair arriving by a
    /// different route for a plan that has finished streaming.
    private(set) var corrections: [Int: [String: GeoPoint]] = [:]

    /// Days whose resolution pass has already run. Re-opening a day is then free.
    @ObservationIgnored private var resolved: Set<Int> = []
    @ObservationIgnored private var resolving: Task<Void, Never>?

    /// What the camera is allowed to re-frame on.
    ///
    /// **Without this, correcting a coordinate yanks the map.** `RoutePresentation.identity` is a
    /// lat/lng string and `WorldMapView.drawRoute` gates *both* redraw and re-frame on it unless
    /// a separate key is supplied — so a correction landing after you had panned would fly the
    /// camera away. This key moves on the day and on nothing else, which is the same trick
    /// `PlanStore.streamingRefitKey` plays for a streaming run.
    ///
    /// It also fixes an existing wart: adding a stop re-framed the camera for this same reason.
    /// **Two frames per day and no more: on arrival, and once when the corrections land.**
    /// Resolving moved two of day 5's five stops eight kilometres, and with a key that ignored
    /// corrections the camera stayed framed on the pre-correction bounds — so two stops were
    /// simply off-screen with nothing to say they existed. Including whether this day has been
    /// corrected adds exactly one re-frame and then goes stable again.
    var mapRefitKey: String? {
        open.map { "trip-\($0.id)-\(activeDay)-\(corrections[activeDay] == nil ? 0 : 1)" }
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
        resolveStops(day: index)
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
        resolving?.cancel()
        corrections = [:]
        resolved = []
        // The session is seeded with *this* trip's plan, so carrying one across trips would have
        // the model editing a plan it is not looking at.
        forgetChat()
        do {
            open = try await api.trip(id: id)
            // Reset before the trip lands, not after: a stale index from a nine-day trip would
            // otherwise briefly address a day a three-day trip does not have.
            activeDay = 0
            emphasis = nil
            resolveStops(day: 0)
        } catch {
            message = Self.describe(error)
        }
        isLoading = false
    }

    func closeTrip() {
        resolving?.cancel()
        forgetChat()
        open = nil
    }

    private func forgetChat() {
        chat = []
        warnings = []
        chatSessionId = nil
        syncedHash = nil
        isReplying = false
    }

    /// Put one day's stops where they actually are.
    ///
    /// **Per day, not per trip.** A thirty-day plan is ~150 stops; resolving them all on open
    /// would be 150 `MKLocalSearch` calls in a burst, which is the fastest way to be throttled
    /// for work nobody asked for. A day costs about six, and only days someone actually looks
    /// at ever cost anything.
    ///
    /// Serial rather than a `TaskGroup` for the same reason — concurrency here buys a second and
    /// risks the rate limit — and the whole day's findings are written in **one** mutation at the
    /// end, so the map redraws once instead of six times.
    private func resolveStops(day: Int) {
        guard let trip = open, trip.itinerary.days.indices.contains(day),
              !resolved.contains(day)
        else { return }
        resolved.insert(day)

        let stops = trip.itinerary.days[day].stops
        // **Snapshotted once, from raw points, never from already-corrected ones.** Otherwise the
        // verdict depends on which response happens to land first, and the feature stops being
        // repeatable or testable.
        let anchorsByIndex = stops.indices.map { StopResolution.anchors(stops, excluding: $0) }
        guard let centre = Framing.centroid(StopResolution.anchors(stops, excluding: -1))
        else { return }

        resolving?.cancel()
        resolving = Task { [weak self] in
            var found: [String: GeoPoint] = [:]
            var asked: Set<String> = []
            for (index, stop) in stops.enumerated() {
                if Task.isCancelled { return }
                guard let query = StopResolution.query(for: stop.name),
                      StopResolution.namesAPlace(query),
                      !asked.contains(query)
                else { continue }
                asked.insert(query)

                let candidates = await StopResolver.candidates(
                    for: query, near: centre, spanM: 30_000, category: stop.category
                )
                guard let match = StopResolution.best(
                    of: candidates, near: GeoPoint(stop), anchors: anchorsByIndex[index]
                ) else { continue }
                found[stop.name] = match
            }
            guard !found.isEmpty, !Task.isCancelled else { return }
            self?.corrections[day] = found
        }
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
    // MARK: - Chat

    /// The edit conversation for the open trip, in the order the route wants it.
    ///
    /// **In memory only.** The server keeps its own transcript in `trip_chat_turns`, so closing
    /// the trip loses the history on this device but not on the server. Reading it back is
    /// `GET /api/trip-chat`, and worth doing when somebody misses it — the chat still *works*
    /// across a reopen, because continuity lives in the session, not in this array.
    private(set) var chat: [ChatTurn] = []
    private(set) var isReplying = false

    /// Skill §12 guardrails from the last turn — an over-long day, a clash, a budget overshoot.
    /// Held rather than folded into the reply because they are the model flagging a cost of the
    /// edit it just made, and dropping them silently would hide it.
    private(set) var warnings: [String] = []

    /// The model's conversation, and what it was last told the plan looks like. Both are opaque
    /// here: they are echoed back untouched, never inspected. A null `syncedHash` is the server
    /// telling us its picture is stale, and echoing the null is what forces it to resync.
    @ObservationIgnored private var chatSessionId: String?
    @ObservationIgnored private var syncedHash: String?

    /// Send a message and take the plan the planner sends back.
    ///
    /// **Not optimistic, unlike every other mutation here.** The others know the answer before
    /// they ask — an actual cost is the number you typed. An edit's result is whatever the model
    /// decides, so there is nothing to draw until it replies and nothing to roll back.
    ///
    /// Returns false when the turn did not happen, so the composer can keep the text rather than
    /// make somebody retype it. The failed turn is dropped from `chat` for the same reason the
    /// others roll back: this array is the conversation the *server* has, and after a failure it
    /// has nothing.
    @discardableResult
    func send(_ text: String) async -> Bool {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, !isReplying, let trip = open else { return false }

        chat.append(ChatTurn(role: .user, content: body))
        isReplying = true
        message = nil
        defer { isReplying = false }

        do {
            let edit = try await api.editTrip(
                trip: trip.summary,
                itinerary: trip.itinerary,
                messages: chat,
                dayIndex: activeDay,
                userAnswers: trip.userAnswers,
                sessionId: chatSessionId,
                syncedHash: syncedHash
            )
            chatSessionId = edit.sessionId
            syncedHash = edit.syncedHash
            warnings = edit.warnings
            if let reply = edit.reply, !reply.isEmpty {
                chat.append(ChatTurn(role: .assistant, content: reply))
            }
            apply(edit, to: trip)
            return true
        } catch {
            chat.removeLast()
            message = Self.describe(error)
            return false
        }
    }

    /// Take the edited plan: draw it, forget what the old one resolved to, then persist it.
    private func apply(_ edit: TripEdit, to trip: Trip) {
        open?.itinerary = edit.itinerary

        // A day whose stops changed has corrections keyed to names that may no longer be there,
        // and `resolved` would stop the pass re-running. `daysModified` is 1-based.
        for day in edit.daysModified.map({ $0 - 1 }) {
            corrections[day] = nil
            resolved.remove(day)
        }
        // An edit can delete the day you were looking at.
        activeDay = min(activeDay, max(edit.itinerary.days.count - 1, 0))
        emphasis = nil
        resolveStops(day: activeDay)

        // Persist after drawing, and do not roll the plan back if this fails: the edit is real,
        // the model has acted on it, and a plan that reverts under you is worse than one that
        // needs saving again. `chatSessionId` rides along the way `patchDraft` sends it.
        let itinerary = edit.itinerary
        let sessionId = edit.sessionId
        Task { [api] in
            do {
                _ = try await api.updateTrip(id: trip.id, itinerary: itinerary, chatSessionId: sessionId)
            } catch {
                message = "The plan changed, but saving it failed. It may not survive a reopen."
            }
        }
    }

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
