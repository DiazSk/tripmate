import SwiftUI
import TripMateKit

/// One trip, read against the map, composed as a catalogue of the day.
///
/// **The day is an ordered, numbered, priced list of places, which is what a catalogue is.**
/// That is the whole structure: a masthead naming the date over a photograph of where you are,
/// one figure for what the day costs, then the stops as numbered entries under ruled section
/// headings. The number on an entry is *the same number the map draws on the ground* — so the
/// sheet and the world underneath it name a stop the same way, and pointing at either lights
/// both.
///
/// **What this replaced, and why.** The previous pass set the clock at 24pt in a 76pt gutter
/// against 9pt captions, on the Flighty argument that a screen reads as designed when the
/// numbers that matter dwarf everything else. The ratio was right and the subject was wrong:
/// what a reader needs from a day is its *order*, which the map had already started drawing as
/// numbered bubbles, and the gutter spent a fifth of a 402pt screen restating a fact the
/// particulars line can hold. Four figures then shouted at equal weight across the top —
/// `$665 TODAY`, `$2,640 OF $2,600`, `6 STOPS`, `Sep 12 DATE` — with the date set in the figure
/// face, which is a stamp and not a column, and a budget track that went full-width coral for a
/// 1.5% overrun.
///
/// Read-only by design at this stage. The web card also carries day retitling, the staggered
/// generation reveal and unseen-change dots — all of which belong to the edit and generation
/// flows. Building their affordances before the flows exist would be chrome that does nothing.
struct TripDetailView: View {
    @Environment(Chrome.self) private var chrome
    let trip: Trip
    let activeDay: Int
    /// Which stop is being pointed at, as a raw index into `DayPlan.stops`.
    let emphasis: Int?
    let onSelectDay: (Int) -> Void
    let onEmphasise: (Int) -> Void
    let onBack: () -> Void
    /// `(dayIndex, stopIndex or nil for lodging, amount or nil to clear)`
    let onActualCost: (Int, Int?, Double?) async -> Void
    /// Promote this draft to a kept trip.
    let onKeep: () -> Void
    /// `(place, day, slot)` — put a found place into the plan.
    let onAddPlace: @MainActor (SearchResult, Int, TimeOfDay) async -> Void

    @Environment(MapSearchStore.self) private var search

    @Environment(\.panelMetrics) private var metrics
    /// The page the horizontal scroller is on. Mirrors `activeDay` in both directions: the
    /// scroller writes it as you swipe, the stepper and the menu write it to move the scroller.
    @State private var paged: Int?
    @State private var isChatting = false

    private var days: [DayPlan] { trip.itinerary.days }
    private var isCapsule: Bool { metrics.detent == .small }

    var body: some View {
        VStack(spacing: 0) {
            TripHeaderRow(
                trip: trip,
                activeDay: activeDay,
                dayCount: days.count,
                onBack: onBack,
                onSelectDay: onSelectDay,
                // From the header the day is whichever one you are on, same as the row at its
                // foot — the sheet is one surface reached two ways, not two behaviours.
                onSearch: { search.open(fromDay: activeDay) },
                onChat: { isChatting = true }
            )
            if isCapsule {
                capsuleFacts
            } else {
                pager
            }
        }
        .onChange(of: paged) { _, page in
            if let page, page != activeDay { onSelectDay(page) }
        }
        .onChange(of: activeDay) { _, day in
            if paged != day { withAnimation(.easeOut(duration: 0.28)) { paged = day } }
        }
        .onAppear { paged = activeDay }
        // **One sheet, two ways in.** The day's own "Add a stop" opens it on the list; tapping a
        // café Apple drew on the basemap opens it already pushed to that café's card, by way of
        // `MapSearchStore.adding`. A second presentation for the second entry would be a second
        // thing to keep in step.
        .sheet(isPresented: Binding(
            get: { search.isAdding }, set: { search.isAdding = $0 }
        )) {
            AddStopSheet(trip: trip, fromDay: search.fromDay, onAdd: onAddPlace)
                .presentationDetents([.large])
        }
        .sheet(isPresented: $isChatting) {
            ChatSheet().presentationDetents([.large])
        }
    }

