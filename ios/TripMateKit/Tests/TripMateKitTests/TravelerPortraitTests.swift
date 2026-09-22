import Testing
@testable import TripMateKit

/// The point of these is the 144-combination sweep, not the three spot checks. A sentence built
/// from fragments can only fail in the joins, and the sweep is what reads every join.
struct TravelerPortraitTests {

    @Test func namesAllFourAnswers() {
        #expect(
            TravelerPortrait.sentence(
                group: .couple, explorerStyle: .mixed, energy: .moderate, crowds: .avoid
            ) == "A couple who likes a bit of both — at a comfortable pace, away from the crowds."
        )
    }

    @Test func declinesToDescribeSomethingElse() {
        let sentence = TravelerPortrait.sentence(
            group: .other, explorerStyle: .packed, energy: .high, crowds: .love
        )
        #expect(sentence.hasPrefix("A traveller who wants to see as much as possible"))
    }

    @Test func everyCombinationReadsAsOneSentence() {
        for group in GroupType.allCases {
            for style in ExplorerStyle.allCases {
                for energy in EnergyLevel.allCases {
                    for crowds in CrowdPreference.allCases {
                        let s = TravelerPortrait.sentence(
                            group: group, explorerStyle: style, energy: energy, crowds: crowds
                        )
                        #expect(s.hasPrefix("A "))
                        #expect(s.hasSuffix("."))
                        // One dash and one comma: the fragments joined once each, so no
                        // fragment smuggles in its own punctuation.
                        #expect(s.filter { $0 == "—" }.count == 1)
                        #expect(s.filter { $0 == "," }.count == 1)
                        #expect(!s.contains("  "))
                    }
                }
            }
        }
    }
}
