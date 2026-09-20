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

    /// The natural height of the current step, measured inside the scroller.
    @State private var stepHeight: CGFloat = 0

    var body: some View {
        VStack(alignment: .leading, spacing: Token.gapPanels) {
            header

            if plan.isGenerating {
                // Measured for the same reason the step is: without it the sheet keeps the
                // height of whatever was on screen when Generate was pressed, and holds a
                // full-height panel around one status line for the whole run.
                waiting
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: {
                        stepHeight = $0
                    }
                Spacer(minLength: 0)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: Token.gapPanels) {
                        step
                    }
                    .padding(.bottom, Token.gapRows)
                    // Inside the scroller, so this is the step's *ideal* height — a `ScrollView`
                    // proposes unbounded height to its content. Measured outside it, this would
                    // report the sheet's height back to the sheet and pin it wherever it started.
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: {
                        stepHeight = $0
                    }
                }
                footer
            }
        }
        // **No trailing `Spacer` any more, and its absence is the fix for a real defect.** A
        // `Spacer` and a `ScrollView` are both flexible, so the `VStack` split the height
        // between them: at the tall stop the fields sat in the top third with the footer
        // stranded, and once a keyboard shrank the shell the spacer took what was left and the
        // scroller collapsed to nothing — the form vanished while you were typing into it.
        .sheetFits(stepHeight + Self.chromeHeight)
    }

    /// Header, footer and the gaps around them — everything in the sheet that is not the step.
    /// Measured once from the two blocks' own metrics rather than typed as a number.
    private static let chromeHeight: CGFloat =
        // header: back row, title, position line
        22 + 34 + 16
        // footer: the button row
        + 44
        // grabber strip, the two `gapPanels` in the stack, and the step's bottom inset
        + 44 + Token.gapPanels * 2 + Token.gapRows

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
    /// The run, and the plan appearing inside it.
    ///
    /// **Measured on the web: a 7-day plan took eight minutes here and showed one line for all
    /// of it**, while the browser had day 1 drawn on the map and named in a capsule inside the
    /// first minute. The `stop` frames were arriving the whole time and were being discarded.
    private var waiting: some View {
        VStack(alignment: .leading, spacing: Token.gapRows) {
            HStack(spacing: 10) {
                ProgressView().tint(Token.accent)
                // **`TimelineView`, not a `Timer`.** The word is a function of the clock, so
                // there is no state to own, nothing to cancel when this view goes away, and no
                // second source of truth for "which word is showing".
                TimelineView(.periodic(from: .now, by: Thinking.period)) { tick in
                    Text(Thinking.word(at: tick.date) + "…")
                        .textStyle(.body)
                        .foregroundStyle(Token.foreground)
                }
            }
            // **The line under it still reports what is actually happening.** The rotating word
            // makes no claim; this one does, and a run spends minutes in a single stage, so
            // dropping it would leave four minutes of verbs and no information.
            Text("\(stageText) · \(plan.draft.days) days of \(plan.draft.destination)")
                .textStyle(.detail)
                .foregroundStyle(Token.muted)

            if !plan.streamingDayStops.isEmpty {
                Hairline()
                arriving
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Token.gapRows)
        .background(Color.white.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: Token.radiusMedium, style: .continuous))
    }

    /// The stage, without the ellipsis it carries when it is the headline.
    private var stageText: String {
        let label = plan.stage?.waitingLabel ?? "Starting"
        return label.hasSuffix("…") ? String(label.dropLast()) : label
    }

    /// The day currently being written, stop by stop.
    ///
    /// The *newest* day rather than all of them, matching what the map draws — a list that grows
    /// past the sheet would either scroll on its own inside a scroller or push the stage line
    /// off the top, and the finished plan is the place to read the whole trip.
    private var arriving: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(dayHeading)
                .textStyle(.label)
                .foregroundStyle(Token.muted)

            ForEach(plan.streamingDayStops, id: \.stopIndex) { streamed in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(streamed.stop.time)
                        .textStyle(.money.size(12))
                        .foregroundStyle(Token.muted)
                        // The times are a column, so they are given one — ragged figures down
                        // the left of a list read as a mistake.
                        .frame(width: 62, alignment: .leading)
                    Text(streamed.stop.name)
                        .textStyle(.detail)
                        .foregroundStyle(Token.foreground)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                // Each stop arrives on its own, so each one enters on its own.
                .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.24), value: plan.streamedStops.count)
    }

    private var dayHeading: String {
        guard let first = plan.streamingDayStops.first else { return "" }
        let date = first.date.isEmpty ? "" : " · " + DayDisplay.formatDate(first.date)
        return "DAY \(first.dayIndex + 1)" + date
    }
}