    /// What the sheet says when it is shut.
    ///
    /// **This is the state the app is in whenever somebody is looking at the map**, and it used
    /// to draw one 13pt line — `Day 2 · Sep 13 · 6 stops` — in 108pt of glass, two of whose
    /// three facts the header row directly above already carried. Now it carries the
    /// destination as a photograph, the day as a dateline, what the day costs, and **a disc per
    /// stop**, so the day can be walked over a full map without opening anything.
    ///
    /// **The discs are the same `NumberDisc` the rows and the map draw**, which is the whole
    /// point: tapping one lights the pin on the ground, names it here, and flies the camera to
    /// it. Three places, one number, one colour.
    @ViewBuilder private var capsuleFacts: some View {
        if days.indices.contains(activeDay) {
            let day = days[activeDay]
            let stop = emphasis.flatMap { day.stops.indices.contains($0) ? day.stops[$0] : nil }
            HStack(spacing: 12) {
                // `large: false` (the default) — that flag only picks `thumbnailUrl` over
                // `imageUrl`, both arrive in the same response, and painting a full-size
                // Wikipedia image into 52pt would evict useful entries from the shared cache.
                // A definite frame because `PlacePhotoView` has no intrinsic size by design.
                PlacePhotoView(name: trip.destination)
                    .frame(width: 52, height: 52)
                    .clipShape(RoundedRectangle(cornerRadius: Token.radiusSmall, style: .continuous))

                VStack(alignment: .leading, spacing: 5) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(stop?.name ?? DayDisplay.formatDateline(day.date))
                            .textStyle(.headingSmall)
                            .foregroundStyle(Token.foreground)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        // The day's money when nothing is pointed at; that stop's hour when
                        // something is. Both are the fact the line beside them does not carry.
                        Text(stop?.time ?? Spend.byCategory(day).total.formatted(
                            .currency(code: "USD").precision(.fractionLength(0))
                        ))
                            .textStyle(.money.size(13).weight(TextStyle.medium))
                            .foregroundStyle(stop == nil ? Token.money : Token.muted)
                            .lineLimit(1)
                    }
                    discs(of: day)
                }
            }
            .padding(.top, 12)
        }
    }

    /// The day's stops, tappable, at the size a row of them fits.
    ///
    /// Scrolls rather than shrinks: a nine-stop day should look like nine stops, not like six
    /// stops drawn smaller. **The hit area is 34x44** — under the 44pt floor across, which is
    /// the trade a numeric picker row makes, and every stop stays reachable at full size both
    /// in the expanded list and on the map.
    private func discs(of day: DayPlan) -> some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(day.stops.indices, id: \.self) { index in
                    Button {
                        onEmphasise(index)
                    } label: {
                        NumberDisc(number: index + 1, day: activeDay, isEmphasised: index == emphasis)
                            .frame(width: 26, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Stop \(index + 1), \(day.stops[index].name)")
                }
            }
        }
        .scrollIndicators(.hidden)
        .frame(height: 26)
    }

    /// **Swipe between days; the strip is gone.** Nine tabs showed about four and a half at
    /// 322pt and cost 40pt at every detent to do it. Paging costs no layout, and the two other
    /// ways to move — the header's chevrons and its menu — work at the capsule too, where a
    /// strip is not even drawn.
    private var pager: some View {
        ScrollView(.horizontal) {
            LazyHStack(spacing: 0) {
                ForEach(days.indices, id: \.self) { index in
                    dayPage(days[index], index: index)
                        .containerRelativeFrame(.horizontal)
                        .id(index)
                }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.paging)
        .scrollPosition(id: $paged)
        .scrollIndicators(.hidden)
    }

    private func dayPage(_ day: DayPlan, index: Int) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                DayMasthead(
                    destination: trip.destination,
                    day: day,
                    index: index,
                    count: days.count
                )
                DayLedger(days: days, index: index, budget: trip.budget)
                    .padding(.top, 14)
                if trip.resolvedStatus == .draft {
                    draftNotice.padding(.top, Token.gapRows)
                }
                if let summary = day.summary {
                    Text(summary)
                        .textStyle(.detail)
                        .foregroundStyle(Token.muted)
                        // **Two lines.** The one paragraph on the screen is the only thing
                        // that can push the first entry below the fold on its own, and at the
                        // medium detent — where the sheet is read most — it did.
                        .lineLimit(2)
                        .padding(.top, 12)
                }
                stops(of: day, index: index)
                addStop(to: index)
                if let lodging = day.lodging {
                    SectionRule(label: "STAY", tint: Token.muted)
                        .padding(.top, 14)
                    LodgingRow(
                        lodging: lodging,
                        onActualCost: { await onActualCost(index, nil, $0) }
                    )
                }
                moneyBlock(day, index: index)
            }
            .padding(.bottom, Token.gapRows)
        }
        .scrollIndicators(.hidden)
        .shrinksTabBar(chrome)
    }

    @ViewBuilder
    private func stops(of day: DayPlan, index dayIndex: Int) -> some View {
        // Chunked into morning / afternoon / evening. `DaySchedule.group` keeps the authored
        // order and never sorts — a plan that puts a 9am stop after a 3pm one is labelled
        // `Afternoon → Morning` rather than quietly rearranged.
        let groups = DaySchedule.group(day.stops)
        let overlaps = Overlap.findings(in: day)
        ForEach(groups) { group in
            // **One group draws no heading.** A single "Morning" over the whole day is a rule
            // with nothing to separate, and an unlabelled group means no stop carried a
            // readable time — where a heading would be inventing a fact.
            if groups.count > 1, let label = group.label {
                SectionRule(
                    label: label.rawValue.uppercased(),
                    // **The day's own hue, as text.** `DESIGN.md` forbids map colours *filling*
                    // chrome; this is ink, and it is doing the job a legend does — the rule
                    // above these entries is the colour of the line drawn through them.
                    tint: Token.dayGlow(dayIndex),
                    trailing: DaySchedule.span(group.stops.map(\.stop))
                )
                .padding(.top, 14)
            }
            // **Hairlines, not cards.** Five bordered slabs in a column is what made this read
            // as a form; a rule between entries is what makes a list read as a list. Spacing
            // goes to zero because the separator is now the thing doing the separating.
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(group.stops.enumerated()), id: \.element.index) { position, entry in
                    StopRow(
                        stop: entry.stop,
                        // The raw index, so the disc prints the number the map prints.
                        number: entry.index + 1,
                        day: dayIndex,
                        isEmphasised: entry.index == emphasis,
                        clash: overlaps.first { $0.stopIndex == entry.index },
                        isFirst: position == 0,
                        onTap: { onEmphasise(entry.index) },
                        onActualCost: { await onActualCost(dayIndex, entry.index, $0) }
                    )
                }
            }
        }
    }

    /// **The only entry point, and the header deliberately has none.**
    ///
    /// The plan wanted a search field in the trip header too. That header is 322pt wide and an
    /// earlier phase spent its whole argument getting the day above the fold; a general search
    /// box there costs permanent room to ask a question this row asks in context. Here the day
    /// is already chosen, which is one decision fewer.
    ///
    /// **It sits in the entry column**, under the last number, with a dashed disc where a solid
    /// one would be: the next lot, not yet catalogued. The grey 44pt slab it replaces was the
    /// only filled rectangle in a list made entirely of rules.
    private func addStop(to index: Int) -> some View {
        Button { search.open(fromDay: index) } label: {
            HStack(spacing: 13) {
                Circle()
                    .strokeBorder(Token.accent.opacity(0.55), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    .frame(width: NumberDisc.diameter, height: NumberDisc.diameter)
                    .overlay {
                        Image(systemName: "plus")
                            .textStyle(.caption.weight(TextStyle.semibold))
                            .foregroundStyle(Token.accent)
                    }
                Text("Add a stop")
                    .textStyle(.detail.weight(TextStyle.medium))
                    .foregroundStyle(Token.accent)
                Spacer(minLength: 0)
            }
            .frame(height: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Add a stop to day \(index + 1)")
    }

    /// Every figure in one place, at the foot of the day.
    ///
    /// The ledger at the top answers "how am I doing"; this answers "on what". A readout, not
    /// navigation, so it sits where you arrive after reading the day rather than in front of it.
    private func moneyBlock(_ day: DayPlan, index: Int) -> some View {
        VStack(alignment: .leading, spacing: Token.gapRows) {
            SpendComposition(day: day, dayNumber: index + 1)
            if let tier = trip.itinerary.tier.map(Tiers.tier) {
                // A tier is a spending style, so it explains the budget rather than the title.
                Text("\(tier.name) · \(tier.description)")
                    .textStyle(.caption)
                    .foregroundStyle(Token.muted)
            }
        }
        .padding(.top, 18)
    }

    /// **A button, not a notice.** `updateTrip(status:)` has existed since B2 and nothing has
    /// ever called it, so a plan generated on this phone could not be kept — and unkept drafts
    /// are swept. Saying so without offering the fix would be describing the bug.
    ///
    /// **A ruled block, not a gold slab.** Gold counts; it is not a background. The one thing
    /// on this screen that is genuinely an action keeps the action colour and nothing else does.
    private var draftNotice: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(TripCopy.draftNotice)
                .textStyle(.detail)
                .foregroundStyle(Token.muted)
            Button("Keep this trip", action: onKeep)
                .buttonStyle(PrimaryButtonStyle())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, Token.gapRows)
        .overlay(alignment: .top) { Rectangle().fill(Token.cardBorder).frame(height: 1) }
        .overlay(alignment: .bottom) { Rectangle().fill(Token.cardBorder).frame(height: 1) }
    }
}

