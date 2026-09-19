import SwiftUI
import TripMateKit

/// The four questions, in the docked panel. `HomeView.tsx`'s plan step is the model.
///
/// **Four screens, and the web's own note explains why these four.** It used to be
/// `basics → purpose → group → pois`: `purpose` was one optional text input, which never justified
/// a screen, and `pois` was empty more often than not and ended the flow on an apology. Both jobs
/// moved — purpose onto `preferences`, the POI picker onto `review`, which now states the whole
/// trip back before committing to it.
///
/// **What does not port is the console trough.** The web's four basics fields share one recessed
/// slate with hairlines *between* them rather than borders *around* them, and the focused cell
/// steps up while an accent hairline wipes across its bottom edge. That is a `:focus-within`
/// selector plus a keyframed pseudo-element; SwiftUI has neither, and reaching for a
/// `PreferenceKey` to rebuild the wipe would be a lot of machinery for the form's one motion. The
/// grouping survives — one trough, hairlines between cells, the label accenting on focus — the
/// wipe does not.
struct PlanWizardView: View {
    let plan: PlanStore
    /// Called with the draft trip's id once a plan comes back and is saved.
    let onGenerated: (String) -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Token.gapPanels) {
            header

            if plan.isGenerating {
                waiting
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: Token.gapPanels) {
                        step
                    }
                    .padding(.bottom, Token.gapRows)
                }
                footer
            }

            Spacer(minLength: 0)
        }
    }

    // MARK: - Chrome

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button(action: onCancel) {
                HStack(spacing: 4) {
                    Image(systemName: "chevron.left")
                    Text("Memories")
                }
                .textStyle(.detail.weight(TextStyle.medium))
                .foregroundStyle(Token.muted)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Text(plan.step.title)
                .textStyle(.display)
                .foregroundStyle(Token.foreground)

            // Position, not a percentage. Four steps is few enough to count.
            Text("Step \(index + 1) of \(PlanStep.allCases.count)")
                .textStyle(.money.size(12))
                .foregroundStyle(Token.muted)
        }
    }

    private var index: Int {
        PlanStep.allCases.firstIndex(of: plan.step) ?? 0
    }

    @ViewBuilder
    private var step: some View {
        switch plan.step {
        case .basics: BasicsStep(plan: plan)
        case .group: GroupStep(plan: plan)
        case .preferences: PreferencesStep(plan: plan)
        case .review: ReviewStep(plan: plan)
        }
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: Token.gapRows) {
            if let message = plan.message { Notice(text: message) }

            HStack(spacing: Token.gapRows) {
                if plan.step.previous != nil {
                    Button("Back") { plan.back() }
                        .buttonStyle(GhostButtonStyle())
                }
                Spacer(minLength: 0)
                if plan.step == .review {
                    Button("Generate") {
                        Task {
                            if let id = await plan.generate() { onGenerated(id) }
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(!plan.draft.canGenerate)
                } else {
                    Button("Next") { plan.advance() }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(!plan.draft.canAdvance(from: plan.step))
                }
            }
        }
    }

    /// One line while the model writes.
    ///
    /// **A generation is 60-150 s**, so silence is not an option, and the stage frames are already
    /// parsed by the client. B5 turns this into the real progress surface — the stage list, the
    /// stops appearing on the map as they stream, the staggered reveal.
    private var waiting: some View {
        VStack(alignment: .leading, spacing: Token.gapRows) {
            HStack(spacing: 10) {
                ProgressView().tint(Token.accent)
                Text(plan.stage?.waitingLabel ?? "Starting…")
                    .textStyle(.body)
                    .foregroundStyle(Token.foreground)
            }
            Text("This takes a minute or two. \(plan.draft.days) days of \(plan.draft.destination).")
                .textStyle(.detail)
                .foregroundStyle(Token.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Token.gapRows)
        .background(Color.white.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: Token.radiusMedium, style: .continuous))
    }
}

// MARK: - Step 1: where and when

private struct BasicsStep: View {
    let plan: PlanStore
    @FocusState private var focus: Field?