// MARK: - Step 1: where and when

private struct BasicsStep: View {
    let plan: PlanStore
    @FocusState private var focus: Field?
    @State private var suggest = DestinationSuggest()

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
                        // A place name is not a sentence, and the keyboard capitalising the
                        // second word of "Porto, Portugal" is wrong more often than right.
                        .textInputAutocapitalization(.words)
                        .textStyle(.bodyLarge)
                        .foregroundStyle(Token.foreground)
                        .onChange(of: plan.draft.destination) { _, text in
                            guard focus == .destination else { return }
                            suggest.query(text)
                        }
                }
                // Inside the trough and above the next hairline, so the list reads as belonging
                // to the field rather than floating over the form. It is not an overlay: an
                // overlay would cover Arrive, and a suggestion that hides the next question is
                // how you fill one field and lose another.
                if focus == .destination, !suggest.results.isEmpty {
                    suggestions
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
                suggest.clear()
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

    /// Apple's completions, as rows under the field.
    ///
    /// Tapping one only fills the text — the geocode on blur still decides whether the place
    /// exists, so a suggestion the geocoder cannot place lands on the existing soft notice
    /// rather than on a new error path.
    private var suggestions: some View {
        VStack(spacing: 0) {
            ForEach(suggest.results) { result in
                Button {
                    plan.draft.destination = result.line
                    suggest.clear()
                    focus = nil
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "mappin.and.ellipse")
                            .textStyle(.micro)
                            .foregroundStyle(Token.accent)
                        Text(result.line)
                            .textStyle(.detail)
                            .foregroundStyle(Token.foreground)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, Token.gapRows)
                    // The row is the target, not the words in it — and 44 is the floor.
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        // **Darker, not lighter.** `white.opacity(0.04)` was invisible once the wizard gained
        // the blurred poster behind it — and lightening a surface over photography is what
        // Darken-Never-Lighten forbids in the first place. This is the same black the field
        // trough uses, one step deeper so the list reads as a drawer inside it.
        .background(Color.black.opacity(0.34))
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
                    OptionalRow(label: "Arrival time") {
                        TimeField(placeholder: "Set a time", value: bind(\.logistics.arrivalTime))
                    }
                    Hairline()
                    OptionalRow(label: "Arriving at") {
                        SuggestField(
                            placeholder: plan.arrivalPoints.isEmpty
                                ? "Anywhere you like" : "Pick or type a place",
                            value: bind(\.logistics.arrivalPoint),
                            options: plan.arrivalPoints
                        )
                    }
                    Hairline()
                    OptionalRow(label: "Departure time") {
                        TimeField(placeholder: "Set a time", value: bind(\.logistics.departureTime))
                    }
                    Hairline()
                    OptionalRow(label: "Leaving from") {
                        // The same set: the place you fly out of is the place you flew into,
                        // far more often than not.
                        SuggestField(
                            placeholder: plan.arrivalPoints.isEmpty
                                ? "Anywhere you like" : "Pick or type a place",
                            value: bind(\.logistics.departurePoint),
                            options: plan.arrivalPoints
                        )
                    }
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
                nearby

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
                Text(anchorCaption)
                    .textStyle(.caption)
                    .foregroundStyle(Token.muted)
            }

            Toggle("Tell me when it's ready", isOn: notifying)
                .tint(Token.accent)
                .textStyle(.body)
                .foregroundStyle(Token.foreground)
                .frame(minHeight: 44)
        }
        // The warm-up runs when basics is left; this covers the traveller who jumped straight
        // back to review through an Edit link, and is a no-op when it already ran.
        .task { await plan.loadCandidatePois() }
    }

    /// What the destination has to offer, as things to pin.
    ///
    /// **Three outcomes and three sentences.** OpenTripMap unreachable is not "this city has
    /// nothing", and neither is "still asking" — saying the wrong one of those invents a fact
    /// about the destination.
    @ViewBuilder private var nearby: some View {
        if plan.poisLoading {
            Text("Looking for places nearby…")
                .textStyle(.caption)
                .foregroundStyle(Token.muted)
        } else if !plan.candidatePois.isEmpty {
            TagGrid(
                tags: plan.candidatePois.map(\.name),
                isSelected: { name in plan.draft.selectedPois.contains { $0.name == name } },
                onTap: { name in
                    if let index = plan.draft.selectedPois.firstIndex(where: { $0.name == name }) {
                        plan.draft.selectedPois.remove(at: index)
                    } else if let poi = plan.candidatePois.first(where: { $0.name == name }) {
                        plan.draft.selectedPois.append(poi)
                    }
                }
            )
        } else if !plan.poisAvailable {
            Text("We couldn't reach the places list — name your own below.")
                .textStyle(.caption)
                .foregroundStyle(Token.muted)
        }
    }

    private var anchorCaption: String {
        let picked = plan.draft.selectedPois.count + plan.draft.customPois.count
        let tail = "Optional anchors only — the rest is chosen from your answers above."
        return picked == 0 ? tail : "\(picked) picked · \(tail.lowercasedFirst)"
    }

    /// Permission is asked on the way *on* and never on the way off.
    private var notifying: Binding<Bool> {
        Binding(
            get: { plan.draft.notify },
            set: { on in
                plan.draft.notify = on
                if on { Task { await plan.requestNotifyPermission() } }
            }
        )
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
                label: "When",
                // Raw ISO here was the same defect the memories wall had: `2026-09-20 →
                // 2026-09-26` is a database row, not a date somebody reads.
                value: DayDisplay.formatRange(draft.startDate, draft.endDate)
                    + " · \(draft.days) days"
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
struct DateField: View {
    @Binding var value: String
    /// The earliest selectable day, as ISO. Local today for arrival; the arrival date for
    /// departure, so the reversed-range rule is unreachable by picker.
    let earliest: String
    /// The capsule on Home is the one *light* surface in the app, so the label there is near
    /// black. Everywhere else it is the panel's off-white.
    var foreground: Color = Token.foreground

    @State private var isPicking = false

    private var selection: Binding<Date> {
        Binding(get: parsed, set: { value = Self.iso($0) })
    }

    var body: some View {
        Button { isPicking = true } label: {
            Text(parsed(), format: .dateTime.month(.abbreviated).day().year())
                .textStyle(.bodyLarge)
                .foregroundStyle(foreground)
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
            // **The phone is left to adapt, and removing the override is the fix.** Forcing a
            // popover at compact width contradicted the note above it, and the code won: a
            // stated-width picker anchored partway down a 402pt screen ran off the right edge
            // on an iPhone 16 Pro. Adapting gives the phone a sheet it cannot overflow, and
            // the iPad keeps its popover.
            //
            // A half sheet, because a month grid asking for one tap should not take the whole
            // display. Ignored on the popover path, so it costs the iPad nothing.
            .presentationDetents([.medium])
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

struct Question<Content: View>: View {
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
struct ChoiceRow<Option: Hashable & CaseIterable>: View {
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

struct TagGrid: View {
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

    /// **Two targets in one pill, and both are 44pt.** The chip was 28pt tall with a star
    /// roughly 16pt square inside it — two adjacent controls, both under the floor
    /// `DESIGN.md:549` sets, and the smaller of them changes what the whole plan optimises for.
    /// The web gets away with it because a mouse is exact.
    ///
    /// The cost is real and is width: a starrable chip is now its text plus 44pt, so fewer fit
    /// per row and the grid is taller. The sheet sizes to its content, so it simply grows.
    private static let target: CGFloat = 44

    var body: some View {
        HStack(spacing: 0) {
            Button(action: action) {
                Text(text)
                    .textStyle(.caption.weight(TextStyle.medium))
                    .foregroundStyle(isSelected ? Token.accentForeground : Token.muted)
                    .padding(.leading, 14)
                    // The star's own box supplies the trailing inset when there is one.
                    .padding(.trailing, starAction == nil ? 14 : 4)
                    .frame(minHeight: Self.target)
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
                        .frame(width: Self.target, height: Self.target)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .background(isSelected ? Token.accent : Color.white.opacity(0.08))
        .clipShape(Capsule())
    }
}

/// Chips that wrap. `LazyVGrid` cannot do it — its columns are fixed, and a chip's width is its
/// text — so this is the one layout worth hand-writing.
struct FlowRow: Layout {
    var spacing: CGFloat = 8

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

struct PlainField: View {
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
private struct OptionalRow<Control: View>: View {
    let label: String
    @ViewBuilder var control: () -> Control

    var body: some View {
        HStack {
            Text(label)
                .textStyle(.detail)
                .foregroundStyle(Token.muted)
            Spacer(minLength: 8)
            control()
        }
        .padding(.horizontal, Token.gapRows)
        .padding(.vertical, 10)
    }
}

/// An optional "HH:MM" time, as the platform's own wheel.
///
/// **The same popover shape as `DateField`, and for the same reason** — a `.compact` picker
/// draws its own label in the system font and picks its own format. This one is optional, so
/// there is a third state neither picker has: nothing chosen. It shows the placeholder until
/// the traveler picks, and offers Clear once they have.
///
/// The wire format is `"HH:MM"` (`TripLogistics.arrivalTime`), 24-hour and locale-independent,
/// which is what `<input type="time">` gives the web. The *display* is the traveler's own
/// locale, so a US tester sees 2:30 PM while the payload stays `14:30`.
private struct TimeField: View {
    let placeholder: String
    @Binding var value: String?

    @State private var isPicking = false

    var body: some View {
        HStack(spacing: 8) {
            Button { isPicking = true } label: {
                Text(value.flatMap(Self.display) ?? placeholder)
                    .textStyle(.detail)
                    .foregroundStyle(value == nil ? Token.muted : Token.foreground)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if value != nil {
                Button { value = nil } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(Token.muted)
                }
                .buttonStyle(.plain)
            }
        }
        .popover(isPresented: $isPicking) {
            DatePicker(
                "",
                selection: Binding(
                    get: { value.flatMap(Self.date) ?? Self.defaultTime },
                    set: { value = Self.hhmm($0) }
                ),
                displayedComponents: .hourAndMinute
            )
            .labelsHidden()
            .datePickerStyle(.wheel)
            .tint(Token.accent)
            // A wheel needs a stated width for the same reason the month grid did: a popover
            // sizes to its content and the wheel will compress to whatever it is handed.
            .frame(width: 260)
            .padding(Token.gapRows)
            // **The phone is left to adapt, and removing the override is the fix.** Forcing a
            // popover at compact width contradicted the note above it, and the code won: a
            // stated-width picker anchored partway down a 402pt screen ran off the right edge
            // on an iPhone 16 Pro. Adapting gives the phone a sheet it cannot overflow, and
            // the iPad keeps its popover.
            //
            // A half sheet, because a month grid asking for one tap should not take the whole
            // display. Ignored on the popover path, so it costs the iPad nothing.
            .presentationDetents([.medium])
        }
    }

    /// 09:00 rather than "now" — an arrival time nobody has set should not default to the
    /// minute they opened the form, which reads as a value they chose.
    private static var defaultTime: Date {
        Calendar.current.date(from: DateComponents(hour: 9, minute: 0)) ?? Date()
    }

    // The conversion itself lives in `Tiers`, beside `todayISO`, so `swift test` can reach it —
    // a 12/24-hour slip is silent on the wire and only a test catches it.
    private static func date(_ hhmm: String) -> Date? { Tiers.time(fromHHMM: hhmm) }
    private static func hhmm(_ date: Date) -> String { Tiers.hhmm(date) }

    private static func display(_ hhmm: String) -> String? {
        date(hhmm).map { $0.formatted(date: .omitted, time: .shortened) }
    }
}

/// Free text with suggestions — never a closed list.
///
/// **The options are a convenience and the field is the answer.** `TripLogistics` keeps these
/// points free text on purpose: they are a fact for the prompt, not a place to look up, and
/// `/api/arrival-points` degrades to an empty list on an Overpass outage. So with suggestions
/// this is a menu *and* a text field; without them it is just a text field, and nothing about
/// the layout announces that something failed.
private struct SuggestField: View {
    let placeholder: String
    @Binding var value: String?
    let options: [ArrivalPoint]

    var body: some View {
        HStack(spacing: 8) {
            TextField(
                placeholder,
                text: Binding(get: { value ?? "" }, set: { value = $0.isEmpty ? nil : $0 })
            )
            .textFieldStyle(.plain)
            .multilineTextAlignment(.trailing)
            .textStyle(.detail)
            .foregroundStyle(Token.foreground)

            if !options.isEmpty {
                Menu {
                    // Wire order, which is airports by distance and then rail by distance.
                    // **Not** sorted on `tier` — see its note; the field does not mean what the
                    // server's own docstring says it does.
                    ForEach(options) { point in
                        Button {
                            value = point.name
                        } label: {
                            Label(
                                "\(point.name) · \(Int(point.distanceKm.rounded())) km",
                                systemImage: point.kind == .airport ? "airplane" : "tram.fill"
                            )
                        }
                    }
                } label: {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Token.accent)
                        .contentShape(Rectangle())
                }
            }
        }
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


extension String {
    /// "Optional anchors only…" reads as a sentence on its own and as a clause after a count.
    var lowercasedFirst: String {
        guard let first else { return self }
        return first.lowercased() + dropFirst()
    }
}
