import SwiftUI
import TripMateKit

/// What stays true between trips, as an iOS settings screen.
///
/// **This is the app's one native surface, and that is the point.** Everything else here is
/// hand-rolled — the tab bar, the routing, the panel, the chips — for reasons each of those
/// files records. None of those reasons apply to a preferences list. A settings-shaped screen
/// that is not a `List` is the most common piece of native slop there is, and this screen was
/// it: a `ScrollView` of custom pills, no symbols, no system controls, no navigation, no
/// Dynamic Type. It read as a web form because it was one.
///
/// So the platform draws it. `List(.insetGrouped)` supplies the grouped containers, the
/// separators inset to the label's leading edge, the ≥44pt rows, the chevrons, the header and
/// footer styling, and Dynamic Type — none of which is worth hand-writing and all of which was
/// missing. Measured against iOS 26 Settings, not against a mockup of it.
///
/// **SF carries the list; the serif gets exactly one moment.** That is the HIG's own split —
/// body, labels and controls stay on the system face, a brand face appears in display moments —
/// and it is why rows here set no `textStyle` at all: the default *is* SF at the system size,
/// which is what makes Dynamic Type work for free. `Melodrama` appears once, on the header
/// card. Figures keep `Tabular`, because the record is a column of compared values.
///
/// **What it stops sharing with the wizard.** `ProfileView` used to render in `ChoiceRow` /
/// `TagGrid` / `Question` so the two forms could not drift. The rendering forks here — but the
/// drift that docstring feared was a *rules* drift, chiefly that deselecting a starred interest
/// must unstar it, which has a documented failure mode. That rule lives in `PlanDraft` and both
/// screens still call it. Only the pixels fork.
struct ProfileView: View {
    @Environment(ProfileStore.self) private var store
    /// For the record section. Read-only — Profile never writes trips.
    let trips: TripsStore

    /// **The serif has to scale with the rest, and `TextStyle` resolves literal points.** At
    /// AX5 the SF paragraph beneath this headline grew past it and the display face ended up
    /// the smallest text on the card. `@ScaledMetric` is the one-line way to put a fixed point
    /// size on the Dynamic Type curve; `max` keeps Melodrama's documented 28pt floor, which
    /// the small end of the curve would otherwise go under.
    @ScaledMetric(relativeTo: .title) private var displaySize: CGFloat = 28

    var body: some View {
        NavigationStack {
            List {
                headerCard
                record
                howYouTravel
                interests
                food
            }
            .listStyle(.insetGrouped)
            // The Kiln palette inside a real list. `surfaceDeep` is `rgb(28,26,24)` and iOS
            // dark's own grouped row background is `#1C1C1E` — within a point of each other,
            // which is why this needs no fighting.
            .scrollContentBackground(.hidden)
            .background(Token.canvas)
            .navigationTitle("Profile")
            .navigationBarTitleDisplayMode(.large)
        }
        // Without this every checkmark and control renders system blue. The app sets no
        // app-level tint; seven call sites do it per-control, and this is the eighth.
        .tint(Token.accent)
        .task { await store.load() }
    }

    // MARK: - Sections

