import Foundation

/// The four questions, in order. `PLAN_ORDER` from `HomeView.tsx:167`.
///
/// **Four, and it used to be a different four** — `basics → purpose → group → pois`. `purpose`
/// went because a single optional text input never justified a full screen; it lives on
/// `preferences` now. `pois` went because it was empty more often than not (no
/// `OPENTRIPMAP_API_KEY`, or nothing nearby) and ended the flow on an apology with no summary of
/// what was about to be generated. Both jobs moved to `review`, which states the whole trip back
/// before committing to it.
public enum PlanStep: String, Codable, Sendable, CaseIterable {
    case basics, group, preferences, review

    public var title: String {
        switch self {
        case .basics: "Where and when"
        case .group: "Who's going"
        case .preferences: "What you're after"
        case .review: "Review"
        }
    }

    public var next: PlanStep? {
        let all = Self.allCases
        guard let index = all.firstIndex(of: self), index + 1 < all.count else { return nil }
        return all[index + 1]
    }

    public var previous: PlanStep? {
        let all = Self.allCases
        guard let index = all.firstIndex(of: self), index > 0 else { return nil }
        return all[index - 1]
    }
}

/// Everything the wizard collects, and every rule about whether it is ready.
///
/// **Pure on purpose, for the same reason `Spend` and `Framing` are.** This is where the wizard's
/// actual behaviour lives — what blocks Next, how a star list caps itself, which tier a budget
/// implies, what the request body ends up being — and `swift test` can reach all of it while it
/// cannot reach a `TextField`. The SwiftUI layer above is field bindings and a Next button.
public struct PlanDraft: Sendable, Equatable {

    // MARK: Basics

    public var destination = ""
    public var startDate = ""
    public var endDate = ""
    public var budget: Double = 0

    /// Set when a geocode came back a genuine **miss**, not when it failed to complete.
    ///
    /// The distinction is load-bearing and the web spells it out: `"unreachable"` means the lookup
    /// never completed — Open-Meteo down, connection dropped — which is not a claim anybody can
    /// make about what the traveler typed. Only a real miss earns "couldn't find that", and
    /// **neither blocks the trip**; a third-party geocoder's outage must not read as "the app is
    /// broken".
    public var destinationMissed = false

    // MARK: Group

    public var group: GroupType = .solo
    public var groupOther = ""
    public var party = PartyCounts()
    public var logistics = TripLogistics()

    // MARK: Preferences

    public var purpose = ""
    public var explorerStyle: ExplorerStyle = .mixed
    public var energy: EnergyLevel = .moderate
    public var crowds: CrowdPreference = .mixed
    public var interests: [String] = []
    /// In the order starred, because the order *is* the weighting.
    public var starredInterests: [String] = []
    public var dietary = DietaryNeeds()
    public var accessibility = AccessibilityNeeds()

    // MARK: Review

    public var customPois: [String] = []
    public var selectedPois: [CandidatePoi] = []

    public init() {}

    /// Seed the answers that persist between trips, leaving the trip's own fields blank.
    ///
    /// **Purpose, dates, budget and POIs are deliberately not here.** A business trip and an
    /// anniversary are the same person, and the budget is a function of the trip rather than of
    /// the traveler — `TravelerProfile`'s own docstring makes that argument, and this respects it.
    public init(profile: TravelerProfile) {
        self.group = profile.group
        self.explorerStyle = profile.explorerStyle
        self.energy = profile.energy
        self.crowds = profile.crowds
        self.interests = profile.priorities
        self.starredInterests = profile.topPriorities
        self.dietary = profile.dietary
    }

    // MARK: - Derived

    public var days: Int { Tiers.tripDays(from: startDate, to: endDate) }

    /// The spending style, derived from the budget and never chosen.
    public var tier: TierId { Tiers.closest(budget: budget, days: days) }

    // MARK: - Validation

    /// Cross-field rules, ported from `validate()` at `HomeView.tsx:1036`.
    ///
    /// Returns a sentence to show, or nil. Only the two rules the web states: the browser's own
    /// constraint validation covers presence, and `blocksAdvancing` covers that here.
    public var crossFieldProblem: String? {
        guard !startDate.isEmpty, !endDate.isEmpty else { return nil }
        if endDate < startDate { return "End date must be on or after the start date." }
        if Tiers.isTripTooLong(from: startDate, to: endDate) {
            return "Trips over \(Tiers.maxTripDays) days aren't supported — please choose a shorter date range."
        }
        return nil
    }

    /// Whether a step is complete enough to leave.
    ///
    /// **Only `basics` can block, and that is the design rather than an omission.** The group and
    /// preferences steps have a defaulted answer for every field — that is what makes them
    /// skippable, and `GenerateRequest`'s own note records the consequence: sending fewer fields
    /// degrades plan quality, it does not fail the call. A required answer on a screen the
    /// traveler has nothing to say on is a wall in front of a plan.
    public func canAdvance(from step: PlanStep) -> Bool {
        switch step {
        case .basics:
            return !destination.trimmingCharacters(in: .whitespaces).isEmpty
                && !startDate.isEmpty && !endDate.isEmpty
                && budget > 0
                && crossFieldProblem == nil
        case .group, .preferences, .review:
            return true
        }
    }

