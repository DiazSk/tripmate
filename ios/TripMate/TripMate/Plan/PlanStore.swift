import Foundation
import MapKit
import Observation
import TripMateKit

/// The wizard's session: the draft, which step is showing, and one generation run.
///
/// **Almost nothing lives here.** Every rule — what blocks Next, how the star cap behaves, which
/// tier a budget implies, what the request body is — is on `PlanDraft` in TripMateKit, where
/// `swift test` can reach it. What is left is genuinely session state: navigation, one in-flight
/// request, and the message it produced.
@MainActor
@Observable
final class PlanStore {
    var draft = PlanStore.fresh()
    private(set) var step: PlanStep = .basics

    private(set) var isGenerating = false
    /// The stage the run is on, for the one line the wizard shows while it waits.
    ///
    /// **B5 replaces this with the real thing** — the staged progress list, the stops drawing on
    /// the map as they stream, the staggered reveal. A generation takes 60-150 s, so *something*
    /// has to report progress, and one line reading the stage frames off a stream the client
    /// already parses is the smallest honest version.
    private(set) var stage: StageEvent.Stage?
    private(set) var message: String?

    /// Where the map should look while the wizard is open, from the destination geocode.
    private(set) var previewPlace: GeocodedPlace?

    /// Airports and stations near the destination, for the optional "arriving at" field.
    ///
    /// **Suggestions, not a closed set** — `TripLogistics` keeps that field free text because
    /// the point is a fact for the prompt and geocoding it would add a fetch that can fail for
    /// no planning gain. Empty is the normal outcome of an Overpass outage and costs the
    /// traveler a convenience, not the form.
    private(set) var arrivalPoints: [ArrivalPoint] = []

    private let api: TripMateAPI

    init(api: TripMateAPI) {
        self.api = api
    }

    /// A draft with real dates in it.
    ///
    /// **`DatePicker` has no empty state, and that is why the dates are seeded.** The web uses an
    /// empty `<input type="date">`, which visibly reads "mm/dd/yyyy" and blocks Next until it is
    /// filled. A SwiftUI picker with no value still *renders a day* — so leaving the draft blank
    /// put a date on screen that the request would not carry, and Next stayed disabled with
    /// nothing on the form looking unfinished. Showing a week from today and meaning it is the
    /// version where the screen and the payload agree.
    ///
    /// Blank fields are still blank: destination and budget have no default and still block.
    private static func fresh() -> PlanDraft {
        var draft = PlanDraft()
        draft.startDate = Tiers.todayISO()
        draft.endDate = Tiers.todayISO(Date().addingTimeInterval(6 * 86_400))
        return draft
    }

    // MARK: - Navigation

    func advance() {
        guard draft.canAdvance(from: step), let next = step.next else { return }
        message = nil
        step = next
    }

    func back() {
        guard let previous = step.previous else { return }
        message = nil
        step = previous
    }

    /// Jump straight to a step, for the review screen's Edit links.
    func go(to step: PlanStep) {
        message = nil
        self.step = step
    }

    func reset() {
        draft = Self.fresh()
        step = .basics
        stage = nil
        message = nil
        previewPlace = nil
        arrivalPoints = []
    }

    // MARK: - Geocode

    /// Fly the map to what was typed, once per completed edit.
    ///
    /// **On blur rather than on a keystroke debounce, and the reason is the flights themselves**:
    /// overlapping camera flights visibly lurch through everywhere the prefix matched on the way to
    /// the real destination.
    ///
    /// Only a genuine **miss** earns "couldn't find that". A lookup that never completed —
    /// Open-Meteo down, connection dropped — is not a claim anybody can make about what the
    /// traveler typed, so it stays silent and the trip plans regardless. Geocoding misses are
    /// deliberately non-blocking here for the same reason they are on the web: a third-party
    /// geocoder's outage must not read as "the app is broken".
    func geocodeDestination() async {
        let name = draft.destination.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name != lastGeocoded else { return }
        lastGeocoded = name
        do {
            let place = try await api.geocode(destination: name)
            previewPlace = place
            draft.destinationMissed = false
            // Fires the moment the destination resolves, which is the whole reason this is its
            // own route rather than a field on `trip-fetch`: that one runs as the traveler
            // *leaves* the basics step, by which time the arrive/depart fields are already
            // filled in. Unawaited — nothing is blocked on it.
            Task { arrivalPoints = await api.arrivalPoints(lat: place.lat, lng: place.lng) }
        } catch APIError.notFound {
            // 404 from the route is a real miss: `geocodeDestinationCached` returned nothing.
            draft.destinationMissed = true
        } catch {
            // Every other outcome — the route's own 500, a dropped connection — is "unreachable",
            // which is not a claim about what was typed. Say nothing.
            draft.destinationMissed = false
        }
    }

