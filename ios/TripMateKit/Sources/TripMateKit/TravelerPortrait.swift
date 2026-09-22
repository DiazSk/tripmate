import Foundation

/// The traveller, as one sentence, under the picture.
///
/// **Composed from clause fragments rather than templated per combination.** Four enums multiply
/// out to 144 sentences; written as one string per combination that is 144 chances to ship an
/// awkward one. Written as four fragments that always join the same way, it is twelve short
/// strings and every combination reads the same shape:
///
/// `A solo traveller who wants a few things done well — at a comfortable pace, away from the
/// crowds.`
///
/// **It is the only thing on the screen that says who you are.** The record section below counts
/// trips and money, which are facts about what you did, not about how you travel. This line is
/// also the only place the four answers appear together, which is what makes it worth having:
/// each row states one of them in isolation.
///
/// It had a serif half and an SF half when it was a header card. The card is gone — a picture
/// opens the screen now — so it is one sentence in the system face, sitting under the avatar the
/// way a display name does.
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
