import Foundation

// MARK: - The fixed choices

/// Ported from `src/lib/types.ts:169-180`. Every one of these is an enum because the
/// itinerary-planner skill branches on it — "never free text where a fixed choice is expected".
public enum ExplorerStyle: String, Codable, Sendable, CaseIterable {
    case packed, relaxed, offbeat, mixed

    public var label: String {
        switch self {
        case .packed: "See as much as possible"
        case .relaxed: "A few things, done well"
        case .offbeat: "Off the beaten path"
        case .mixed: "A bit of both"
        }
    }
}

public enum GroupType: String, Codable, Sendable, CaseIterable {
    case solo, couple, familyWithKids = "family_with_kids", other

    public var label: String {
        switch self {
        case .solo: "Solo"
        case .couple: "Couple"
        case .familyWithKids: "Family with kids"
        case .other: "Something else"
        }
    }
}

/// "How much do you want to walk", which is a **different question** from "can you manage
/// stairs" — see `AccessibilityNeeds`. Using this as a proxy for both gave a wheelchair user who
/// describes their energy as high no accommodation at all.
public enum EnergyLevel: String, Codable, Sendable, CaseIterable {
    case high, moderate, low

    public var label: String {
        switch self {
        case .high: "Happy to walk all day"
        case .moderate: "A comfortable amount"
        case .low: "Prefer it gentle"
        }
    }
}

public enum CrowdPreference: String, Codable, Sendable, CaseIterable {
    case love, mixed, avoid

    public var label: String {
        switch self {
        case .love: "Love the buzz"
        case .mixed: "Some of each"
        case .avoid: "Keep it quiet"
        }
    }
}

/// Age bands rather than exact ages: the bands are what map onto a planning rule — stroller
/// access, nap windows, ride height limits — and a precise age would imply a precision that
/// changes nothing.
public struct PartyCounts: Codable, Sendable, Equatable {
    /// At least 1.
    public var adults: Int
    /// Aged 2-11.
    public var children: Int
    /// Under 2.
    public var infants: Int

    public init(adults: Int = 1, children: Int = 0, infants: Int = 0) {
        self.adults = adults
        self.children = children
        self.infants = infants
    }
}

/// What the traveler has already booked around the trip.
///
/// **Times, not dates.** `startDate`/`endDate` stay the trip's only date range — a second one
/// would give the app two competing notions of trip length, and tier pricing, the day count and
/// the weather window all read the first.
///
/// Every field is nullable and the whole object is optional: this is the one part of the form
/// nobody has to fill in, and `sanitizeLogistics` on the server collapses an all-empty object to
/// null, so skipping the row gets the prompt it would have got before the row existed.
public struct TripLogistics: Codable, Sendable, Equatable {
    /// "HH:MM", local, on `startDate`.
    public var arrivalTime: String?
    /// Free text — "Kansai Intl (KIX)", "Kyoto Station". Deliberately **not** geocoded: it is a
    /// fact for the prompt, and a lookup would add a fetch that can fail for no planning gain.
    public var arrivalPoint: String?
    public var departureTime: String?
    public var departurePoint: String?
    /// Collected by the web's benchmark form only; the traveler-facing form does not write it.
    public var stayBooked: String?

    public init(
        arrivalTime: String? = nil, arrivalPoint: String? = nil,
        departureTime: String? = nil, departurePoint: String? = nil,
        stayBooked: String? = nil
    ) {
        self.arrivalTime = arrivalTime
        self.arrivalPoint = arrivalPoint
        self.departureTime = departureTime
        self.departurePoint = departurePoint
        self.stayBooked = stayBooked
    }

    public var isEmpty: Bool {
        [arrivalTime, arrivalPoint, departureTime, departurePoint, stayBooked]
            .allSatisfy { ($0 ?? "").isEmpty }
    }
}

/// Mobility needs stated directly rather than inferred from `energy`.
///
/// **Absence means nothing was stated — not that the traveler has no needs.** That distinction is
/// why this is optional on `UserAnswers` rather than defaulted to all-false.
public struct AccessibilityNeeds: Codable, Sendable, Equatable {
    /// Step-free routes required throughout — the hard constraint, not a preference.
    public var stepFreeRequired: Bool
    /// Stairs are manageable but should be avoided where an alternative exists.
    public var limitStairs: Bool
    /// Anything the two flags above don't cover.
    public var note: String

    public init(stepFreeRequired: Bool = false, limitStairs: Bool = false, note: String = "") {
        self.stepFreeRequired = stepFreeRequired
        self.limitStairs = limitStairs
        self.note = note
    }

    public var isEmpty: Bool { !stepFreeRequired && !limitStairs && note.isEmpty }
}

