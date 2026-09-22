import MapKit
import SwiftUI
import TripMateKit

/// Find a place and put it in a day.
///
/// **This is what search is for, and treating it as pin-dropping is what got the Map tab cut.**
/// A pin is the by-product. The question the traveller is standing in the street asking is "can
/// this go in my plan, and when" — so the flow ends at a day and a part of that day, and the
/// plan's arithmetic (`DayFit`, `DaySlotting`) answers both before being asked.
///
/// One `NavigationStack` with one destination, because there are two ways in and they must not
/// become two sheets: the day's own "Add a stop" opens on the list, and tapping a café Apple drew
/// on the basemap opens already pushed to that café's card.
struct AddStopSheet: View {
    let trip: Trip
    /// The day you were reading when you asked. `nil` from the basemap, where there is no day in
    /// context — then geometry picks, which is what `DayFit` is for.
    let fromDay: Int?
    /// `@MainActor` because `SearchResult` holds an `MKMapItem`, which is a non-Sendable class.
    /// The honest fix rather than stripping the item out: every step of this flow already runs on
    /// the main actor, and saying so is what lets the result be captured across the `await`.
    let onAdd: @MainActor (SearchResult, Int, TimeOfDay) async -> Void

    @Environment(MapSearchStore.self) private var search
    /// Only to ask whether the add actually landed before dismissing on it.
    @Environment(TripsStore.self) private var trips
    @Environment(\.dismiss) private var dismiss

    /// The web's debounce. Long enough that typing a word is one search rather than five.
    private static let debounce = Duration.milliseconds(320)

    var body: some View {
        @Bindable var search = search
        NavigationStack {
            VStack(spacing: Token.gapRows) {
                field
                chips
                results
            }
            .padding(Token.padCompact)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(Token.canvas.ignoresSafeArea())
            .navigationTitle("Add a stop")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .navigationDestination(item: $search.adding) { result in
                PlaceCard(result: result, trip: trip, fromDay: fromDay) { day, slot in
                    await onAdd(result, day, slot)
                    // **A failed add keeps the sheet up with its reason showing rather than
                    // dismissing on a promise it did not keep** — `SaveProfileSheet:68` sets
                    // this rule and this is the second place it applies. It dismissed
                    // unconditionally before, so a rolled-back stop closed the sheet and said
                    // nothing, which is the one outcome `TripsStore.addPlace`'s own docstring
                    // says must not happen.
                    if trips.message == nil { dismiss() }
                }
            }
        }
        // `.task(id:)` is the whole debounce: SwiftUI cancels the previous one on every keystroke,
        // so the sleep only completes for the last character typed. The key is `searchKey` rather
        // than `query`, or pressing a chip would filter the *next* search instead of this one.
        .task(id: search.searchKey) {
            try? await Task.sleep(for: Self.debounce)
            guard !Task.isCancelled else { return }
            await search.search()
        }
    }