    private enum Field { case destination, start, end, budget }

    var body: some View {
        VStack(alignment: .leading, spacing: Token.gapRows) {
            // One trough, hairlines between the cells — see the note on `PlanWizardView`.
            VStack(spacing: 0) {
                FieldCell(label: "Destination", isFocused: focus == .destination) {
                    TextField("Kyoto, Japan", text: bind(\.destination))
                        .focused($focus, equals: .destination)
                        .textFieldStyle(.plain)
                        .autocorrectionDisabled()
                        .textStyle(.bodyLarge)
                        .foregroundStyle(Token.foreground)
                }
                Hairline()
                FieldCell(label: "Arrive", isFocused: focus == .start) {
                    DateField(value: bind(\.startDate), earliest: Tiers.todayISO())
                }
                Hairline()
                FieldCell(label: "Leave", isFocused: focus == .end) {
                    DateField(
                        value: bind(\.endDate),
                        earliest: plan.draft.startDate.isEmpty
                            ? Tiers.todayISO() : plan.draft.startDate
                    )
                }
                Hairline()
                FieldCell(label: "Budget", isFocused: focus == .budget) {
                    HStack(spacing: 2) {
                        Text("$").foregroundStyle(Token.muted)
                        // **A string binding, not `value:format:`.** With a numeric binding the
                        // field showed the draft's initial `0` and typing appended to it — a
                        // measured `$ 01800`, which parsed to the right number and read as a
                        // typo. Zero means "not answered yet" here, so it has to render as the
                        // placeholder rather than as a figure.
                        TextField("2,600", text: budgetText)
                            .focused($focus, equals: .budget)
                            .textFieldStyle(.plain)
                            .keyboardType(.numberPad)
                            .textStyle(.money.size(16))
                            .foregroundStyle(Token.foreground)
                    }
                }
            }
            .background(Color.black.opacity(0.22))
            .clipShape(RoundedRectangle(cornerRadius: Token.radiusMedium, style: .continuous))
            // The geocode fires when the destination field gives up focus, not on a keystroke
            // debounce. See `PlanStore.geocodeDestination`.
            .onChange(of: focus) { previous, _ in
                guard previous == .destination else { return }
                Task { await plan.geocodeDestination() }
            }

            // A miss is said, never enforced — the trip plans regardless.
            if plan.draft.destinationMissed {
                Notice(text: "We couldn't find that place, but the plan will still work.")
            }
            if let problem = plan.draft.crossFieldProblem {
                Alert(text: problem)
            }
            if plan.draft.budget > 0, !plan.draft.startDate.isEmpty, !plan.draft.endDate.isEmpty {
                tierReadout
            }
        }
    }

    /// The spending style, stated and never offered.
    ///
    /// **There is no tier step, and this is why the picker went.** Tier is derived from the budget
    /// and the day count, so a chooser could only ever contradict the number just typed — and a
    /// stored preference did exactly that twice.
    private var tierReadout: some View {
        let tier = Tiers.tier(plan.draft.tier)
        return VStack(alignment: .leading, spacing: 2) {
            Text("\(plan.draft.days) days · \(tier.name)")
                .textStyle(.detail.weight(TextStyle.medium))
                .foregroundStyle(Token.foreground)
            Text(tier.description)
                .textStyle(.caption)
                .foregroundStyle(Token.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Token.gapRows)
        .background(Token.moneySoft)
        .clipShape(RoundedRectangle(cornerRadius: Token.radiusSmall, style: .continuous))
    }

    /// Digits only, and empty at zero. The keypad already restricts what can be typed; the filter
    /// is for a paste.
    private var budgetText: Binding<String> {
        Binding(
            get: { plan.draft.budget > 0 ? String(Int(plan.draft.budget)) : "" },
            set: { plan.draft.budget = Double($0.filter(\.isNumber)) ?? 0 }
        )
    }

    private func bind<T>(_ path: WritableKeyPath<PlanDraft, T>) -> Binding<T> {
        Binding(get: { plan.draft[keyPath: path] }, set: { plan.draft[keyPath: path] = $0 })
    }
}

// MARK: - Step 2: who's going

private struct GroupStep: View {
    let plan: PlanStore