/// The trip, the day, and the two ways to change it — one row, used at every detent.
///
/// **One view rather than a capsule and a header**, because the day control is the same control
/// in both and two copies would drift. At the capsule it sits over a live map with the day's
/// facts beneath it; expanded it pins above the pager.
private struct TripHeaderRow: View {
    let trip: Trip
    let activeDay: Int
    let dayCount: Int
    let onBack: () -> Void
    let onSelectDay: (Int) -> Void
    let onSearch: () -> Void
    let onChat: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Button(action: onBack) {
                Image(systemName: "chevron.left")
                    .textStyle(.heading)
                    .foregroundStyle(Token.muted)
                    .frame(width: 32, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Memories")

            // **A navigation title, not the page's voice.** The masthead below sets the date in
            // the display serif and is what the day is *called*; two titles at heading weight,
            // 40pt apart, read as a stutter. This is where you are, quietly.
            Text(trip.destination)
                .textStyle(.headingSmall)
                .foregroundStyle(Token.muted)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)

            if dayCount > 1 { dayControl }

            // **A toolbar button, so it sits at the toolbar's edge.** This row is the sheet's
            // navigation bar, and Apple's own guidance lists exactly three entry points for
            // search — a tab, a toolbar at the top or bottom, or inline with content. A
            // toolbar is one of them; *mid-row, between the title and another control* is not
            // any of them, and it read as an orphan.
            //
            // Not a tab: search here is scoped to one trip and one day, and a tab that only
            // works inside a trip breaks the rule that the bar is identical on every route.
            // Not the bottom toolbar Apple prefers — that is the tab bar, same reason. The
            // trailing edge of this row is what is left, and it is sanctioned.
            Button(action: onSearch) {
                Image(systemName: "magnifyingglass")
                    .textStyle(.heading)
                    .foregroundStyle(Token.muted)
                    .frame(width: 32, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Add a stop")

            // Beside search for the reason search is here: the trailing edge of this row is the
            // toolbar, and both are trip-scoped actions on the plan below them.
            Button(action: onChat) {
                Image(systemName: "bubble.left.and.text.bubble.right")
                    .textStyle(.heading)
                    .foregroundStyle(Token.muted)
                    .frame(width: 32, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Ask for a change")
        }
        .frame(height: 56)
        // **A scroll edge.** The pager runs under this row and was clipping a stop's name
        // in half against nothing — a bar with no boundary reads as a rendering fault rather
        // than as a bar. One hairline is what the platform's own inline title uses.
        .overlay(alignment: .bottom) { Rectangle().fill(Token.cardBorder).frame(height: 1) }
    }

    /// Chevrons for the next day, a menu for any day. The strip could do neither at nine days.
    private var dayControl: some View {
        HStack(spacing: 2) {
            step(-1, symbol: "chevron.left", label: "Previous day")
            Menu {
                ForEach(0..<dayCount, id: \.self) { index in
                    Button {
                        onSelectDay(index)
                    } label: {
                        if index == activeDay {
                            Label(TripCopy.dayPosition(index, of: dayCount), systemImage: "checkmark")
                        } else {
                            Text("Day \(index + 1)")
                        }
                    }
                }
            } label: {
                // **The figure alone.** `Day 1/9` at 0.18em tracking spaced nine characters
                // across a pill on a 402pt row, and the word restated the `DAY 1 OF 9` the
                // masthead prints in full a line below. This is a control's current value;
                // the masthead is the readable fact.
                Text("\(activeDay + 1)/\(dayCount)")
                    .textStyle(.money.size(12).weight(TextStyle.semibold))
                    .foregroundStyle(Token.foreground)
                    .padding(.horizontal, 10)
                    .frame(height: 30)
                    .background(Color.white.opacity(0.10))
                    .clipShape(Capsule())
            }
            .accessibilityLabel("Choose a day")
            .accessibilityValue(TripCopy.dayPosition(activeDay, of: dayCount))
            step(1, symbol: "chevron.right", label: "Next day")
        }
    }

    private func step(_ delta: Int, symbol: String, label: String) -> some View {
        let target = activeDay + delta
        let enabled = (0..<dayCount).contains(target)
        return Button { onSelectDay(target) } label: {
            Image(systemName: symbol)
                .textStyle(.caption.weight(TextStyle.semibold))
                .foregroundStyle(enabled ? Token.muted : Token.muted.opacity(0.3))
                .frame(width: 30, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityLabel(label)
    }
}

/// The day's plate: where you are, what day it is, and what the sky is doing.
///
/// **A photograph of the destination, not of the stop.** `PlacePhotoStore`'s own record —
/// quoted in `StopAnnotation` — is "2 of 8 stop names and 0 of 4 museums resolving", so a
/// picture beside every entry would be a column of empty squares. A destination resolves; the
/// memories wall has been proving it since `MemoryTile` shipped. One photograph that is
/// reliably there beats six that are reliably not.
///
/// **The date is the serif's moment**, and one of exactly two in this sheet. `DESIGN.md` credits
/// the display face with the difference between "considered" and "well-made SaaS", and until
/// this pass the app's core screen used it zero times.
///
/// The `DAY n OF m` line above it is not a kicker: it is the one fact the dateline cannot carry,
/// which is where you are in the trip.
private struct DayMasthead: View {
    let destination: String
    let day: DayPlan
    let index: Int
    let count: Int

    var body: some View {
        let read = DayDisplay.read(day)
        ZStack(alignment: .bottomLeading) {
            // `DESIGN.md`'s Photograph-Is-Not-A-Surface rule, measured: destination photography
            // runs 0.040–0.348 mean luminance and Kyoto peaks at 0.947. Large type is safe on
            // the photograph under a scrim; nothing small goes here that is not tracked caps.
            PlacePhotoView(name: destination, large: true, scrim: 0.58)
                .frame(height: 108)
                .frame(maxWidth: .infinity)

            VStack(alignment: .leading, spacing: 6) {
                Text(TripCopy.dayPosition(index, of: count).uppercased())
                    .textStyle(.label)
                    .foregroundStyle(Token.foreground.opacity(0.72))
                Text(DayDisplay.formatDateline(day.date))
                    .textStyle(.display)
                    .foregroundStyle(Token.foreground)
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
                // The traveller's own name for the day, when there is one. Beneath the date
                // rather than instead of it: a title is editorial, a date is the fact.
                if let title = day.title {
                    Text(title)
                        .textStyle(.caption)
                        .foregroundStyle(Token.foreground.opacity(0.8))
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 14)
        }
        .overlay(alignment: .topTrailing) {
            if !read.isEmpty {
                WeatherBadge(read: read).padding(14)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: Token.radiusSmall, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// A ruled section opener: a tracked label on the leading edge, a hairline to the far side, and
/// an optional figure at the end of it.
///
/// **It labels what is beneath it, not beside it** — so it reads as a heading rather than as a
/// caption on the next row. Generalised from the time-of-day rule because the day now opens
/// three sections the same way (the parts of the day, `STAY`, and the spend), and three
/// near-identical private views is how a surface stops being one surface.
private struct SectionRule: View {
    let label: String
    var tint: Color = Token.muted
    /// A hair of extra fact at the far end — the hours a group spans, the day's total, and
    /// nothing longer.
    var trailing: String?
    var trailingTint: Color = Token.muted.opacity(0.7)

    var body: some View {
        HStack(spacing: 10) {
            Text(label)
                .textStyle(.label)
                .foregroundStyle(tint)
            Rectangle()
                .fill(Token.cardBorder)
                .frame(height: 1)
            if let trailing {
                Text(trailing)
                    .textStyle(.money.size(10))
                    .foregroundStyle(trailingTint)
            }
        }
        // One element, and a header to VoiceOver: "the next three stops are the afternoon" is
        // the structure a screen reader should get, not a stray word between two rows.
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// An amount set as the subject of the sentence rather than as its metadata.
///
/// `DESIGN.md`'s `.price-display`: the serif, proportional figures, and the currency mark
/// subordinated to `0.42em` at 60% and raised, so what gets read is the number. This is the
/// second of the sheet's two serif moments and there is not a third.
private struct PriceDisplay: View {
    let amount: Double
    let tint: Color

    var body: some View {
        let size = TextStyle.price.size
        HStack(alignment: .firstTextBaseline, spacing: 1) {
            Text("$")
                .textStyle(.price.size(size * 0.42))
                .baselineOffset(size * 0.3)
                .foregroundStyle(tint.opacity(0.6))
            Text(amount, format: .number.precision(.fractionLength(0)))
                .textStyle(.price)
                .foregroundStyle(tint)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.6)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(amount.formatted(.currency(code: "USD").precision(.fractionLength(0))))
    }
}

/// The numbered bubble the map draws, as a view.
///
/// **The geometry and the palette are transcribed from `StopAnnotation`, not re-picked.** Its
/// disc is 26pt with an 11pt ordinal, filled from `RouteGeometry.palette(forDay:).core` — the
/// *core*, never the softer `glow`, which cannot hold near-black ink — and it turns
/// `RouteGeometry.accent` for the stop being pointed at. If those two ever disagree the number
/// stops being the same number, which is the only thing this element is for.
struct NumberDisc: View {
    static let diameter: CGFloat = 26

    let number: Int
    let day: Int
    let isEmphasised: Bool
    /// The capsule draws the same disc; one view rather than two that can drift apart.
    var diameter: CGFloat = NumberDisc.diameter

    var body: some View {
        Circle()
            .fill(isEmphasised ? Token.accent : Token.dayCore(day))
            .frame(width: diameter, height: diameter)
            .overlay {
                Text("\(number)")
                    .textStyle(.money.size(11 * diameter / Self.diameter).weight(TextStyle.semibold))
                    .foregroundStyle(isEmphasised ? Token.accentForeground : Token.discInk)
            }
            .overlay {
                Circle().strokeBorder(
                    isEmphasised ? Token.accent.opacity(0.8) : Color.white.opacity(0.3),
                    lineWidth: 1
                )
            }
            // The map already says "stop 3"; a second reading of the same number between the
            // heading and the name is noise in a screen reader.
            .accessibilityHidden(true)
    }
}

/// What a stop or the lodging actually cost, typed in place.
///
/// **The itinerary is the source of truth and this holds no draft.** It mirrors the web's
/// uncontrolled field: seeded from `actualCost`, committed on the way out, and an emptied field
/// clears back to the estimate rather than writing zero. Keeping a separate `@State` draft would
/// be a second copy of a number three other views already read.
///
/// **Committing happens on blur and on submit, and both matter.** The web's comment says it
/// plainly — "a value typed and left uncommitted is a value silently lost" — and on a phone
/// there is no click-elsewhere, so the keyboard's return key has to work.
private struct ActualCostField: View {
    /// What the server currently has. Also the placeholder, so the estimate is visible until
    /// something replaces it.
    let estimate: Double
    let actual: Double?
    let accessibilityName: String
    let commit: (Double?) async -> Void

    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("ACTUAL")
                .textStyle(.label)
                .foregroundStyle(Token.muted.opacity(0.55))
            Text("$")
                .textStyle(.money.size(12))
                .foregroundStyle(Token.muted.opacity(0.7))
            TextField(estimate.formatted(.number.precision(.fractionLength(0))), text: $text)
                .textFieldStyle(.plain)
                .textStyle(.money.size(15).weight(TextStyle.medium))
                .foregroundStyle(Token.money)
                .multilineTextAlignment(.trailing)
                .keyboardType(.decimalPad)
                .submitLabel(.done)
                .focused($focused)
                .frame(width: 62)
                // Fires only for a hardware keyboard — see the toolbar below.
                .onSubmit { send() }
                // **A decimal pad has no return key, so there is nothing to submit with.**
                // The web commits on blur and relies on clicking elsewhere; on a phone the
                // keyboard covers half the screen and there is no "elsewhere" to tap. Without
                // this, a typed amount cannot be committed at all — verified on device before
                // it was added.
                .toolbar {
                    if focused {
                        ToolbarItemGroup(placement: .keyboard) {
                            Spacer()
                            Button("Done") { focused = false }
                                .textStyle(.detail.weight(TextStyle.semibold))
                                .foregroundStyle(Token.accent)
                        }
                    }
                }
                .onChange(of: focused) { wasFocused, isFocused in
                    if wasFocused && !isFocused { send() }
                }
        }
        .frame(minHeight: 34)
        // **A rule under the figure, and not under the label.** The black capsule this replaces
        // floated on its own row as a chip with nothing to align to; what says "type here" in a
        // ledger is an underlined blank, and it lets the amount sit directly beneath the
        // estimate it replaces so the two read as one money column.
        .overlay(alignment: .bottomTrailing) {
            Rectangle()
                .fill(Token.money.opacity(0.4))
                .frame(width: 76, height: 1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Actual cost for \(accessibilityName)")
        // The web hid this in a `title` tooltip, which is nowhere at all on a phone.
        .accessibilityHint("Replaces the estimate in this trip's budget total.")
        .task(id: actual) { text = actual.map { $0.formatted(.number.precision(.fractionLength(0))) } ?? "" }
    }

    private func send() {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        // An emptied field clears; anything unparseable is left alone rather than read as zero.
        let amount = trimmed.isEmpty ? nil : Double(trimmed)
        guard trimmed.isEmpty || amount != nil else { return }
        if amount == actual { return }
        Task { await commit(amount) }
    }
}

/// What the day cost, as the shape of the day rather than as a list of its amounts.
///
/// **A list was the wrong form, and it read as exactly what it was.** Label column, figure
/// column, ruled `Total` — that is a restaurant check, and the resemblance was not a styling
/// accident: enumerating amounts is all a list can do. It leaves the division to the reader,
/// when the fact worth having is that half of this day was the bed.
///
/// So the headline is a band sized by share, and the rows are demoted to its key. Proportion is
/// the one thing the list could not show and the one thing this block exists to say.
///
/// **The `Total` row is gone rather than restyled.** It was the most bill-like element on the
/// page *and* a duplicate — `DayLedger` prints the same figure twenty points above at 30pt in
/// the serif. It rides in the section rule now, as a caption on the breakdown rather than as a
/// bottom line, and the band's full width is the total anyway.
///
/// **One colour, at five alphas.** `DESIGN.md` leaves this block exactly one: jade acts, coral
/// warns, and the route hues are map-native and may never fill chrome. That is not a
/// compromise — everything in here is gold because everything in here is money, and the ramp
/// carries rank instead. `Spend.shares` sorts descending so the ramp means something.
private struct SpendComposition: View {
    let day: DayPlan
    let dayNumber: Int

    /// Gold by rank. Five steps because `Spend.tiles` yields at most five categories; the
    /// dimmest still separates from the `white 0.07` track behind it.
    private static let ramp: [Double] = [1.0, 0.76, 0.56, 0.40, 0.28]

    private func tint(_ rank: Int) -> Color {
        Token.money.opacity(Self.ramp[min(rank, Self.ramp.count - 1)])
    }

    var body: some View {
        let spend = Spend.byCategory(day)
        let shares = Spend.shares(spend)
        // A day that cost nothing draws nothing. `DESIGN.md`: don't show a tile, heading or chip
        // for a value that isn't there.
        if !shares.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                SectionRule(
                    label: "DAY \(dayNumber) SPEND",
                    trailing: spend.total.formatted(
                        .currency(code: "USD").precision(.fractionLength(0))
                    ),
                    trailingTint: Token.money
                )

                // **A composition of one has no composition to show.** A single category fills
                // the band edge to edge, which reads as a progress meter — and there is already
                // a real one twenty points above it in `DayLedger`. The row says it alone.
                if shares.count > 1 {
                    band(shares).padding(.top, 14)
                }

                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(shares.enumerated()), id: \.element.id) { rank, share in
                        row(share, rank: rank)
                    }
                }
                .padding(.top, 8)

                if let over = TripCopy.overspend(day) {
                    Text(over)
                        .textStyle(.caption.weight(TextStyle.medium))
                        .foregroundStyle(Token.alert)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, 8)
                }
            }
        }
    }

    /// The day, to scale.
    ///
    /// **A `GeometryReader`, because SwiftUI has no flex weights.** `HStack` distributes slack
    /// equally between flexible children and `layoutPriority` orders who is served first — a
    /// share is neither of those, so the widths are arithmetic on the measured track. The
    /// separators are subtracted before the split, or `n` hairlines push the last segment out.
    ///
    /// The separators are `Token.canvas` — the device the retired `BudgetBarView` used, for the
    /// reason its docstring gave: adjacent spans stay legible where they get narrow.
    private func band(_ shares: [SpendShare]) -> some View {
        GeometryReader { proxy in
            let gaps = CGFloat(shares.count - 1)
            let available = max(0, proxy.size.width - gaps)
            HStack(spacing: 0) {
                ForEach(Array(shares.enumerated()), id: \.element.id) { rank, share in
                    if rank > 0 {
                        Rectangle().fill(Token.canvas).frame(width: 1)
                    }
                    Rectangle()
                        .fill(tint(rank))
                        .frame(width: available * share.drawn)
                }
            }
        }
        .frame(height: 10)
        .background(Color.white.opacity(0.07))
        .clipShape(RoundedRectangle(cornerRadius: 3, style: .continuous))
        // It restates the rows beneath it, and a screen reader should hear the day once.
        .accessibilityHidden(true)
    }

    /// One line of the key: the swatch that ties it to its segment, the name, its share, and
    /// what it cost.
    ///
    /// **Two figures, one alignment edge.** Only the amount is a column; the percentage hangs
    /// off the name and is deliberately ragged, because it annotates the name rather than
    /// forming a third column — and three aligned columns is the bill again.
    private func row(_ share: SpendShare, rank: Int) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 9) {
            // Square, not round: the house rule is round what you touch, square what you read,
            // and a legend swatch is read.
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(tint(rank))
                .frame(width: 8, height: 8)
                // A shape carries no baseline, so it is aligned to the text by hand.
                .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
            Text(share.tile.label)
                .textStyle(.detail)
                .foregroundStyle(Token.foreground)
            // **`caption`, not `label`.** The label step carries 0.18em, which exists to give
            // uppercase micro-labels air — on a two-digit figure it spaces the glyphs out to
            // `6 8 %` and reads as a fault rather than as a style. A percentage is a figure.
            Text("\(share.percent)%")
                .textStyle(.caption)
                .foregroundStyle(Token.muted.opacity(0.55))
            Spacer(minLength: 8)
            Text(share.tile.amount, format: .currency(code: "USD").precision(.fractionLength(0)))
                .textStyle(.money.size(13).weight(TextStyle.medium))
                .foregroundStyle(Token.money)
        }
        .padding(.vertical, 7)
        // One label for the whole row, so VoiceOver says "Stay, 49 percent, 125 dollars" rather
        // than reading a swatch, a word and two numbers as separate elements.
        .accessibilityElement(children: .combine)
    }
}

/// What the sky is doing, in one chip.
///
/// **Everything it knows is printed in it.** On the web the rain chance and the typical-weather
/// caveat lived only in a `title` attribute on a non-focusable span — which is to say nowhere at
/// all for anyone on a phone. There is no hover here to hide them behind.
///
/// **It darkens rather than lightens**, because it now sits on a photograph. `DESIGN.md`'s
/// Darken-Never-Lighten rule: the white-at-0.08 ground it used to carry is invisible over a
/// bright plaza, which is the one condition this badge has to survive.
private struct WeatherBadge: View {
    let read: DayDisplay.WeatherRead

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: read.icon.symbol)
                .textStyle(.caption)
                .foregroundStyle(Token.accent)
            if let temp = read.temp {
                Text(temp)
                    .textStyle(.money.size(11))
                    .foregroundStyle(Token.foreground)
            }
            if let label = read.label {
                Text(label)
                    .textStyle(.caption)
                    .foregroundStyle(Token.foreground.opacity(0.82))
            }
            // Only when a real forecast supplied one — prose never carries a probability.
            if let rain = read.rain, rain > 0 {
                Text("· \(Int(rain))% rain")
                    .textStyle(.caption)
                    .foregroundStyle(Token.foreground.opacity(0.82))
            }
            // Beyond the ~16-day forecast horizon these figures are last year's same dates, and
            // the badge must not imply a forecast it does not have.
            if read.typical {
                Text("· typical")
                    .textStyle(.caption)
                    .foregroundStyle(Token.foreground.opacity(0.82))
            }
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 5)
        .background(Color.black.opacity(0.55))
        .clipShape(Capsule())
        .fixedSize()
    }
}

/// One entry in the day's catalogue.
///
/// **The number is the spine and the clock is a particular**, which is the inversion this pass
/// is. A reader's question at a glance is "what is the shape of this day and where am I in it";
/// the order answers that, and the map has already started drawing it as numbered bubbles. The
/// 24pt clock in its 76pt gutter answered a narrower question at a fifth of the screen's width,
/// and made a column of four stops read as a departure board.
///
/// **Collapsed by default.** Expanded, a row measured ~186pt — name, cost, time, `why`, `note`
/// and a text field — so five stops were 978pt and a day did not fit the sheet at any height.
///
/// **One gesture, two effects.** Tapping expands the entry *and* emphasises the stop on the map,
/// because both mean "this one". No disclosure flag: `TripsStore.emphasise` already toggles and
/// the map already answers to it, so the selection that existed is the disclosure.
///
/// What is hidden is what you read once when deciding (`why`), what you want while standing
/// there (`note`), and a keyboard. What is never hidden: the number, the name, the hour, the
/// cost, and a clash with the stop before it.
private struct StopRow: View {
    let stop: Stop
    /// Its place in the day, one-based — **the number the map prints on the ground.**
    let number: Int
    /// Which day this belongs to, for the hue its disc shares with the route.
    let day: Int
    /// The entry and its point on the map take the accent together, which is the whole reason
    /// the index lives in the store rather than in either view.
    let isEmphasised: Bool
    /// Set when this stop starts before the previous one ends.
    let clash: Overlap.Finding?
    /// The first entry in a group draws no rule above it — the heading already separated it.
    let isFirst: Bool
    let onTap: () -> Void
    let onActualCost: (Double?) async -> Void

    /// `11:00 AM · 1.5 HOURS · FOOD`. The hour leads because it is the thing most often wanted,
    /// and the whole line is one tracked micro-label so none of it competes with the name.
    private var particulars: String {
        [stop.time, stop.durationLabel, stop.category.rawValue]
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .map { $0.uppercased() }
            .joined(separator: " · ")
    }

    var body: some View {
        // **Not a Button wrapping everything.** A `TextField` inside a button is a control
        // inside a control: the button swallows the tap and the field never gains focus.
        content.onTapGesture(perform: onTap)
    }

    private var content: some View {
        HStack(alignment: .top, spacing: 13) {
            NumberDisc(number: number, day: day, isEmphasised: isEmphasised)
                // The disc's own box is 26pt and the name's cap-height sits a hair below the
                // line box's top, so one point down puts the two on the same optical line.
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(stop.name)
                        .textStyle(.heading)
                        .foregroundStyle(Token.foreground)
                    Spacer(minLength: 8)
                    let spent = Spend.of(cost: stop.cost, actual: stop.actualCost)
                    // A column of prices down the trailing edge is the one thing on this row
                    // that genuinely is compared vertically, which is what the figure face is
                    // for and the only reason it survives the pass.
                    Text(spent, format: .currency(code: "USD").precision(.fractionLength(0)))
                        .textStyle(.money.size(15).weight(TextStyle.medium))
                        // A free stop is not a money fact, so it does not get the money colour.
                        .foregroundStyle(spent > 0 ? Token.money : Token.muted.opacity(0.5))
                }
                if !particulars.isEmpty {
                    Text(particulars)
                        .textStyle(.label)
                        .foregroundStyle(Token.muted.opacity(0.75))
                        .lineLimit(2)
                }
                // **A second line, not a replacement.** The clash used to take the particulars'
                // place, so learning that a stop overlapped cost you its hour and its duration —
                // the two facts you need to fix it. It also named the previous stop, which is
                // the row directly above and does not need saying twice.
                if let clash {
                    Text("OVERLAPS BY \(clash.minutes) MIN")
                        .textStyle(.label)
                        .foregroundStyle(Token.alert)
                }

                if isEmphasised {
                    if let why = stop.why {
                        Text(why)
                            .textStyle(.detail)
                            .foregroundStyle(Token.foreground.opacity(0.85))
                            // Without this the line truncates at the stack's width instead of
                            // wrapping — the sibling name-and-price row sets the ideal width
                            // and `Text` takes it as a ceiling.
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 4)
                    }
                    if !stop.note.isEmpty {
                        Text(stop.note)
                            .textStyle(.detail)
                            .foregroundStyle(Token.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    HStack {
                        Spacer(minLength: 0)
                        ActualCostField(
                            estimate: stop.cost,
                            actual: stop.actualCost,
                            accessibilityName: stop.name,
                            commit: onActualCost
                        )
                    }
                    .padding(.top, 2)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 12)
        .padding(.horizontal, 6)
        .background(Token.accent.opacity(isEmphasised ? 0.09 : 0))
        .clipShape(RoundedRectangle(cornerRadius: Token.radiusSmall, style: .continuous))
        // The rule belongs above rather than below, so the last entry in a group does not draw
        // a line into the whitespace under it.
        .overlay(alignment: .top) {
            if !isFirst {
                Rectangle().fill(Token.cardBorder).frame(height: 1).padding(.horizontal, -6)
            }
        }
        .contentShape(Rectangle())
        .animation(.easeOut(duration: 0.2), value: isEmphasised)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Stop \(number), \(stop.name)")
    }
}

/// The day's money in one figure, and how far through the budget that leaves you.
///
/// **This replaced four figures shouting at equal weight.** `$665 TODAY`, `$2,640 OF $2,600`,
/// `6 STOPS`, `Sep 12 DATE` — a strip in which nothing was the answer because everything was the
/// same size, with the date set in the figure face (a stamp, which that face is explicitly not
/// for) and the stop count restating a list two thumbs below it. What is left is the one number
/// somebody opens this sheet to see, in the serif, and the trip's running position beside it at
/// a quarter of the weight.
///
/// **The overrun is drawn to scale, and that is the fix.** The track used to go *entirely* coral
/// the moment `spent > budget`, so $40 over $2,600 — one and a half percent — rendered as total
/// failure. Now the gold runs to the budget line and the overflow is its own coral segment, so a
/// small overrun looks small and a real one looks real.
private struct DayLedger: View {
    let days: [DayPlan]
    let index: Int
    let budget: Double

    private var day: DayPlan? { days.indices.contains(index) ? days[index] : nil }

    var body: some View {
        let today = day.map { Spend.byCategory($0).total } ?? 0
        let spent = Spend.trip(days)
        let over = budget > 0 && spent > budget
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .lastTextBaseline) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("TODAY")
                        .textStyle(.label)
                        .foregroundStyle(Token.muted.opacity(0.7))
                    PriceDisplay(amount: today, tint: Token.money)
                }
                Spacer(minLength: 12)
                // **The text face, not the figure face.** This is a sentence — "two thousand
                // six hundred and forty of two thousand six hundred" — and nothing in it is
                // compared down a column. Set in Tabular it also *looked* wrong: that face
                // gives a comma a full digit's width, so `$2,640` came out gappy.
                HStack(spacing: 0) {
                    Text(spent, format: .currency(code: "USD").precision(.fractionLength(0)))
                        .textStyle(.caption.weight(TextStyle.semibold))
                        .foregroundStyle(over ? Token.alert : Token.foreground)
                    Text(" of ")
                        .textStyle(.caption)
                        .foregroundStyle(Token.muted)
                    Text(budget, format: .currency(code: "USD").precision(.fractionLength(0)))
                        .textStyle(.caption)
                        .foregroundStyle(Token.muted)
                }
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            }
            track(spent: spent, over: over)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "Today \(today.formatted(.currency(code: "USD").precision(.fractionLength(0)))). "
            + "Trip \(spent.formatted(.currency(code: "USD").precision(.fractionLength(0)))) "
            + "of \(budget.formatted(.currency(code: "USD").precision(.fractionLength(0))))"
            + (over ? ", over budget." : ".")
        )
    }

    private func track(spent: Double, over: Bool) -> some View {
        GeometryReader { proxy in
            // The whole width is the budget. Gold fills up to it; anything past it is a coral
            // segment sized by how far past, clamped so a wild overrun cannot eat the bar it is
            // measured against.
            let onPlan = budget > 0 ? min(spent / budget, 1) : 0
            let overflow = budget > 0 && over ? min((spent - budget) / budget, 0.5) : 0
            let total = onPlan + overflow
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.10))
                HStack(spacing: 0) {
                    Rectangle().fill(Token.money)
                        .frame(width: max(2, proxy.size.width * onPlan / max(total, 0.0001)))
                    if overflow > 0 {
                        Rectangle().fill(Token.alert)
                            .frame(width: max(2, proxy.size.width * overflow / max(total, 0.0001)))
                    }
                }
                .clipShape(Capsule())
                // Scaled so the pair together never exceeds the track: the gold still ends at
                // the budget line relative to what is drawn, and the coral is the part beyond.
                .frame(width: proxy.size.width * min(total, 1), alignment: .leading)
            }
        }
        .frame(height: 2)
    }
}

