import SwiftUI
import TripMateKit

/// Offered once a plan comes back: keep the durable half of what was just answered.
///
/// **This is a real surface on the web and was in no version of the iOS plan.** It appears over
/// the finished itinerary — "Save these for next time? We'll remember how you travel and ask
/// three fewer questions on your next trip." — and it is the only place the wizard's answers
/// ever reach the saved profile. Without it every trip starts from defaults forever, and the
/// profile tab is the sole way to fill it in, which nobody will find.
///
/// **A system `.sheet`, and the P0b objection does not apply.** That objection was that a sheet
/// presents at window level and covers the tab bar, leaving the app with no navigation — fatal
/// for the plan panel, which is a place you live. This is a modal question with two answers and
/// no navigation to reach; covering the bar is what a modal is *for*.
///
/// Dietary is editable here for the reason the web gives it its own line: it is the one answer
/// where being wrong produces a stop the traveller cannot eat at, so it gets a last look before
/// it becomes permanent.
struct SaveProfileSheet: View {
    /// What the trip just answered, adjustable before it is kept.
    @State var candidate: TravelerProfile
    let store: ProfileStore
    let onFinish: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Token.gapPanels) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Save these for next time?")
                        .textStyle(.display)
                        .foregroundStyle(Token.foreground)
                    Text(
                        """
                        We'll remember how you travel and ask fewer questions on your next \
                        trip. You can change any of it later on your profile.
                        """
                    )
                    .textStyle(.body)
                    .foregroundStyle(Token.muted)
                }

                Question("Any dietary needs? We'll apply them to every food stop.") {
                    TagGrid(
                        tags: DietaryTags.all,
                        isSelected: { candidate.dietary.tags.contains($0) },
                        onTap: { tag in
                            if let index = candidate.dietary.tags.firstIndex(of: tag) {
                                candidate.dietary.tags.remove(at: index)
                            } else {
                                candidate.dietary.tags.append(tag)
                            }
                        }
                    )
                }

                if let message = store.message {
                    Alert(text: message)
                }

                HStack(spacing: Token.gapRows) {
                    Button("Not now", action: onFinish)
                        .buttonStyle(GhostButtonStyle())
                    Button("Save my profile") {
                        Task {
                            store.draft = PlanDraft(profile: candidate)
                            await store.save()
                            // A failed save keeps the sheet up with its reason showing rather
                            // than dismissing on a promise it did not keep.
                            if store.message == nil { onFinish() }
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(store.isSaving)
                }
                .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .padding(Token.padCompact)
        }
        .background(Token.canvas)
    }
}