    var body: some View {
        VStack(alignment: .leading, spacing: Token.gapPanels) {
            ChoiceRow(
                title: "Who's travelling",
                options: GroupType.allCases,
                selection: bind(\.group)
            )

            if plan.draft.group == .other {
                Question("In a word or two") {
                    PlainField(placeholder: "five college friends", text: bind(\.groupOther))
                }
            }

            // Age bands rather than exact ages — the bands are what map onto a planning rule
            // (stroller access, nap windows, ride height limits), and asking for a precise age
            // would imply a precision that changes nothing.
            Question("Party") {
                VStack(spacing: 0) {
                    CountRow(label: "Adults", value: bind(\.party.adults), range: 1...12)
                    Hairline()
                    CountRow(label: "Children (2-11)", value: bind(\.party.children), range: 0...12)
                    Hairline()
                    CountRow(label: "Infants (under 2)", value: bind(\.party.infants), range: 0...6)
                }
                .background(Color.black.opacity(0.22))
                .clipShape(RoundedRectangle(cornerRadius: Token.radiusMedium, style: .continuous))
            }

            // **Nobody has to fill this in.** `sanitizeLogistics` collapses an all-empty object to
            // null server-side, so skipping the row gets the prompt it would have got before the
            // row existed — and every rule that reads a field degrades rather than assuming.
            Question("Already booked (optional)") {
                VStack(spacing: 0) {
                    OptionalField(
                        label: "Arrival time", placeholder: "14:30",
                        value: bind(\.logistics.arrivalTime)
                    )
                    Hairline()
                    OptionalField(
                        label: "Arriving at", placeholder: "Kansai Intl (KIX)",
                        value: bind(\.logistics.arrivalPoint)
                    )
                    Hairline()
                    OptionalField(
                        label: "Departure time", placeholder: "09:15",
                        value: bind(\.logistics.departureTime)
                    )
                    Hairline()
                    OptionalField(
                        label: "Leaving from", placeholder: "Kyoto Station",
                        value: bind(\.logistics.departurePoint)
                    )
                }
                .background(Color.black.opacity(0.22))
                .clipShape(RoundedRectangle(cornerRadius: Token.radiusMedium, style: .continuous))
            }
        }
    }

    private func bind<T>(_ path: WritableKeyPath<PlanDraft, T>) -> Binding<T> {
        Binding(get: { plan.draft[keyPath: path] }, set: { plan.draft[keyPath: path] = $0 })
    }
}

// MARK: - Step 3: what you're after

private struct PreferencesStep: View {
    let plan: PlanStore

    var body: some View {
        VStack(alignment: .leading, spacing: Token.gapPanels) {
            // Purpose used to be its own screen and did not earn one. It opens this step instead.
            Question("What's the trip for? (optional)") {
                PlainField(placeholder: "Anniversary, first visit, food…", text: bind(\.purpose))
            }

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

            Question("Anything you can't eat") {
                TagGrid(
                    tags: DietaryTags.all,
                    isSelected: { plan.draft.dietary.tags.contains($0) },
                    onTap: { tag in
                        if let index = plan.draft.dietary.tags.firstIndex(of: tag) {
                            plan.draft.dietary.tags.remove(at: index)
                        } else {
                            plan.draft.dietary.tags.append(tag)
                        }
                    }
                )
                PlainField(placeholder: "Anything the chips don't cover", text: bind(\.dietary.note))
            }

            // **Asked directly, not inferred from `energy`.** "How much do you want to walk" is a
            // different question from "can you manage stairs" — using the first as a proxy for the
            // second gave a wheelchair user who describes their energy as high no accommodation
            // at all.
            Question("Getting around") {
                Toggle("Step-free routes required", isOn: bind(\.accessibility.stepFreeRequired))
                Toggle("Avoid stairs where possible", isOn: bind(\.accessibility.limitStairs))
                PlainField(placeholder: "Anything else we should know", text: bind(\.accessibility.note))
            }
            .tint(Token.accent)
            .textStyle(.body)
            .foregroundStyle(Token.foreground)
        }
    }