/// Where the night goes — the day's last entry, and now in the day's column.
///
/// **The name used to start 39pt left of every stop name above it.** Every entry on the day
/// opens with a 26pt disc; this one opened with nothing, so it broke the one column the whole
/// list is built on. That misalignment is what read as unfinished, not the styling.
///
/// **The mark is outlined rather than filled with the day's hue.** A filled disc means "this is
/// stop N on the route", and lodging is not on it — `Lodging` decodes exactly four fields and
/// carries no coordinate, so it can never become a `StopAnnotation`.
///
/// **Its cost field opens on a tap, like a stop's.** It used to appear whenever *nothing else*
/// was selected, which made it a permanent input with no trigger, floating on its own row with
/// nothing to align to. The disclosure is local state rather than `TripsStore.emphasise`,
/// because that index space is `day.stops` and there is no index in it for a bed.
private struct LodgingRow: View {
    let lodging: Lodging
    let onActualCost: (Double?) async -> Void

    @State private var isOpen = false

    var body: some View {
        HStack(alignment: .top, spacing: 13) {
            Circle()
                .strokeBorder(Token.muted.opacity(0.3), lineWidth: 1)
                .frame(width: NumberDisc.diameter, height: NumberDisc.diameter)
                .overlay {
                    Image(systemName: "bed.double")
                        .textStyle(.caption)
                        .foregroundStyle(Token.muted)
                }
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(lodging.name)
                        .textStyle(.heading)
                        .foregroundStyle(Token.foreground)
                    Spacer(minLength: 8)
                    // The figure that counts is what you paid once you have said so. The
                    // estimate does not vanish — it stays as the field's placeholder.
                    Text(Spend.of(cost: lodging.cost, actual: lodging.actualCost),
                         format: .currency(code: "USD").precision(.fractionLength(0)))
                        .textStyle(.money.size(15).weight(TextStyle.medium))
                        .foregroundStyle(Token.money)
                }
                if !lodging.note.isEmpty {
                    Text(lodging.note)
                        .textStyle(.detail)
                        .foregroundStyle(Token.muted)
                        .lineLimit(isOpen ? nil : 1)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if isOpen {
                    HStack {
                        Spacer(minLength: 0)
                        ActualCostField(
                            estimate: lodging.cost,
                            actual: lodging.actualCost,
                            accessibilityName: lodging.name,
                            commit: onActualCost
                        )
                    }
                    .padding(.top, 2)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
        .onTapGesture { withAnimation(.easeOut(duration: 0.2)) { isOpen.toggle() } }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Stay, \(lodging.name)")
    }
}
