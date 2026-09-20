import SwiftUI
import TripMateKit

/// One trip, read against the map. `ItineraryCard.tsx` is the model.
///
/// Read-only by design at this stage. The web card also carries inline actual-cost entry, day
/// retitling, the staggered generation reveal and unseen-change dots on the tabs — all of which
/// belong to the edit and generation flows. Building their affordances before the flows exist
/// would be chrome that does nothing.
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
                onSearch: { search.open(fromDay: activeDay) }
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
    }

    /// The one line the capsule shows over a live map.
    ///
    /// **It names the stop you tapped.** With nothing emphasised it is the day's facts; point
    /// at a pin and this becomes that stop, so the map can be read without opening the sheet —
    /// which is the whole reason a 152pt stop exists.
    @ViewBuilder private var capsuleFacts: some View {
        if days.indices.contains(activeDay) {
            let day = days[activeDay]
            let stop = emphasis.flatMap { day.stops.indices.contains($0) ? day.stops[$0] : nil }
            Text(stop.map { "\($0.name) · \($0.time)" } ?? TripCopy.dayFacts(day, index: activeDay))
                .textStyle(.detail)
                .foregroundStyle(stop == nil ? Token.muted : Token.foreground)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 8)
        }
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
            VStack(alignment: .leading, spacing: Token.gapRows) {
                // **The trip's budget leads the day.** It moved to the foot in P1b on the
                // argument that a readout is not navigation and 46pt at the top pushed the day
                // below the fold. That argument was measured against a 322pt column with a
                // 288pt header; the header is gone and the sheet is 40pt wider, so the cost it
                // was avoiding no longer exists — and "what have I spent" turned out to be a
                // question asked on arrival rather than after reading the day.
                BudgetBarView(days: days, budget: trip.budget, activeDayIndex: index)
                if trip.resolvedStatus == .draft { draftNotice }
                // **The day's overspend used to sit here, and two coral lines stacked.** The
                // bar above already says the trip is over; a second warning immediately under
                // it read as the same fact stuttering rather than as a different scope. It
                // moved to the spend band, beneath that day's own Total — which is where a
                // day-money fact belongs, and it is one sentence either way.
                dayHeader(day)
                if let summary = day.summary {
                    Text(summary)
                        .textStyle(.detail)
                        .foregroundStyle(Token.muted)
                }
                stops(of: day, index: index)
                if let lodging = day.lodging {
                    LodgingRow(
                        lodging: lodging,
                        isOpen: emphasis == nil,
                        onActualCost: { await onActualCost(index, nil, $0) }
                    )
                }
                addStop(to: index)
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
                TimeOfDayHeading(label: label)
            }
            // The rail runs behind the group rather than being drawn per row: a gap change
            // cannot break a background, and the web records its per-row arithmetic drawing
            // through the next avatar.
            VStack(alignment: .leading, spacing: 6) {
                ForEach(group.stops, id: \.index) { entry in
                    StopRow(
                        stop: entry.stop,
                        isEmphasised: entry.index == emphasis,
                        clash: overlaps.first { $0.stopIndex == entry.index },
                        onTap: { onEmphasise(entry.index) },
                        onActualCost: { await onActualCost(dayIndex, entry.index, $0) }
                    )
                }
            }
        }
    }

    /// **The only entry point, and the header deliberately has none.**
    ///
    /// The plan wanted a search field in the trip header too. That header is 322pt wide and the
    /// previous phase spent its whole argument getting the day above the fold; a general search
    /// box there costs permanent room to ask a question this row asks in context. Here the day
    /// is already chosen, which is one decision fewer — the plan's own reason for wanting this
    /// entry in the first place. The card still carries the day picker, so nothing is lost.
    private func addStop(to index: Int) -> some View {
        Button { search.open(fromDay: index) } label: {
            HStack(spacing: 8) {
                Image(systemName: "plus.circle")
                    .textStyle(.body)
                Text("Add a stop")
                    .textStyle(.detail.weight(TextStyle.medium))
            }
            .foregroundStyle(Token.accent)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .frame(height: 44)
            .background(Color.white.opacity(0.05))
            .clipShape(RoundedRectangle(cornerRadius: Token.radiusSmall, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Add a stop to day \(index + 1)")
    }

    /// Every figure in one place.
    ///
    /// **The budget bar moved down here from the top of the card.** It is a readout, not
    /// navigation, and at the top it pushed the day below the fold while splitting money across
    /// two ends of a scroll. The day-scoped overspend line at the top of the page covers the
    /// "know it now" case, which is the honest day-level version of the fact anyway.
    private func moneyBlock(_ day: DayPlan, index: Int) -> some View {
        VStack(alignment: .leading, spacing: Token.gapRows) {
            SpendBandView(day: day, dayNumber: index + 1)
            if let tier = trip.itinerary.tier.map(Tiers.tier) {
                // A tier is a spending style, so it explains the budget rather than the title.
                Text("\(tier.name) · \(tier.description)")
                    .textStyle(.caption)
                    .foregroundStyle(Token.muted)
            }
        }
        .padding(.top, Token.gapRows)
    }

    /// **A button, not a notice.** `updateTrip(status:)` has existed since B2 and nothing has
    /// ever called it, so a plan generated on this phone could not be kept — and unkept drafts
    /// are swept. Saying so without offering the fix would be describing the bug.
    private var draftNotice: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(TripCopy.draftNotice)
                .textStyle(.detail)
                .foregroundStyle(Token.muted)
            Button("Keep this trip", action: onKeep)
                .buttonStyle(PrimaryButtonStyle())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Token.gapRows)
        .background(Token.moneySoft)
        .clipShape(RoundedRectangle(cornerRadius: Token.radiusMedium, style: .continuous))
    }

    private func dayHeader(_ day: DayPlan) -> some View {
        let read = DayDisplay.read(day)
        // **No `Day N —` prefix.** The header row 44pt above already says `Day 3 of 9`;
        // printing it twice in a 322pt column is the duplication this redesign is about.
        return HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text((day.title.map { "\($0) · " } ?? "") + DayDisplay.formatDate(day.date))
                .textStyle(.headingSmall.weight(TextStyle.semibold))
                .foregroundStyle(Token.foreground)
            Spacer(minLength: 0)
            if !read.isEmpty { WeatherBadge(read: read) }
        }
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

            Text(trip.destination)
                .textStyle(.heading)
                .foregroundStyle(Token.foreground)
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
        }
        .frame(height: 56)
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
                Text("Day \(activeDay + 1)/\(dayCount)")
                    .textStyle(.label)
                    .foregroundStyle(Token.foreground)
                    .padding(.horizontal, 9)
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

