import Observation
import TripMateKit

/// The traveller's durable preferences, loaded once and saved on demand.
///
/// **Holds a `PlanDraft`, not a `TravelerProfile`, and that is the point.** The seven fields the
/// profile owns are seven fields the wizard already edits, with the same controls and the same
/// rules — including `toggleInterest`/`toggleStar`, where deselecting a starred interest has to
/// unstar it too. That rule has a documented failure mode. One copy of it, in `PlanDraft`, is the
/// whole reason this store carries a draft and converts at the edges.
@MainActor
@Observable
final class ProfileStore {
    var draft = PlanDraft()
    private(set) var isLoading = false
    private(set) var isSaving = false
    private(set) var message: String?
    /// Whether the server actually had a profile for this traveller.
    ///
    /// **Distinct from `hasLoaded`, and the header card needs the difference.** `PlanDraft`'s
    /// defaults resolve to solo / a bit of both / comfortable / some of each, so a portrait
    /// sentence generated from an untouched draft asserts four things nobody said. This is how
    /// the card knows to invite rather than to describe.
    private(set) var hasProfile = false
    /// **Distinct from `isLoading`, and from "the draft is non-default".** A traveller who has
    /// never saved a profile gets `nil` back and keeps `PlanDraft()`'s defaults — which is
    /// indistinguishable from never having asked. The offer after a generation needs to know
    /// which of those it is, or it compares against defaults and offers to save every time.
    private(set) var hasLoaded = false

    private let api: TripMateAPI

    init(api: TripMateAPI) {
        self.api = api
    }

    func load() async {
        guard !isLoading else { return }
        isLoading = true
        message = nil
        do {
            // A traveller who has never filled this in gets `nil`, which is a real state and not
            // an error — the form simply opens on `PlanDraft()`'s defaults.
            if let profile = try await api.profile() {
                draft = PlanDraft(profile: profile)
                hasProfile = true
            }
        } catch {
            message = Self.describe(error)
        }
        hasLoaded = true
        isLoading = false
    }

    func loadOnce() async {
        guard !hasLoaded else { return }
        await load()
    }

    func save() async {
        guard !isSaving else { return }
        isSaving = true
        message = nil
        do {
            try await api.saveProfile(draft.travelerProfile)
            hasProfile = true
        } catch {
            message = Self.describe(error)
        }
        isSaving = false
    }

    /// **Every change writes itself; there is no Save button.** That is what a native settings
    /// screen does, and the button at the foot of a scrolling form was the most web-shaped thing
    /// on the old screen.
    ///
    /// Debounced because the controls are chatty — starring an interest also selects it, so one
    /// tap is two mutations — and each write is a round trip. The pending task is cancelled
    /// rather than coalesced, so a burst of edits costs exactly one save.
    ///
    /// A failure leaves `message` set, which the screen renders in a section footer. An autosave
    /// that fails silently loses answers.
    func edited() {
        pending?.cancel()
        pending = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled else { return }
            await self?.save()
        }
    }

    @ObservationIgnored private var pending: Task<Void, Never>?

    /// The same table as `TripsStore.describe`, and deliberately a copy rather than a shared
    /// helper: the two will diverge the moment one of them has a case the other cannot hit, and
    /// a shared one would then grow a parameter saying which caller it is.
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