    /// Tags, where a selected tag can additionally be starred.
    ///
    /// **Starring is what discriminates between travelers.** Everyone picks four or five tags, so
    /// the unstarred set flattens into noise; the starred few drive POI weighting and day themes.
    /// The star is nested inside the tag rather than living in a second list, so ranking never
    /// costs a second pass over the same names.
    private var interests: some View {
        Question("What you're into") {
            TagGrid(
                tags: Interests.all,
                isSelected: { plan.draft.interests.contains($0) },
                isStarred: { plan.draft.starredInterests.contains($0) },
                onTap: { plan.draft.toggleInterest($0) },
                onStar: { plan.draft.toggleStar($0) }
            )
            Text(
                plan.draft.starsRemaining > 0
                    ? "Star up to \(plan.draft.starsRemaining) more — those count most."
                    : "Those three count most."
            )
            .textStyle(.caption)
            .foregroundStyle(Token.muted)
        }
    }

    private func bind<T>(_ path: WritableKeyPath<PlanDraft, T>) -> Binding<T> {
        Binding(get: { plan.draft[keyPath: path] }, set: { plan.draft[keyPath: path] = $0 })
    }
}

// MARK: - Step 4: review

/// The whole trip stated back, plus the one optional block that used to be its own dead-end screen.
///
/// **This screen exists because `pois` did not earn one.** It was empty more often than not — no
/// `OPENTRIPMAP_API_KEY`, or nothing nearby — and ended the flow on an apology with no summary of
/// what was about to be generated. Naming your own anchors is a block here instead.
private struct ReviewStep: View {
    let plan: PlanStore
    @State private var pending = ""

    var body: some View {
        VStack(alignment: .leading, spacing: Token.gapPanels) {
            summary

            Question("Anywhere you already know you want to go? (optional)") {
                HStack(spacing: 8) {
                    PlainField(placeholder: "Palazzo Piccolomini", text: $pending)
                        .onSubmit(add)
                    Button("Add", action: add)
                        .buttonStyle(GhostButtonStyle())
                        .disabled(pending.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                if !plan.draft.customPois.isEmpty {
                    TagGrid(
                        tags: plan.draft.customPois,
                        isSelected: { _ in true },
                        onTap: { name in plan.draft.customPois.removeAll { $0 == name } }
                    )
                }
                Text("Optional anchors only — the rest is chosen from your answers above.")
                    .textStyle(.caption)
                    .foregroundStyle(Token.muted)
            }
        }
    }

    private func add() {
        plan.draft.addCustomPoi(pending)
        pending = ""
    }

    private var summary: some View {
        let draft = plan.draft
        let tier = Tiers.tier(draft.tier)
        return VStack(alignment: .leading, spacing: 0) {
            SummaryRow(label: "Where", value: draft.destination) { plan.go(to: .basics) }
            Hairline()
            SummaryRow(
                label: "When", value: "\(draft.startDate) → \(draft.endDate) · \(draft.days) days"
            ) { plan.go(to: .basics) }
            Hairline()
            SummaryRow(
                label: "Budget",
                value: draft.budget.formatted(
                    .currency(code: "USD").precision(.fractionLength(0))
                ) + " · " + tier.name
            ) { plan.go(to: .basics) }
            Hairline()
            SummaryRow(label: "Who", value: whoLabel) { plan.go(to: .group) }
            Hairline()
            SummaryRow(label: "Into", value: intoLabel) { plan.go(to: .preferences) }
        }
        .background(Color.black.opacity(0.22))
        .clipShape(RoundedRectangle(cornerRadius: Token.radiusMedium, style: .continuous))
    }

    private var whoLabel: String {
        let draft = plan.draft
        var parts = [draft.group == .other && !draft.groupOther.isEmpty
            ? draft.groupOther : draft.group.label]
        let heads = draft.party.adults + draft.party.children + draft.party.infants
        if heads > 1 { parts.append("\(heads) people") }
        return parts.joined(separator: " · ")
    }

    private var intoLabel: String {
        let draft = plan.draft
        // Starred first, because the order is the weighting.
        let ordered = draft.starredInterests + draft.interests.filter {
            !draft.starredInterests.contains($0)
        }
        return ordered.isEmpty ? "Open to anything" : ordered.joined(separator: ", ")
    }
}

// MARK: - Parts

/// One labelled cell inside the basics trough.
///
/// The label accents on focus, which is the cell's visual job. The web also wipes an accent
/// hairline across the bottom edge — a keyframed pseudo-element with no SwiftUI equivalent worth
/// the machinery. See the note on `PlanWizardView`.
private struct FieldCell<Content: View>: View {
    let label: String
    let isFocused: Bool
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased())
                .textStyle(.label)
                .foregroundStyle(isFocused ? Token.accent : Token.muted)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Token.gapRows)
        .padding(.vertical, 10)
    }
}

