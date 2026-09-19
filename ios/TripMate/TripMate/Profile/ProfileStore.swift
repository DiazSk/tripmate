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
    /// Cleared by the next edit, so the confirmation never outlives what it confirmed.
    private(set) var isSaved = false
    private(set) var message: String?

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
            }
        } catch {
            message = Self.describe(error)
        }
        isLoading = false
    }

    func save() async {
        guard !isSaving else { return }
        isSaving = true
        message = nil
        do {
            try await api.saveProfile(draft.travelerProfile)
            isSaved = true
        } catch {
            message = Self.describe(error)
        }
        isSaving = false
    }

    func markEdited() { isSaved = false }

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
