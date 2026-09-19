import SwiftUI
import TripMateKit

/// What stays true between trips. `ProfileForm.tsx` is the model.
///
/// **Rendered in the wizard's own controls, not lookalikes.** Every question here is a question
/// the wizard already asks, so `Question`, `ChoiceRow`, `TagGrid` and `PlainField` are reused
/// directly — which is also what stops the two forms drifting apart as either is tuned.
///
/// **Cut from the web: the memories column** (`ProfileForm.tsx:73-201`, ~130 of its 449 lines)
/// and the footer. That column exists because a settings *route* needed connective tissue back
/// to `/trips`; here the Trips tab is one tap away and is that tissue.
struct ProfileView: View {
    @Environment(ProfileStore.self) private var store

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Token.gapPanels) {
                header

                if let message = store.message {
                    Notice(text: message)
                }

                ChoiceRow(
                    title: "Who you usually travel with",
                    options: GroupType.allCases,
                    selection: bind(\.group)
                )
                interests
                ChoiceRow(
                    title: "How you like to explore",
                    options: ExplorerStyle.allCases,
                    selection: bind(\.explorerStyle)
                )
                ChoiceRow(
                    title: "How much walking",
                    options: EnergyLevel.allCases,
                    selection: bind(\.energy)
                )
                ChoiceRow(
                    title: "Crowds",
                    options: CrowdPreference.allCases,
                    selection: bind(\.crowds)
                )
                dietary

                saveRow
            }
        }
        .task { await store.load() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Your travel profile")
                .textStyle(.display)
                .foregroundStyle(Token.foreground)
            // The durable/trip split is the whole reason this screen exists rather than the
            // wizard simply remembering — `TravelerProfile`'s docstring makes the argument.
            Text("Answered once. Every new trip starts here.")
                .textStyle(.detail)
                .foregroundStyle(Token.muted)
        }
    }

    /// Starring is what discriminates between travelers — see `PreferencesStep.interests`, whose
    /// reasoning applies unchanged.
    private var interests: some View {
        Question("What you're into") {
            TagGrid(
                tags: Interests.all,
                isSelected: { store.draft.interests.contains($0) },
                isStarred: { store.draft.starredInterests.contains($0) },
                onTap: { store.draft.toggleInterest($0); store.markEdited() },
                onStar: { store.draft.toggleStar($0); store.markEdited() }
            )
            Text(
                store.draft.starsRemaining > 0
                    ? "Star up to \(store.draft.starsRemaining) more — those count most."
                    : "Those three count most."
            )
            .textStyle(.caption)
            .foregroundStyle(Token.muted)
        }
    }

    private var dietary: some View {
        Question("Anything you can't eat") {
            TagGrid(
                tags: DietaryTags.all,
                isSelected: { store.draft.dietary.tags.contains($0) },
                onTap: { tag in
                    if let index = store.draft.dietary.tags.firstIndex(of: tag) {
                        store.draft.dietary.tags.remove(at: index)
                    } else {
                        store.draft.dietary.tags.append(tag)
                    }
                    store.markEdited()
                }
            )
            PlainField(
                placeholder: "Anything the chips don't cover",
                text: bind(\.dietary.note)
            )
        }
    }

    private var saveRow: some View {
        HStack(spacing: Token.gapRows) {
            Button("Save profile") {
                Task { await store.save() }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(store.isSaving)

            if store.isSaving {
                ProgressView().tint(Token.accent)
            } else if store.isSaved {
                Text("Saved")
                    .textStyle(.detail)
                    .foregroundStyle(Token.muted)
            }
            Spacer(minLength: 0)
        }
    }

    /// Every write clears the "Saved" confirmation, so it can never describe a stale state.
    private func bind<T>(_ path: WritableKeyPath<PlanDraft, T>) -> Binding<T> {
        Binding(
            get: { store.draft[keyPath: path] },
            set: { store.draft[keyPath: path] = $0; store.markEdited() }
        )
    }
}