/// A date: our own text, and the system picker only for input.
///
/// **The `.compact` `DatePicker` draws its own label, and that is why it is not used here.** It
/// renders in the system font and chooses its own format, so on this screen it was the one piece
/// of text the design system did not own — and it picked differently for the two fields, showing
/// "Sep 19, 2026" beside "9/25/26".
///
/// That was diagnosed rather than guessed, and the first three answers were wrong: it is not the
/// ambient font (an explicit `.font` changed nothing), not positional (given identical values
/// both fields render long), and not a width negotiation (`.fixedSize()` changed nothing). What
/// is left is the control's own formatter, which takes no instruction. So the label is ours now,
/// the format is stated, and the control is reduced to the job it is good at.
///
/// **The ISO string stays the source of truth; the draft never holds a `Date`.**
///
/// The conversion runs through `Calendar.current`, and an `ISO8601DateFormatter` pinned to UTC
/// here is a bug — measured, not theorised. The first version used one and rendered `2026-09-15`
/// as **9/14/26**: parsing gives UTC midnight, the picker displays that instant locally, and
/// local time is behind UTC for most of the Americas, so the day shown was not the day stored.
/// That is the same off-by-one CLAUDE.md records reaching generated output once already.
///
/// A date-only string is a *calendar day*, not an instant, so it becomes the local midnight of
/// that day and is read back as the local calendar day. `Tiers.tripDays` parsing in UTC stays
/// correct because both ends are calendar days and only their difference is used.
private struct DateField: View {
    @Binding var value: String
    /// The earliest selectable day, as ISO. Local today for arrival; the arrival date for
    /// departure, so the reversed-range rule is unreachable by picker.
    let earliest: String

    @State private var isPicking = false

    private var selection: Binding<Date> {
        Binding(get: parsed, set: { value = Self.iso($0) })
    }

    var body: some View {
        Button { isPicking = true } label: {
            Text(parsed(), format: .dateTime.month(.abbreviated).day().year())
                .textStyle(.bodyLarge)
                .foregroundStyle(Token.foreground)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        // A popover on a regular-width layout, which iOS renders as a sheet on a compact one —
        // so this is one declaration for both, rather than a size-class branch.
        .popover(isPresented: $isPicking) {
            DatePicker(
                "",
                selection: selection,
                in: (Self.date(from: earliest) ?? .distantPast)...,
                displayedComponents: .date
            )
            .labelsHidden()
            .datePickerStyle(.graphical)
            .tint(Token.accent)
            // **An explicit width, because a popover sizes to its content and a graphical
            // `DatePicker` will compress to whatever it is given.** Anchored on a ~110pt label
            // it rendered as a 115pt strip showing one column of the month grid. 320 is the
            // width the month view actually wants.
            .frame(width: 320)
            .padding(Token.gapRows)
            .presentationCompactAdaptation(.popover)
        }
    }

    private func parsed() -> Date {
        Self.date(from: value) ?? Self.date(from: earliest) ?? Date()
    }

    private static func date(from iso: String, calendar: Calendar = .current) -> Date? {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(
            from: DateComponents(year: parts[0], month: parts[1], day: parts[2])
        )
    }

    private static func iso(_ date: Date, calendar: Calendar = .current) -> String {
        Tiers.todayISO(date, calendar: calendar)
    }
}

/// A count, with the number visible.
///
/// **`Stepper`'s own label is the whole row and it does not show the value** — the first version
/// used `Stepper("Adults", value:)` and rendered a label and two buttons with no number anywhere,
/// so a party of three looked identical to a party of one. The count goes between them.
private struct CountRow: View {
    let label: String
    @Binding var value: Int
    let range: ClosedRange<Int>