/// Dietary restrictions that hold across every trip.
///
/// **Both empty is normal and means "no restrictions"** — which is different from the field being
/// absent. Carried per-trip even though it lives on the profile: the staged pipeline dropped it
/// silently once, and a food stop the traveler cannot eat at is the worst defect this app can
/// produce.
public struct DietaryNeeds: Codable, Sendable, Equatable {
    public var tags: [String]
    public var note: String

    public init(tags: [String] = [], note: String = "") {
        self.tags = tags
        self.note = note
    }

    public var isEmpty: Bool { tags.isEmpty && note.isEmpty }
}

/// A place the traveler pinned, or one suggested by `/api/nearby-pois`.
///
/// **Note `lon`, not `lng`** — contract rule 3. `CandidatePoi` is one of the four shapes on the
/// `lon` side of that split, and encoding it as `lng` would put the anchor in the wrong ocean.
public struct CandidatePoi: Codable, Sendable, Equatable {
    public let name: String
    public let lat: Double
    public let lon: Double
    public let kind: String?

    public init(name: String, lat: Double, lon: Double, kind: String? = nil) {
        self.name = name
        self.lat = lat
        self.lon = lon
        self.kind = kind
    }
}

// MARK: - The payload

/// Step 2b's answers (`UserAnswers` in `src/lib/types.ts:215-256`).
///
/// **The traveler answers who they are, not how fast to go.** `Pace` and the other resolved flags
/// are derived server-side by `deriveFlags` and are never asked — so nothing here is a planning
/// instruction, and this app must not invent one.
///
/// **One type for both directions, and every field optional.** This is the wizard's request body
/// *and* what comes back on `Trip.userAnswers`, and a trip saved before any of these fields
/// existed carries none of them — so optional is what reading demands, and encoding simply omits
/// what the wizard did not collect. Sending fewer fields degrades plan quality; it does not fail
/// the call.
public struct UserAnswers: Codable, Sendable, Equatable {
    public var purpose: String?
    public var explorerStyle: ExplorerStyle?
    public var group: GroupType?
    /// Free text, meaningful only when `group` is `.other` — "five college friends".
    public var groupOther: String?
    public var party: PartyCounts?
    public var logistics: TripLogistics?
    public var energy: EnergyLevel?
    public var crowds: CrowdPreference?
    public var budget: Double?
    /// Every tag the traveler selected.
    public var priorities: [String]?
    /// The up-to-three they starred, **in the order starred** — the primary weighting signal.
    /// Everything in `priorities` but not here is a tie-breaker only.
    public var topPriorities: [String]?
    /// Optional anchors. Empty is normal and expected: the model selects stops from the profile
    /// above, and these only pin what is already decided.
    public var selectedPois: [CandidatePoi]?
    public var customPois: [String]?
    public var dietary: DietaryNeeds?
    public var accessibility: AccessibilityNeeds?

    public init(
        purpose: String? = nil,
        explorerStyle: ExplorerStyle? = nil,
        group: GroupType? = nil,
        groupOther: String? = nil,
        party: PartyCounts? = nil,
        logistics: TripLogistics? = nil,
        energy: EnergyLevel? = nil,
        crowds: CrowdPreference? = nil,
        budget: Double? = nil,
        priorities: [String]? = nil,
        topPriorities: [String]? = nil,
        selectedPois: [CandidatePoi]? = nil,
        customPois: [String]? = nil,
        dietary: DietaryNeeds? = nil,
        accessibility: AccessibilityNeeds? = nil
    ) {
        self.purpose = purpose
        self.explorerStyle = explorerStyle
        self.group = group
        self.groupOther = groupOther
        self.party = party
        self.logistics = logistics
        self.energy = energy
        self.crowds = crowds
        self.budget = budget
        self.priorities = priorities
        self.topPriorities = topPriorities
        self.selectedPois = selectedPois
        self.customPois = customPois
        self.dietary = dietary
        self.accessibility = accessibility
    }
}

/// The fixed interest chips, from `InterestPicker.tsx:7-17`.
public enum Interests {
    public static let all = [
        "Food",
        "Wellness & Fitness",
        "Culture & History",
        "Nightlife",
        "Nature & Outdoors",
        "Shopping",
        "Family-Friendly",
        "Relaxation",
        "Photography",
    ]

    /// `MAX_STARRED_PRIORITIES`. **Starring is what actually discriminates between travelers** —
    /// everyone picks four or five tags, so the unstarred set flattens into noise. The server
    /// slices to this anyway (`userAnswers.ts:197`), so enforcing it here is about the traveler
    /// knowing which three counted, not about protecting the payload.
    public static let maxStarred = 3
}

/// The fixed dietary chips, from `DietaryPicker.tsx:8-17`. Deliberately short rather than an
/// attempt to enumerate every diet — the free-text note covers the rest.
public enum DietaryTags {
    public static let all = [
        "Vegetarian", "Vegan", "Pescatarian", "Halal",
        "Kosher", "Gluten-free", "Dairy-free", "Nut allergy",
    ]
}