    private var lastGeocoded = ""

    /// A region for the map to hold while the wizard runs, so the panel is not floating over an
    /// arbitrary ocean. A city, roughly — the trip has no route to frame yet.
    var previewRegion: MKCoordinateRegion? {
        guard let place = previewPlace else { return nil }
        return MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: place.lat, longitude: place.lng),
            latitudinalMeters: 24_000, longitudinalMeters: 24_000
        )
    }

    // MARK: - Generation

    /// Generate, save the result as a draft trip, and return its id.
    ///
    /// **Returns the id rather than holding it**, so the caller — which already owns trips — can
    /// open it without this store reaching into that one.
    ///
    /// Two stream rules the client enforces and this must not undo: `plan` arrives before the run
    /// is over (the critique is still reading), and an `error` *after* `plan` is dropped. So the
    /// first plan wins and a later failure cannot take a finished itinerary off the screen.
    ///
    /// **It stops consuming at `plan` rather than waiting for `done`, and that is measured.** The
    /// first version drained the whole stream. On a real 7-day Lisbon run the generate call took
    /// 246 s and the stream then stayed open for minutes more through the critique and the stop
    /// geocoding — with a finished itinerary already delivered and a spinner still on screen.
    /// `plan` means interactive *now*; the rest of the run is the server's business.
    ///
    /// What that gives up is `revised`: the critique's corrections land after `plan` and are not
    /// applied yet. **B5's job**, along with the live route draw. The plan shown is the plan the
    /// model wrote, which is what the non-streaming path returns too.
    func generate() async -> String? {
        guard draft.canGenerate, !isGenerating else { return nil }
        isGenerating = true
        stage = nil
        message = nil
        defer { isGenerating = false }

        var result: GenerationResult?
        do {
            events: for try await event in api.generate(draft.generateRequest) {
                switch event {
                case .stage(let event):
                    stage = event.stage
                case .plan(let plan), .done(let plan):
                    // Whichever arrives first — `plan` on the streaming path, `done` on the
                    // non-streaming fallback, which emits no `plan` at all.
                    result = plan
                    // Stops *delivery*, not the work: the server has no cancellation token, so
                    // the critique finishes and is billed either way. See `TripMateAPI.generate`.
                    break events
                case .failure(let copy):
                    // **Arrives on an HTTP 200**, so this case is the only signal a run failed —
                    // and it is ignored once a plan has landed, which is the web client's rule.
                    if result == nil {
                        message = copy
                        return nil
                    }
                case .stop, .dayCoords, .revised, .unknown:
                    // B5's content: the live route draw and the revision diff.
                    continue
                }
            }
        } catch {
            message = Self.describe(error)
            return nil
        }

        guard let result else {
            // The stream ended with no `plan`, no `done` and no `error` — see the contract's note
            // on an unterminated trailing frame being dropped deliberately. There is no reader
            // error to surface, so this is the only place it can be noticed.
            message = "The plan didn't come back. Try again."
            return nil
        }

        do {
            return try await api.createTrip(
                draft.draftRequest(
                    itinerary: result.itinerary, runId: result.runId, sessionId: result.sessionId
                )
            )
        } catch {
            message = Self.describe(error)
            return nil
        }
    }

    /// Same mapping as `TripsStore.describe`, and deliberately a copy of the *policy* rather than a
    /// shared helper: `throttled` and `spendCapReached` pass the server's own copy through because
    /// a route author wrote it, while `.server` never does — two routes return raw internal error
    /// text there.
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
        case .notFound(let copy), .badRequest(let copy):
            return copy
        case .transport:
            return "Can't reach TripMate. Check your connection."
        case .server, .decoding, .unexpectedStatus:
            return "Something went wrong. Try again."
        }
    }
}

extension StageEvent.Stage {
    /// What to say while a stage runs. Written for somebody waiting rather than for a trace.
    var waitingLabel: String {
        switch self {
        case .geocode: "Finding the place…"
        case .context: "Reading up on it…"
        case .generate: "Writing the days…"
        case .critique: "Checking the plan…"
        case .placing: "Putting it on the map…"
        }
    }
}