    var body: some View {
        Stepper(value: $value, in: range) {
            HStack {
                Text(label)
                    .textStyle(.body)
                    .foregroundStyle(Token.foreground)
                Spacer(minLength: 8)
                Text("\(value)")
                    .textStyle(.money.size(14))
                    .foregroundStyle(value == range.lowerBound ? Token.muted : Token.foreground)
            }
        }
        .padding(.horizontal, Token.gapRows)
        .padding(.vertical, 4)
    }
}

private struct Hairline: View {
    var body: some View {
        Rectangle().fill(Color.white.opacity(0.08)).frame(height: 1)
    }
}

private struct Question<Content: View>: View {
    let title: String
    @ViewBuilder var content: () -> Content

    init(_ title: String, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .textStyle(.body.weight(TextStyle.medium))
                .foregroundStyle(Token.foreground)
            content()
        }
    }
}

/// A fixed choice, as chips. Every one of these has a default, which is what makes the step
/// skippable — see `PlanDraft.canAdvance`.
private struct ChoiceRow<Option: Hashable & CaseIterable>: View {
    let title: String
    let options: [Option]
    @Binding var selection: Option
    /// Every option type here carries its own copy; the enum is the single source for it.
    var label: (Option) -> String = { ($0 as? any Labelled)?.label ?? "\($0)" }

    var body: some View {
        Question(title) {
            FlowRow {
                ForEach(options, id: \.self) { option in
                    Chip(
                        text: label(option),
                        isSelected: option == selection,
                        action: { selection = option }
                    )
                }
            }
        }
    }
}

/// So `ChoiceRow` can read one label off any of the four answer enums without four copies of it.
protocol Labelled { var label: String { get } }
extension ExplorerStyle: Labelled {}
extension GroupType: Labelled {}
extension EnergyLevel: Labelled {}
extension CrowdPreference: Labelled {}

private struct TagGrid: View {
    let tags: [String]
    let isSelected: (String) -> Bool
    var isStarred: ((String) -> Bool)?
    let onTap: (String) -> Void
    var onStar: ((String) -> Void)?

    var body: some View {
        FlowRow {
            ForEach(tags, id: \.self) { tag in
                Chip(
                    text: tag,
                    isSelected: isSelected(tag),
                    isStarred: isStarred?(tag) ?? false,
                    action: { onTap(tag) },
                    starAction: onStar.map { star in { star(tag) } }
                )
            }
        }
    }
}

private struct Chip: View {
    let text: String
    let isSelected: Bool
    var isStarred = false
    let action: () -> Void
    var starAction: (() -> Void)?

