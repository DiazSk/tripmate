import Foundation

/// The traveller, as one sentence.
///
/// **Composed from clause fragments rather than templated per combination.** Four enums multiply
/// out to 144 sentences; written as one string per combination that is 144 chances to ship an
/// awkward one. Written as four fragments that always join the same way, it is twelve short
/// strings and every combination reads the same shape:
///
/// `A solo traveller who wants a few things done well — at a comfortable pace, away from the
/// crowds.`
public enum TravelerPortrait {

    /// The invitation, for somebody who has never answered. **Never guess a sentence from
    /// `PlanDraft`'s defaults**: they resolve to solo/mixed/moderate/mixed, which would state
    /// four facts the traveller never gave.
    public static let unanswered =
        "Tell us how you travel, and every plan after this one starts from it."

    /// The card's serif line: who you are, in a phrase short enough for a display face.
    ///
    /// **It deliberately does not name the screen.** It read "Your travel profile" under a
    /// "Profile" large title — the same words twice, thirty points apart, which is the stutter
    /// this app has already shipped once in the trip header. A card under a large title names
    /// its subject, not its page: Settings' own root card says "Apple Account", not "Settings".
    public static func headline(group: GroupType, explorerStyle: ExplorerStyle) -> String {
        "\(subject(group)) \(pursuit(explorerStyle))"
    }

    /// The rest of it, beneath the headline in the system face. Two halves of one sentence, so
    /// no fragment is written twice.
    public static func detail(energy: EnergyLevel, crowds: CrowdPreference) -> String {
        let opener = pace(energy)
        return "\(opener.prefix(1).uppercased())\(opener.dropFirst()), \(company(crowds))."
    }

    public static func headline(_ profile: TravelerProfile) -> String {
        headline(group: profile.group, explorerStyle: profile.explorerStyle)
    }

    public static func detail(_ profile: TravelerProfile) -> String {
        detail(energy: profile.energy, crowds: profile.crowds)
    }

    private static func subject(_ group: GroupType) -> String {
        switch group {
        case .solo: "A solo traveller"
        case .couple: "A couple"
        case .familyWithKids: "A family with kids"
        // "Something else" is not a description, so the sentence declines to invent one.
        case .other: "A traveller"
        }
    }

    private static func pursuit(_ style: ExplorerStyle) -> String {
        switch style {
        case .packed: "who wants to see as much as possible"
        case .relaxed: "who wants a few things done well"
        case .offbeat: "who looks off the beaten path"
        case .mixed: "who likes a bit of both"
        }
    }

    private static func pace(_ energy: EnergyLevel) -> String {
        switch energy {
        case .high: "happy to walk all day"
        case .moderate: "at a comfortable pace"
        case .low: "taking it gently"
        }
    }

    private static func company(_ crowds: CrowdPreference) -> String {
        switch crowds {
        case .love: "in the thick of it"
        case .mixed: "some buzz and some quiet"
        case .avoid: "away from the crowds"
        }
    }
}

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
