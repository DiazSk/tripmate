import SwiftUI
import TripMateKit

/// The memories wall.
///
/// **Two columns, and the web's hero mosaic is deliberately not ported.** `/trips` opens with a
/// full-viewport photo mosaic above single-column cards (`HERO_LAYOUTS`, `TripsView.tsx:82-111`).
/// That works because the hero is a whole viewport you scroll *past*. Here the wall lives in a
/// sheet, so the mosaic and the cards would be on screen together — and at five trips or fewer
/// they are the same photographs, drawn twice. The cards become the wall instead.
///
/// **That costs a stated value, and it is a deviation rather than a slip.** `DESIGN.md:1347`
/// specifies a 16:10 memory-card photo. At half width that is a 154x96pt strip, so the tile is
/// 4:5 here. Everything else about the card is the web's: a photograph over a permanent slate
/// base (the Constant-Ground Rule — a slow lookup must never blank a card and a resolved one
/// must never repaint the tile), the inset hairline, the destination, the dates, the budget.
struct TripsListView: View {
    @Environment(Chrome.self) private var chrome
    let store: TripsStore
    let onOpen: (TripSummary) -> Void
    let onPlan: () -> Void

    /// Which list is showing. **View state, not store state**: the store holds `activeDay` and
    /// `emphasis` because the *map* reads them, and nothing outside this file reads this.
    @State private var tab: Tab = .memories
    /// The row a confirm dialog is currently about.
    @State private var pending: TripSummary?

    enum Tab { case memories, drafts }

    /// **Derived, never trusted.** Discarding the last draft makes the strip disappear; stored
    /// state would strand you looking at a list that no longer exists.
    private var activeTab: Tab { store.drafts.isEmpty ? .memories : tab }
    private var showing: [TripSummary] { activeTab == .drafts ? store.drafts : store.trips }

    var body: some View {
        VStack(alignment: .leading, spacing: Token.gapPanels) {
            // **The masthead is one block with its own rhythm.** These three used to sit in the
            // outer stack's 24pt spacing and then claw it back with `.padding(.top, -24 + 6)`
            // each — which left 6pt under a 28pt serif title and read as jammed on an iPhone
            // 16 Pro. Nesting them states the spacing once instead of subtracting it twice.
            VStack(alignment: .leading, spacing: 10) {
                heading

                // **One sentence slot, where the web shows two.** It can afford the count line
                // under a full-viewport masthead *and* an explainer above the grid; this has
                // one screen, and both sentences describe the collection you are looking at.
                Text(
                    activeTab == .drafts
                        ? Self.draftsExplainer : TripsCopy.countLine(store.trips)
                )
                .textStyle(.detail)
                .foregroundStyle(Token.muted)

                if !store.drafts.isEmpty { tabs }
            }

            if let message = store.message {
                Notice(text: message)
            }

            if showing.isEmpty {
                if store.isLoading {
                    ProgressView().tint(Token.accent)
                        .frame(maxWidth: .infinity, alignment: .center)
                } else {
                    invitation
                }
                Spacer(minLength: 0)
            } else {
                wall
            }
        }
        // One alert, bound through the row it is about, so the copy can name the destination.
        // `.alert` rather than `.confirmationDialog`: `DESIGN.md:1359` calls this the app's one
        // modal, and an action sheet rising out of a sheet already anchored to the bottom reads
        // as two sheets arguing.
        .alert(
            pending?.resolvedStatus == .draft ? "Discard this draft?" : "Delete this trip?",
            isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } }),
            presenting: pending
        ) { trip in
            Button(
                trip.resolvedStatus == .draft ? "Discard draft" : "Delete trip",
                role: .destructive
            ) {
                Task { await store.delete(trip) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { trip in
            Text("Your \(trip.destination) itinerary will be permanently deleted. This can't be undone.")
        }
    }

    private static let draftsExplainer =
        "Plans you generated but haven't kept. Open one to carry on where you left off — "
        + "unkept drafts are cleared after 30 days."

    // MARK: - Chrome

    /// **Side by side when they fit, stacked when they do not.** A 28pt Melodrama title and a
    /// jade pill share a line comfortably at 440pt and crowd each other at 402 — measured on
    /// an iPhone 16 Pro, where about 8pt separated them and the row read as one jammed line.
    /// `ViewThatFits` decides per device, which beats a width threshold nobody can defend.
    private var heading: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline) {
                title
                Spacer(minLength: 16)
                planButton
            }
            VStack(alignment: .leading, spacing: 12) {
                title
                planButton
            }
        }
    }

    private var title: some View {
        Text("Memories")
            .textStyle(.display)
            .foregroundStyle(Token.foreground)
    }

    /// On an empty wall the invitation carries the button instead — a heading and an action
    /// over nothing reads as a toolbar for an empty room.
    @ViewBuilder private var planButton: some View {
        if !store.trips.isEmpty {
            Button("Plan a trip", action: onPlan)
                .buttonStyle(PrimaryButtonStyle())
        }
    }

    /// Only drawn when there is a second list to reach. Most travellers never have a draft, and
    /// a one-tab tab strip is chrome describing itself.
    private var tabs: some View {
        HStack(spacing: 6) {
            capsule("Memories", count: store.trips.count, tab: .memories)
            capsule("Drafts", count: store.drafts.count, tab: .drafts)
        }
    }

    private func capsule(_ title: String, count: Int, tab target: Tab) -> some View {
        let isActive = activeTab == target
        return Button { tab = target } label: {
            HStack(spacing: 6) {
                Text(title)
                Text("\(count)").textStyle(.money.size(12))
            }
            .textStyle(.caption.weight(TextStyle.semibold))
            // **Not the accent.** `DesignTokens` reserves jade for action and current position
            // on the map; the day tabs earn it because they move the camera. This moves nothing
            // but which list is under it, so it is the web's own `bg-white/10`.
            .foregroundStyle(isActive ? Token.foreground : Token.muted)
            .padding(.horizontal, 14)
            .frame(minHeight: 44)
            .background(isActive ? Color.white.opacity(0.10) : Color.clear)
            .clipShape(Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isActive ? [.isButton, .isSelected] : .isButton)
    }

    /// An invitation, not an apology. No "nothing here yet".
    private var invitation: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(activeTab == .drafts ? "No drafts waiting" : "Plan your first trip")
                .textStyle(.title)
                .foregroundStyle(Token.foreground)
            Text(
                activeTab == .drafts
                    ? "A plan you generate but don't keep waits here."
                    : "Tell us where and when, and the days come back written."
            )
            .textStyle(.body)
            .foregroundStyle(Token.muted)
            if activeTab != .drafts {
                Button("Plan a trip", action: onPlan)
                    .buttonStyle(PrimaryButtonStyle())
                    .padding(.top, 4)
            }
        }
    }

    // MARK: - The wall

    private var wall: some View {
        ScrollView {
            // Two flexible columns hand each tile a definite width, which is what lets
            // `.aspectRatio` resolve — `PlacePhotoView` has no intrinsic size by design.
            LazyVGrid(
                columns: [
                    GridItem(.flexible(), spacing: Token.gapRows),
                    GridItem(.flexible(), spacing: Token.gapRows),
                ],
                spacing: Token.gapRows
            ) {
                ForEach(showing, id: \.id) { trip in
                    Button { onOpen(trip) } label: {
                        MemoryTile(trip: trip)
                    }
                    .buttonStyle(.plain)
                    // **Long press, because swipe is not available here.** `.swipeActions` is
                    // only honoured inside a `List`, and a `List` row holding two tiles would
                    // swipe both away together. This keeps what swipe was for: no destructive
                    // chrome parked on every photograph, one deliberate gesture, then the
                    // dialog. VoiceOver is given the same action explicitly, because a context
                    // menu it can reach is not the same as one it is told about.
                    .contextMenu {
                        Button(
                            trip.resolvedStatus == .draft ? "Discard draft" : "Delete trip",
                            systemImage: "trash",
                            role: .destructive
                        ) { pending = trip }
                    }
                    .accessibilityAction(
                        named: trip.resolvedStatus == .draft ? "Discard draft" : "Delete trip"
                    ) { pending = trip }
                }
            }
            .padding(.bottom, Token.gapRows)
        }
        .shrinksTabBar(chrome)
    }
}