    var body: some View {
        HStack(spacing: 5) {
            Button(action: action) {
                Text(text)
                    .textStyle(.caption.weight(TextStyle.medium))
                    .foregroundStyle(isSelected ? Token.accentForeground : Token.muted)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if let starAction {
                Button(action: starAction) {
                    Image(systemName: isStarred ? "star.fill" : "star")
                        .textStyle(.label.weight(TextStyle.regular))
                        .foregroundStyle(
                            isStarred
                                ? Token.money
                                : (isSelected ? Token.accentForeground.opacity(0.6) : Token.muted)
                        )
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 11)
        .padding(.vertical, 6)
        .background(isSelected ? Token.accent : Color.white.opacity(0.08))
        .clipShape(Capsule())
    }
}

/// Chips that wrap. `LazyVGrid` cannot do it — its columns are fixed, and a chip's width is its
/// text — so this is the one layout worth hand-writing.
private struct FlowRow: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        let rows = self.rows(subviews, within: width)
        let height = rows.reduce(0) { $0 + $1.height + spacing } - spacing
        return CGSize(width: width == .infinity ? rows.map(\.width).max() ?? 0 : width,
                      height: max(0, height))
    }

    func placeSubviews(
        in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
    ) {
        var y = bounds.minY
        for row in rows(subviews, within: bounds.width) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: .unspecified)
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func rows(_ subviews: Subviews, within width: CGFloat) -> [Row] {
        var rows = [Row()]
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let needed = rows[rows.count - 1].width
                + (rows[rows.count - 1].indices.isEmpty ? 0 : spacing) + size.width
            if needed > width, !rows[rows.count - 1].indices.isEmpty {
                rows.append(Row())
            }
            let isFirst = rows[rows.count - 1].indices.isEmpty
            rows[rows.count - 1].indices.append(index)
            rows[rows.count - 1].width += (isFirst ? 0 : spacing) + size.width
            rows[rows.count - 1].height = max(rows[rows.count - 1].height, size.height)
        }
        return rows
    }
}

private struct PlainField: View {
    let placeholder: String
    @Binding var text: String

    var body: some View {
        TextField(placeholder, text: $text)
            .textFieldStyle(.plain)
            .textStyle(.body)
            .foregroundStyle(Token.foreground)
            .padding(.horizontal, Token.gapRows)
            .padding(.vertical, 9)
            .background(Color.black.opacity(0.22))
            .clipShape(RoundedRectangle(cornerRadius: Token.radiusSmall, style: .continuous))
    }
}

/// A row whose empty state is `nil` rather than `""`, because the wire distinguishes them: an
/// all-empty `logistics` is collapsed to null server-side and a field left blank must not arrive
/// as a stated empty string.
private struct OptionalField: View {
    let label: String
    let placeholder: String
    @Binding var value: String?

    var body: some View {
        HStack {
            Text(label)
                .textStyle(.detail)
                .foregroundStyle(Token.muted)
            Spacer(minLength: 8)
            TextField(
                placeholder,
                text: Binding(
                    get: { value ?? "" },
                    set: { value = $0.isEmpty ? nil : $0 }
                )
            )
            .textFieldStyle(.plain)
            .multilineTextAlignment(.trailing)
            .textStyle(.detail)
            .foregroundStyle(Token.foreground)
        }
        .padding(.horizontal, Token.gapRows)
        .padding(.vertical, 10)
    }
}

private struct SummaryRow: View {
    let label: String
    let value: String
    let onEdit: () -> Void

    var body: some View {
        Button(action: onEdit) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(label)
                    .textStyle(.caption)
                    .foregroundStyle(Token.muted)
                    .frame(width: 56, alignment: .leading)
                Text(value.isEmpty ? "—" : value)
                    .textStyle(.detail)
                    .foregroundStyle(Token.foreground)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "pencil")
                    .textStyle(.micro)
                    .foregroundStyle(Token.muted)
            }
            .padding(.horizontal, Token.gapRows)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// A hard validation error, in red. Distinct from `Notice`, which is the soft one — the web
/// reserves this treatment for something the traveler has to fix.
struct Alert: View {
    let text: String

    var body: some View {
        Text(text)
            .textStyle(.detail)
            .foregroundStyle(Token.alert)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Token.gapRows)
            .background(Token.alertSoft)
            .clipShape(RoundedRectangle(cornerRadius: Token.radiusSmall, style: .continuous))
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .textStyle(.body.weight(TextStyle.semibold))
            .foregroundStyle(Token.accentForeground)
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            .background(Token.accent.opacity(isEnabled ? 1 : 0.35))
            .clipShape(Capsule())
            .opacity(configuration.isPressed ? 0.85 : 1)
    }
}

struct GhostButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .textStyle(.body.weight(TextStyle.medium))
            .foregroundStyle(Token.muted.opacity(isEnabled ? 1 : 0.4))
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(Color.white.opacity(configuration.isPressed ? 0.12 : 0.06))
            .clipShape(Capsule())
    }
}