/// A rule with the part of the day on it.
///
/// **It labels what is beneath it, not beside it** — so it reads as a heading rather than as a
/// caption on the next row. The label sits on the leading edge over a hairline that runs to the
/// far side, which is the same opener the landing's bands use, one size down.
private struct TimeOfDayHeading: View {
    let label: TimeOfDay

    var body: some View {
        HStack(spacing: 10) {
            Text(label.rawValue.uppercased())
                .textStyle(.label)
                .foregroundStyle(Token.muted)
            Rectangle()
                .fill(Token.cardBorder)
                .frame(height: 1)
        }
        .padding(.top, 6)
        // One element, and a header to VoiceOver: "the next three stops are the afternoon" is
        // the structure a screen reader should get, not a stray word between two rows.
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
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
        HStack(spacing: 6) {
            Text("Actual")
                .textStyle(.micro)
                .foregroundStyle(Token.muted)
            Text("$")
                .textStyle(.money.size(12))
                .foregroundStyle(Token.muted)
            TextField(estimate.formatted(.number.precision(.fractionLength(0))), text: $text)
                .textFieldStyle(.plain)
                .textStyle(.money.size(13))
                .foregroundStyle(Token.money)
                .keyboardType(.decimalPad)
                .submitLabel(.done)
                .focused($focused)
                .frame(maxWidth: 74)
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
        .padding(.horizontal, 9)
        .padding(.vertical, 6)
        .frame(minHeight: 34)
        .background(Color.black.opacity(0.22))
        .clipShape(Capsule())
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

/// What the day cost, split by what it was spent on.
///
/// **The tiles always add up to the Total beneath them**, which is why the empty categories are
/// dropped in `Spend.tiles` rather than here — a day of sightseeing used to print four zeroes
/// beside a total nothing on screen accounted for.
///
/// **Total is not a sixth tile and not a filled slab in the accent colour.** It was `bg-accent`
/// with dark ink on the web: a solid button-coloured bar whose entire content is a number you
/// cannot press. `DESIGN.md` records that going — gold counts, jade acts, and a figure is
/// information rather than an invitation. So it reads as a rule beneath the row: a hairline in
/// the money colour, an opaque ground, and the figure in the figure face.
private struct SpendBandView: View {
    let day: DayPlan
    let dayNumber: Int

    var body: some View {
        let spend = Spend.byCategory(day)
        let tiles = Spend.tiles(spend)
        // A day that cost nothing draws nothing. `DESIGN.md`: don't show a tile, heading or chip
        // for a value that isn't there.
        if spend.total > 0 {
            VStack(alignment: .leading, spacing: 8) {
                Text("Day \(dayNumber) spend")
                    .textStyle(.detail.weight(TextStyle.semibold))
                    .foregroundStyle(Token.foreground)

                // **Two equal columns, because the wrap did the opposite of what it claimed.**
                // The note here said flowing "stretches whatever lands in the last row instead
                // of orphaning it at half width"; it does not — `FlowRow` packs by intrinsic
                // width, so four tiles came out three-and-one with the fourth at a third of the
                // row and a hole beside it. A grid cannot do that: the common four (food,
                // entry, transit, stay) are a clean 2x2, and an odd count orphans at *half*
                // width, which reads as deliberate.
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible())], spacing: 8) {
                    ForEach(tiles) { tile in
                        SpendTileView(tile: tile)
                    }
                }

                total(spend.total)
                if let over = TripCopy.overspend(day) {
                    Text(over)
                        .textStyle(.caption.weight(TextStyle.medium))
                        .foregroundStyle(Token.alert)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(Token.gapRows)
            .background(Token.surfaceDeep.opacity(0.7))
            .clipShape(RoundedRectangle(cornerRadius: Token.radiusMedium, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Token.radiusMedium, style: .continuous)
                    .strokeBorder(Token.cardBorder, lineWidth: 1)
            )
        }
    }

    private func total(_ amount: Double) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text("Total")
                .textStyle(.detail.weight(TextStyle.medium))
                .foregroundStyle(Token.foreground)
            Spacer(minLength: 8)
            Text(amount, format: .currency(code: "USD").precision(.fractionLength(0)))
                .textStyle(.money.weight(TextStyle.semibold))
                .foregroundStyle(Token.money)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color.black.opacity(0.4))
        .clipShape(RoundedRectangle(cornerRadius: Token.radiusMedium, style: .continuous))
        .overlay(alignment: .top) {
            Rectangle()
                .fill(Token.money.opacity(0.25))
                .frame(height: 1)
        }
    }
}