/// One memory: a photograph, where it was, when, and what it cost.
private struct MemoryTile: View {
    let trip: TripSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PlacePhotoView(name: trip.destination, large: true)
                // 4:5 rather than the web's 16:10 — see the note on `TripsListView`.
                .aspectRatio(4.0 / 5.0, contentMode: .fit)
                .clipShape(
                    RoundedRectangle(cornerRadius: Token.radiusMedium, style: .continuous)
                )
                // Keeps a bright photograph's edge from bleeding into the tile's own
                // translucent border — the web's `.memory-card-photo` inset, same alpha.
                .overlay(
                    RoundedRectangle(cornerRadius: Token.radiusMedium, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.14), lineWidth: 1)
                )

            Text(trip.destination)
                .textStyle(.heading)
                .foregroundStyle(Token.foreground)
                .lineLimit(1)
                // The one line here that genuinely runs long: at a 175pt tile "Zurich,
                // Switzerland" already fills the width. Shrinking beats an ellipsis on the
                // word that says where you went.
                .minimumScaleFactor(0.85)
                .padding(.top, 10)

            // **Two lines, not one.** At the panel's 360pt floor a tile is ~154pt wide and 134pt
            // of that is text. `Sep 19 – 23 · $2,400` already fills it, and a longer month pair
            // or a five-figure budget does not fit at all.
            Text(DayDisplay.formatRange(trip.startDate, trip.endDate))
                .textStyle(.money.size(12))
                .foregroundStyle(Token.muted)
                .padding(.top, 2)
            Text(
                trip.budget.formatted(.currency(code: "USD").precision(.fractionLength(0)))
                    + " budget"
            )
            .textStyle(.money.size(12))
            .foregroundStyle(Token.muted)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        // The one panel treatment, without the frost — see `glassPanel`.
        .glassPanel(frosted: false)
    }
}

/// A soft failure, in the form the web app uses for one: muted text inside the panel rather
/// than the red block, which is reserved for a hard validation error.
struct Notice: View {
    let text: String

    var body: some View {
        Text(text)
            .textStyle(.detail)
            .foregroundStyle(Token.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Token.gapRows)
            .background(Color.white.opacity(0.05))
            .clipShape(RoundedRectangle(cornerRadius: Token.radiusSmall, style: .continuous))
    }
}