    /// The screen's one display moment, in iOS 26's own header-card shape: a mark, a name, and
    /// a paragraph of explanation.
    private var headerCard: some View {
        Section {
            VStack(alignment: .leading, spacing: 0) {
                Image(systemName: "asterisk")
                    .font(.system(size: 30, weight: .regular))
                    .foregroundStyle(Token.accent)
                    .frame(width: 64, height: 64)
                    .background(Color.white.opacity(0.09))
                    .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
                    .padding(.bottom, 14)

                if store.hasProfile {
                    Text(TravelerPortrait.headline(store.draft.travelerProfile))
                        .textStyle(.display.size(max(28, displaySize)))
                        .foregroundStyle(Token.foreground)
                    Text(TravelerPortrait.detail(store.draft.travelerProfile))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .padding(.top, 9)
                } else {
                    Text(TravelerPortrait.unanswered)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 6)
            .listRowBackground(Token.surfaceDeep)
        } footer: {
            // The old screen said this in a loose caption under the title. A footer is the slot
            // the platform provides for exactly this sentence.
            Text("Answered once. Every new trip starts from here.")
        }
    }

    private var record: some View {
        Section("Your record") {
            figure("Trips", "\(kept.count)")
            figure("Countries", "\(Set(kept.map(\.country)).count)")
            figure(
                "Total planned",
                kept.reduce(0) { $0 + $1.budget }
                    .formatted(.currency(code: "USD").precision(.fractionLength(0))),
                tint: Token.money
            )
        }
    }

    private var howYouTravel: some View {
        Section {
            choice("Travels with", "person.2", GroupType.allCases, \.group)
            choice("Explores", "binoculars", ExplorerStyle.allCases, \.explorerStyle)
            choice("Walking", "figure.walk", EnergyLevel.allCases, \.energy)
            choice("Crowds", "person.3", CrowdPreference.allCases, \.crowds)
        } header: {
            Text("How you travel")
        } footer: {
            // A failed autosave has to be visible, or answers vanish quietly.
            if let message = store.message {
                Text(message).foregroundStyle(Token.alert)
            } else {
                Text("Every new trip is planned from these answers.")
            }
        }
    }

    private var interests: some View {
        Section {
            NavigationLink {
                InterestsList(store: store)
            } label: {
                row("Interests", "heart", value: interestsValue)
            }
            .listRowBackground(Token.surfaceDeep)
        } header: {
            Text("What you're into")
        } footer: {
            Text("Starred interests weigh most when a plan is written.")
        }
    }

    private var food: some View {
        Section {
            NavigationLink {
                DietaryList(store: store)
            } label: {
                row("Dietary needs", "fork.knife", value: dietaryValue)
            }
            .listRowBackground(Token.surfaceDeep)
        } header: {
            Text("Food")
        } footer: {
            Text("Named up front, so a plan never suggests somewhere you can't eat.")
        }
    }

    // MARK: - Rows

    private var kept: [TripSummary] { trips.trips }

    private var interestsValue: String {
        let chosen = store.draft.interests.count
        guard chosen > 0 else { return "None yet" }
        let starred = store.draft.starredInterests.count
        return starred > 0 ? "\(chosen) chosen, \(starred) starred" : "\(chosen) chosen"
    }

    private var dietaryValue: String {
        let needs = store.draft.dietary
        if needs.tags.isEmpty { return needs.note.isEmpty ? "Nothing noted" : "A note" }
        return needs.tags.count == 1 ? needs.tags[0] : "\(needs.tags.count) noted"
    }

    /// A label, its value, and nothing else — `List` draws the chevron for a `NavigationLink`.
    ///
    /// **The glyph is secondary, not the tint.** `.tint(Token.accent)` reaches icons too, and a
    /// row of jade symbols reads as six actions: jade means "action" here and nothing else.
    /// iOS uses colour on these tiles for identity, which is a job this palette does not have a
    /// colour spare for.
    private func row(_ label: String, _ symbol: String, value: String) -> some View {
        LabeledContent {
            Text(value).foregroundStyle(.secondary)
        } label: {
            Label {
                Text(label)
            } icon: {
                Image(systemName: symbol).foregroundStyle(.secondary)
            }
        }
    }

    private func figure(_ label: String, _ value: String, tint: Color = Token.foreground) -> some View {
        LabeledContent {
            Text(value)
                // The one place the figure face survives on this screen: three values compared
                // down a column, which is what `DESIGN.md` reserves it for.
                .textStyle(.money.size(16))
                .foregroundStyle(tint)
        } label: {
            Text(label)
        }
        .listRowBackground(Token.surfaceDeep)
    }

    /// One row per single-choice answer, pushing the option list that sets it.
    private func choice<Option: Hashable & Labelled>(
        _ label: String,
        _ symbol: String,
        _ options: [Option],
        _ path: WritableKeyPath<PlanDraft, Option>
    ) -> some View {
        NavigationLink {
            ChoiceList(title: label, options: options, store: store, path: path)
        } label: {
            row(label, symbol, value: store.draft[keyPath: path].label)
        }
        .listRowBackground(Token.surfaceDeep)
    }
}

/// One answer, chosen from a list. Serves all four single-choice questions.
///
/// The HIG's own pattern for this: *"a table that lists options often highlights a row only
/// briefly before adding an image — such as a checkmark."* Selecting pops, because the row you
/// came from is where the answer now reads.
private struct ChoiceList<Option: Hashable & Labelled>: View {
    let title: String
    let options: [Option]
    let store: ProfileStore
    let path: WritableKeyPath<PlanDraft, Option>

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            Section {
                ForEach(options, id: \.self) { option in
                    Button {
                        store.draft[keyPath: path] = option
                        store.edited()
                        dismiss()
                    } label: {
                        LabeledContent {
                            if option == store.draft[keyPath: path] {
                                Image(systemName: "checkmark").foregroundStyle(Token.accent)
                            }
                        } label: {
                            Text(option.label).foregroundStyle(Token.foreground)
                        }
                    }
                    .listRowBackground(Token.surfaceDeep)
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Token.canvas)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// The interests, where a row carries two statements: chosen, and one of the three that count.
///
/// Both go through `PlanDraft`, which owns the rules — starring an unchosen tag chooses it,
/// unchoosing a starred tag unstars it, and the cap is `Interests.maxStarred`. Neither is
/// re-implemented here.
private struct InterestsList: View {
    let store: ProfileStore

    var body: some View {
        List {
            Section {
                ForEach(Interests.all, id: \.self) { tag in
                    let chosen = store.draft.interests.contains(tag)
                    let starred = store.draft.starredInterests.contains(tag)
                    LabeledContent {
                        HStack(spacing: 14) {
                            Button {
                                store.draft.toggleStar(tag)
                                store.edited()
                            } label: {
                                Image(systemName: starred ? "star.fill" : "star")
                                    .foregroundStyle(starred ? Token.money : .secondary)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(starred ? "Unstar \(tag)" : "Star \(tag)")

                            if chosen {
                                Image(systemName: "checkmark").foregroundStyle(Token.accent)
                            }
                        }
                    } label: {
                        Button {
                            store.draft.toggleInterest(tag)
                            store.edited()
                        } label: {
                            Text(tag).foregroundStyle(Token.foreground)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                    .listRowBackground(Token.surfaceDeep)
                    .accessibilityValue(
                        chosen ? (starred ? "chosen, starred" : "chosen") : "not chosen"
                    )
                }
            } footer: {
                Text(
                    store.draft.starsRemaining > 0
                        ? "Tap to choose. Star up to \(store.draft.starsRemaining) more — those count most."
                        : "Those \(Interests.maxStarred) count most."
                )
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Token.canvas)
        .navigationTitle("Interests")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Anything the traveller can't eat: the tags, plus the note for what the tags don't cover.
private struct DietaryList: View {
    let store: ProfileStore

    var body: some View {
        List {
            Section {
                ForEach(DietaryTags.all, id: \.self) { tag in
                    let on = store.draft.dietary.tags.contains(tag)
                    Button {
                        if let index = store.draft.dietary.tags.firstIndex(of: tag) {
                            store.draft.dietary.tags.remove(at: index)
                        } else {
                            store.draft.dietary.tags.append(tag)
                        }
                        store.edited()
                    } label: {
                        LabeledContent {
                            if on {
                                Image(systemName: "checkmark").foregroundStyle(Token.accent)
                            }
                        } label: {
                            Text(tag).foregroundStyle(Token.foreground)
                        }
                    }
                    .listRowBackground(Token.surfaceDeep)
                }
            }

            Section {
                TextField(
                    "Anything the list doesn't cover",
                    text: Binding(
                        get: { store.draft.dietary.note },
                        set: { store.draft.dietary.note = $0; store.edited() }
                    ),
                    axis: .vertical
                )
                .foregroundStyle(Token.foreground)
                .listRowBackground(Token.surfaceDeep)
            } header: {
                Text("In your own words")
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Token.canvas)
        .navigationTitle("Dietary needs")
        .navigationBarTitleDisplayMode(.inline)
    }
}