private struct SpendTileView: View {
    let tile: SpendTile

    var body: some View {
        VStack(spacing: 3) {
            Image(systemName: tile.symbol)
                .textStyle(.detail)
                .foregroundStyle(Token.foreground)
            Text(tile.label)
                .textStyle(.caption)
                .foregroundStyle(Token.muted)
            Text(tile.amount, format: .currency(code: "USD").precision(.fractionLength(0)))
                .textStyle(.money.weight(TextStyle.semibold))
                .foregroundStyle(Token.money)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .padding(.horizontal, 8)
        .background(Color.black.opacity(0.25))
        .clipShape(RoundedRectangle(cornerRadius: Token.radiusMedium, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Token.radiusMedium, style: .continuous)
                .strokeBorder(Color.white.opacity(0.20), lineWidth: 1)
        )
        // One label for the whole tile, so VoiceOver says "Food, 40 dollars" rather than
        // reading an icon, a word and a number as three separate elements.
        .accessibilityElement(children: .combine)
    }
}

/// What the sky is doing, in one chip.
///
/// **Everything it knows is printed in it.** On the web the rain chance and the typical-weather
/// caveat lived only in a `title` attribute on a non-focusable span — which is to say nowhere at
/// all for anyone on a phone. There is no hover here to hide them behind.
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
                    .foregroundStyle(Token.muted)
            }
            // Only when a real forecast supplied one — prose never carries a probability.
            if let rain = read.rain, rain > 0 {
                Text("· \(Int(rain))% rain")
                    .textStyle(.caption)
                    .foregroundStyle(Token.muted)
            }
            // Beyond the ~16-day forecast horizon these figures are last year's same dates, and
            // the badge must not imply a forecast it does not have.
            if read.typical {
                Text("· typical")
                    .textStyle(.caption)
                    .foregroundStyle(Token.muted)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Color.white.opacity(0.08))
        .clipShape(Capsule())
        .fixedSize()
    }
}