    /// Whether the plan can be generated at all.
    ///
    /// `tier` is part of this even though nothing selects it: the route answers 400 **"No spending
    /// style was selected"** without one (`route.ts:114`), and it is derived from `budget` and
    /// `days` — so a zero budget or an unparseable date range is what that 400 is really about.
    public var canGenerate: Bool { canAdvance(from: .basics) }

    // MARK: - Mutation with a rule attached

    /// Toggle an interest. Deselecting also **unstars** it, or a star would outlive its tag and
    /// keep weighting a preference the traveler just removed.
    public mutating func toggleInterest(_ tag: String) {
        if let index = interests.firstIndex(of: tag) {
            interests.remove(at: index)
            starredInterests.removeAll { $0 == tag }
        } else {
            interests.append(tag)
        }
    }

    /// Star an interest, up to `Interests.maxStarred`.
    ///
    /// Starring an unselected tag selects it too — the star is a nested control inside the tag on
    /// the web, so pressing it is a statement about that tag either way. Over the cap it is a
    /// no-op rather than evicting the oldest star: silently dropping a choice the traveler made is
    /// worse than a button that visibly does nothing while the count is showing.
    public mutating func toggleStar(_ tag: String) {
        if let index = starredInterests.firstIndex(of: tag) {
            starredInterests.remove(at: index)
            return
        }
        guard starredInterests.count < Interests.maxStarred else { return }
        if !interests.contains(tag) { interests.append(tag) }
        starredInterests.append(tag)
    }

    public var starsRemaining: Int { Interests.maxStarred - starredInterests.count }

    public mutating func addCustomPoi(_ name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !customPois.contains(trimmed) else { return }
        customPois.append(trimmed)
    }

    // MARK: - What goes on the wire

    /// The Step 2b answers, in one place.
    ///
    /// **Generation, save and the edit loop must all see the identical profile** — the web keeps
    /// this as one function for exactly that reason, because an edit loop handed a different
    /// profile starts re-asking what planning already knew.
    ///
    /// The three optional sub-objects are sent as `nil` when empty rather than as empty objects.
    /// `sanitizeLogistics` would collapse an all-empty `logistics` server-side anyway, but
    /// `accessibility` has no such normaliser and its absence genuinely means "nothing was
    /// stated", which is not the same as all-false.
    public var answers: UserAnswers {
        UserAnswers(
            purpose: purpose,
            explorerStyle: explorerStyle,
            group: group,
            groupOther: group == .other && !groupOther.isEmpty ? groupOther : nil,
            party: party,
            logistics: logistics.isEmpty ? nil : logistics,
            energy: energy,
            crowds: crowds,
            budget: budget,
            priorities: interests,
            topPriorities: starredInterests,
            selectedPois: selectedPois,
            customPois: customPois,
            dietary: dietary.isEmpty ? nil : dietary,
            accessibility: accessibility.isEmpty ? nil : accessibility
        )
    }

    /// `POST /api/itinerary`.
    ///
    /// `preferences` is `{tags, vibe: null}` — the web sends exactly that, with `vibe` a field the
    /// prompt builder reads and nothing populates.
    public var generateRequest: GenerateRequest {
        GenerateRequest(
            destination: destination.trimmingCharacters(in: .whitespaces),
            startDate: startDate,
            endDate: endDate,
            budget: budget,
            tier: tier,
            preferences: GeneratePreferences(tags: interests),
            userAnswers: answers,
            dietary: dietary.isEmpty ? nil : dietary
        )
    }

    /// `POST /api/trips` with `status: draft`.
    ///
    /// **A draft, always, and that is what makes Back safe.** The itinerary used to live in React
    /// state until Save ran, so a Back press threw the whole generation away; a row exists from
    /// the moment a plan does now, and Keep *promotes* it rather than inserting. Which is also why
    /// `CreateTripRequest.status` is not optional — omitting it inserts a **kept** trip.
    public func draftRequest(
        itinerary: Itinerary, runId: String?, sessionId: String?
    ) -> CreateTripRequest {
        CreateTripRequest(
            destination: destination.trimmingCharacters(in: .whitespaces),
            startDate: startDate,
            endDate: endDate,
            budget: budget,
            itinerary: itinerary,
            status: .draft,
            runId: runId,
            chatSessionId: sessionId,
            userAnswers: answers
        )
    }
}

/// What stays true between trips, from `travelerProfile.ts`.
///
/// Here so `PlanDraft` can be seeded from it. `GET /api/profile` is a B2 remainder, so nothing
/// fetches one yet — the wizard starts from `PlanDraft()`'s defaults until it does.
public struct TravelerProfile: Codable, Sendable, Equatable {
    public var group: GroupType
    public var explorerStyle: ExplorerStyle
    public var energy: EnergyLevel
    public var crowds: CrowdPreference
    public var priorities: [String]
    public var topPriorities: [String]
    public var dietary: DietaryNeeds

    public init(
        group: GroupType = .solo,
        explorerStyle: ExplorerStyle = .mixed,
        energy: EnergyLevel = .moderate,
        crowds: CrowdPreference = .mixed,
        priorities: [String] = [],
        topPriorities: [String] = [],
        dietary: DietaryNeeds = DietaryNeeds()
    ) {
        self.group = group
        self.explorerStyle = explorerStyle
        self.energy = energy
        self.crowds = crowds
        self.priorities = priorities
        self.topPriorities = topPriorities
        self.dietary = dietary
    }
}