    private var field: some View {
        @Bindable var search = search
        return HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .textStyle(.detail.weight(TextStyle.medium))
                .foregroundStyle(Token.muted)
            TextField("Search near this view…", text: $search.query)
                .textFieldStyle(.plain)
                .textStyle(.detail)
                .foregroundStyle(Token.foreground)
                .submitLabel(.search)
                .autocorrectionDisabled()
            if !search.query.isEmpty {
                Button { search.query = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .textStyle(.body)
                        .foregroundStyle(Token.muted)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 40)
        .glassPanel(radius: 20)
    }

    /// **The chip fill stays jade when pressed.** A category could carry its map hue as a swatch,
    /// but `DESIGN.md`'s rule is that map hues never fill chrome — so the glyph and the label
    /// carry the identity and the accent says only "this one is on".
    private var chips: some View {
        @Bindable var search = search
        return ScrollView(.horizontal) {
            HStack(spacing: 6) {
                ForEach(PlaceKind.allCases, id: \.self) { kind in
                    let on = search.kind == kind
                    Button {
                        // Pressing the pressed one clears it, so the chips are a filter rather
                        // than a mode you have to leave by some other route.
                        search.kind = on ? nil : kind
                    } label: {
                        Label(kind.label, systemImage: kind.symbol)
                            .textStyle(.caption.weight(TextStyle.medium))
                            .foregroundStyle(on ? Token.accentForeground : Token.foreground)
                            .padding(.horizontal, 11)
                            .frame(height: 32)
                            .background(on ? Token.accent : Color.white.opacity(0.10))
                            .clipShape(Capsule())
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(on ? [.isSelected, .isButton] : .isButton)
                }
            }
        }
        .scrollIndicators(.hidden)
    }

    @ViewBuilder private var results: some View {
        if let message = search.message, search.results.isEmpty {
            Text(message)
                .textStyle(.detail)
                .foregroundStyle(Token.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        ScrollView {
            VStack(spacing: 4) {
                ForEach(search.results) { result in
                    Button { search.adding = result } label: {
                        HStack(spacing: 10) {
                            Image(systemName: result.kind?.symbol ?? "mappin")
                                .textStyle(.detail)
                                .foregroundStyle(Token.muted)
                                .frame(width: 22)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(result.name)
                                    .textStyle(.detail.weight(TextStyle.medium))
                                    .foregroundStyle(Token.foreground)
                                if !result.subtitle.isEmpty {
                                    Text(result.subtitle)
                                        .textStyle(.micro)
                                        .foregroundStyle(Token.muted)
                                }
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.right")
                                .textStyle(.micro)
                                .foregroundStyle(Token.muted)
                        }
                        .multilineTextAlignment(.leading)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 9)
                        // A `.plain` button hit-tests its label's drawn content, so a short place
                        // name leaves most of the row transparent — measured once at 60pt right
                        // of "Montepulciano", where the tap did nothing at all.
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .background(Color.white.opacity(0.05))
                    .clipShape(RoundedRectangle(cornerRadius: Token.radiusSmall, style: .continuous))
                }
            }
        }
        .scrollIndicators(.hidden)
    }
}

/// One place, and the two decisions that put it in the plan.
private struct PlaceCard: View {
    let result: SearchResult
    let trip: Trip
    let fromDay: Int?
    let onAdd: @MainActor (Int, TimeOfDay) async -> Void

    @State private var day: Int
    @State private var slot: TimeOfDay
    /// Apple's own place sheet, which has the hours and the rating `MKMapItem` does not expose.
    @State private var detail: MKMapItem?
    @State private var saving = false
    /// Only to show why an add did not land.
    @Environment(TripsStore.self) private var trips

    init(result: SearchResult, trip: Trip, fromDay: Int?, onAdd: @escaping @MainActor (Int, TimeOfDay) async -> Void) {
        self.result = result
        self.trip = trip
        self.fromDay = fromDay
        self.onAdd = onAdd
        // **The day you were reading wins over geometry, and that ordering is deliberate.** You
        // tapped "Add a stop" at the foot of Day 3; answering with Day 6 because a centroid is
        // nearer would be the app overruling a choice you just made. Geometry only decides when
        // nobody made one — the basemap entry, where there is no day in context.
        let suggested = DayFit.suggest(
            GeoPoint(lat: result.coordinate.latitude, lng: result.coordinate.longitude),
            days: trip.itinerary.dayShapes
        )?.day
        _day = State(initialValue: fromDay ?? suggested ?? 0)
        _slot = State(initialValue: DaySlotting.suggest(
            name: result.name, category: result.kind?.searchCategory
        ))
    }

    private var days: [DayPlan] { trip.itinerary.days }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Token.gapRows) {
                header
                dayPicker
                slotPicker
                addButton
                // The reason the sheet stayed up, where the action was taken. Without it the
                // card just sits there having apparently done nothing.
                if let message = trips.message {
                    Alert(text: message)
                }
            }
            .padding(Token.padCompact)
        }
        .scrollIndicators(.hidden)
        .background(Token.canvas.ignoresSafeArea())
        .navigationTitle(result.name)
        .navigationBarTitleDisplayMode(.inline)
        // One modifier for Apple's whole place sheet — hours, rating, photos, directions. What we
        // draw above is only what we can state from an `MKMapItem`; everything else defers here
        // rather than being invented or scraped.
        .mapItemDetailSheet(item: $detail)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: result.kind?.symbol ?? "mappin")
                    .textStyle(.detail)
                    .foregroundStyle(Token.muted)
                Text(result.kind?.label ?? "Place")
                    .textStyle(.label)
                    .foregroundStyle(Token.muted)
            }
            if !result.subtitle.isEmpty {
                Text(result.subtitle)
                    .textStyle(.detail)
                    .foregroundStyle(Token.foreground)
            }
            Button { detail = result.item } label: {
                Label("More info", systemImage: "info.circle")
                    .textStyle(.detail.weight(TextStyle.medium))
                    .foregroundStyle(Token.accent)
                    .frame(height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var dayPicker: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Which day")
                .textStyle(.label)
                .foregroundStyle(Token.muted)
            Menu {
                ForEach(days.indices, id: \.self) { index in
                    Button {
                        day = index
                    } label: {
                        let line = "Day \(index + 1) · \(DayDisplay.formatDate(days[index].date))"
                        if index == day {
                            Label(line, systemImage: "checkmark")
                        } else {
                            Text(line)
                        }
                    }
                }
            } label: {
                HStack {
                    Text(days.indices.contains(day)
                         ? "Day \(day + 1) · \(DayDisplay.formatDate(days[day].date))"
                         : "Pick a day")
                        .textStyle(.detail.weight(TextStyle.medium))
                        .foregroundStyle(Token.foreground)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.up.chevron.down")
                        .textStyle(.micro)
                        .foregroundStyle(Token.muted)
                }
                .padding(.horizontal, 12)
                .frame(height: 44)
                .background(Color.white.opacity(0.10))
                .clipShape(RoundedRectangle(cornerRadius: Token.radiusSmall, style: .continuous))
            }
        }
    }