/// A stop's two lines, in the order `DESIGN.md` specifies: `why` first — why this stop suits
/// *this* traveler — then `note`, the practical detail. `why` is optional because itineraries
/// saved before the field existed do not carry it.
/// One stop: two lines until you point at it.
///
/// **Collapsed by default, and that is the redesign.** Expanded, a row measured ~186pt — name,
/// cost, time, `why`, `note` and a text field — so five stops were 978pt and a day did not fit
/// the sheet at any height. Two lines is ~68pt and the whole day is scannable.
///
/// **One gesture, two effects.** Tapping expands the row *and* emphasises the stop on the map,
/// because both mean "this one". No disclosure flag: `TripsStore.emphasise` already toggles and
/// the map already answers to it, so the selection that existed is the disclosure.
///
/// What is hidden is what you read once when deciding (`why`), what you want while standing
/// there (`note`), and a keyboard (`ActualCostField`). What is never hidden: the name, the
/// time, the cost, and a clash with the stop before it.
private struct StopRow: View {
    let stop: Stop
    /// The row and its point on the map take the accent together, which is the whole reason the
    /// index lives in the store rather than in either view.
    let isEmphasised: Bool
    /// Set when this stop starts before the previous one ends.
    let clash: Overlap.Finding?
    let onTap: () -> Void
    let onActualCost: (Double?) async -> Void

    var body: some View {
        // **Not a Button wrapping everything.** A `TextField` inside a button is a control
        // inside a control: the button swallows the tap and the field never gains focus.
        content.onTapGesture(perform: onTap)
    }

    private var content: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: stop.category.symbol)
                .textStyle(.caption)
                .foregroundStyle(Token.accent)
                .frame(width: 26, height: 26)
                .background(Token.accent.opacity(isEmphasised ? 0.16 : 0.08))
                .clipShape(Circle())

            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline) {
                    Text(stop.name)
                        .textStyle(.headingSmall.weight(TextStyle.medium))
                        .foregroundStyle(Token.foreground)
                    Spacer(minLength: 8)
                    Text(Spend.of(cost: stop.cost, actual: stop.actualCost),
                         format: .currency(code: "USD").precision(.fractionLength(0)))
                        .textStyle(.money)
                        .foregroundStyle(Token.money)
                }
                Text([stop.time, stop.durationLabel].filter { !$0.isEmpty }.joined(separator: " · "))
                    .textStyle(.money.size(12))
                    .foregroundStyle(Token.muted)

                // Shown collapsed as well: a contradiction in the plan is not a detail you
                // should have to open a row to find.
                if let clash {
                    Text("Starts \(clash.minutes) min before \(clash.previous) ends.")
                        .textStyle(.caption)
                        .foregroundStyle(Token.alert)
                        .padding(.top, 2)
                }

                if isEmphasised {
                    if let why = stop.why {
                        Text(why)
                            .textStyle(.detail)
                            .foregroundStyle(.white.opacity(0.85))
                            .padding(.top, 4)
                    }
                    if !stop.note.isEmpty {
                        Text(stop.note)
                            .textStyle(.detail)
                            .foregroundStyle(Token.muted)
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
        .padding(Token.gapRows)
        .background(Color.white.opacity(isEmphasised ? 0.10 : 0.05))
        .clipShape(RoundedRectangle(cornerRadius: Token.radiusMedium, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Token.radiusMedium, style: .continuous)
                .strokeBorder(Token.accent.opacity(isEmphasised ? 0.55 : 0), lineWidth: 1)
        )
        .animation(.easeOut(duration: 0.2), value: isEmphasised)
    }
}

