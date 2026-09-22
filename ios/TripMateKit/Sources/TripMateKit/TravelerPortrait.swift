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

    public static func sentence(
        group: GroupType,
        explorerStyle: ExplorerStyle,
        energy: EnergyLevel,
        crowds: CrowdPreference
    ) -> String {
        "\(subject(group)) \(pursuit(explorerStyle)) — \(pace(energy)), \(company(crowds))."
    }

    /// Convenience for the one caller that holds a whole profile.
    public static func sentence(_ profile: TravelerProfile) -> String {
        sentence(
            group: profile.group,
            explorerStyle: profile.explorerStyle,
            energy: profile.energy,
            crowds: profile.crowds
        )
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