    /// **Each slot shows the clock time it would actually get**, which is the whole reason this
    /// is not a three-way segmented control. "Afternoon" is a guess; "2:30 PM" is the answer, and
    /// a slot that has to squeeze says so before you commit rather than after.
    private var slotPicker: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("When")
                .textStyle(.label)
                .foregroundStyle(Token.muted)
            let stops = days.indices.contains(day) ? days[day].stops : []
            ForEach(TimeOfDay.allCases, id: \.self) { option in
                let plan = DaySlotting.plan(stops, slot: option)
                let on = slot == option
                Button { slot = option } label: {
                    HStack(spacing: 10) {
                        Image(systemName: on ? "largecircle.fill.circle" : "circle")
                            .textStyle(.body)
                            .foregroundStyle(on ? Token.accent : Token.muted)
                        Text(option.rawValue)
                            .textStyle(.detail.weight(TextStyle.medium))
                            .foregroundStyle(Token.foreground)
                        Spacer(minLength: 0)
                        if plan.tight {
                            // Named, not just coloured — the rule the overspend line follows too.
                            Text("tight fit")
                                .textStyle(.micro)
                                .foregroundStyle(Token.alert)
                        }
                        Text(plan.time)
                            .textStyle(.detail)
                            .foregroundStyle(Token.muted)
                    }
                    .padding(.horizontal, 12)
                    .frame(height: 48)
                    .background(Color.white.opacity(on ? 0.10 : 0.05))
                    .clipShape(RoundedRectangle(cornerRadius: Token.radiusSmall, style: .continuous))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? [.isSelected, .isButton] : .isButton)
                .accessibilityValue(plan.tight ? "\(plan.time), tight fit" : plan.time)
            }
        }
    }

    private var addButton: some View {
        Button {
            saving = true
            // **Reset, because the card can now outlive the attempt.** It never did before:
            // the sheet dismissed unconditionally, so a stuck flag on a disappearing view was
            // invisible. Now a failure keeps the card up, and without this the button stays
            // "Adding…" and disabled — no second try.
            Task {
                await onAdd(day, slot)
                saving = false
            }
        } label: {
            Text(saving ? "Adding…" : "Add to Day \(day + 1)")
                .textStyle(.body.weight(TextStyle.semibold))
                .foregroundStyle(Token.accentForeground)
                .frame(maxWidth: .infinity)
                .frame(height: 48)
                .background(Token.accent)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(saving || !days.indices.contains(day))
        .padding(.top, Token.gapRows)
    }
}