private struct LodgingRow: View {
    let lodging: Lodging
    /// Whether the cost field is showing. Follows the same rule as a stop: a keyboard is a
    /// deliberate thing to open, so it appears when nothing else is being pointed at rather
    /// than sitting under every day.
    let isOpen: Bool
    let onActualCost: (Double?) async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(lodging.name)
                        .textStyle(.body.weight(TextStyle.medium))
                        .foregroundStyle(Token.foreground)
                    Text(lodging.note)
                        .textStyle(.caption)
                        .foregroundStyle(Token.muted)
                }
                Spacer(minLength: 8)
                // The figure that counts is what you paid once you have said so. The estimate
                // does not vanish — it stays as the field's placeholder.
                Text(Spend.of(cost: lodging.cost, actual: lodging.actualCost),
                     format: .currency(code: "USD").precision(.fractionLength(0)))
                    .textStyle(.money)
                    .foregroundStyle(Token.money)
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
            }
        }
        .padding(Token.gapRows)
        .background(Token.moneySoft)
        .clipShape(RoundedRectangle(cornerRadius: Token.radiusMedium, style: .continuous))
    }
}

/// Spent against budget, cut into one span per day.
///
/// Every number comes from `Spend` in TripMateKit — the bar adds no arithmetic of its own, which
/// is the whole reason that module exists. The days are **not** colour-coded: hue encodes
/// categories that have no natural order, days have both an order and a position, and the
/// per-day breakdown elsewhere in this card genuinely *is* categorical, so a multi-coloured bar
/// above it would invite exactly the wrong reading. Separation is one slate at an alpha instead.
struct BudgetBarView: View {
    let days: [DayPlan]
    let budget: Double
    let activeDayIndex: Int?

    private var spent: Double { Spend.trip(days) }
    private var isOver: Bool { budget > 0 && spent > budget }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(spent, format: .currency(code: "USD").precision(.fractionLength(0)))
                    .textStyle(.moneyLarge)
                    .foregroundStyle(isOver ? Token.alert : Token.money)
                Text("of")
                    .textStyle(.caption)
                    .foregroundStyle(Token.muted)
                Text(budget, format: .currency(code: "USD").precision(.fractionLength(0)))
                    .textStyle(.money)
                    .foregroundStyle(Token.muted)
            }

            GeometryReader { proxy in
                HStack(spacing: 0) {
                    ForEach(Spend.budgetSegments(days, budget: budget), id: \.dayIndex) { segment in
                        Rectangle()
                            .fill(fill(for: segment.dayIndex))
                            .frame(width: proxy.size.width * segment.width / 100)
                            // A hairline of the panel's own material, plus an alternating
                            // lightness step so adjacent days stay legible where a 30-day trip
                            // makes the spans narrow.
                            .overlay(alignment: .trailing) {
                                Rectangle()
                                    .fill(Token.canvas.opacity(0.35))
                                    .frame(width: 1)
                            }
                    }
                    Spacer(minLength: 0)
                }
            }
            .frame(height: 8)
            .background(Color.white.opacity(0.08))
            .clipShape(Capsule())

            if isOver {
                Text("Over budget by \((spent - budget), format: .currency(code: "USD").precision(.fractionLength(0)))")
                    .textStyle(.money.size(12))
                    .foregroundStyle(Token.alert)
            }
        }
    }

    private func fill(for dayIndex: Int) -> Color {
        let base = isOver ? Token.alert : Token.money
        // The alternating step, and a lift for the day being read so the bar and the tabs point
        // at the same thing.
        if dayIndex == activeDayIndex { return base }
        return base.opacity(dayIndex.isMultiple(of: 2) ? 0.78 : 0.62)
    }
}
