import SwiftUI
import TripMateKit

@main
struct TripMateApp: App {
    /// One session for the process, holding the token in the Keychain behind it.
    ///
    /// `TripMateAPI` takes its bearer from `session.tokenProvider()`, which captures the actor
    /// rather than a value — so a sign-out is visible on the very next request instead of whenever
    /// the client happened to be built.
    private let session: AuthSession
    @State private var store: TripsStore
    /// Place search, beside the trips rather than inside them: it answers "what is near here",
    /// which is a question about the map and not about the trip being read.
    @State private var search = MapSearchStore()
    @State private var plan: PlanStore
    /// One photograph cache for the process — the whole point is that every view asking for the
    /// same destination shares one request.
    @State private var photos: PlacePhotoStore
    /// The durable answers, beside the trips rather than inside them — they outlive every one.
    @State private var profile: ProfileStore

    init() {
        // Before anything draws. The three faces are bundled TTFs registered into the process
        // rather than declared in an Info.plist, because this project generates its plist.
        FontLoader.registerBundledFonts()

        let session = AuthSession(store: KeychainTokenStore())
        self.session = session
        // One client for the process, shared by both stores. `tokenProvider()` captures the actor
        // rather than a value, so a sign-out is visible on the next request either store makes.
        let api = TripMateAPI(
            baseURL: AppConfiguration.apiBaseURL,
            tokenProvider: session.tokenProvider()
        )
        _store = State(initialValue: TripsStore(api: api))
        _plan = State(initialValue: PlanStore(api: api))
        _photos = State(initialValue: PlacePhotoStore(api: api))
        _profile = State(initialValue: ProfileStore(api: api))
    }

    var body: some Scene {
        WindowGroup {
            RootView(store: store, plan: plan)
                .environment(search)
                .environment(photos)
                .environment(profile)
                // Dark-only, matching the web app's `color-scheme: dark` on :root. Not a
                // preference the system gets to override: the whole palette is one slate, and
                // `DESIGN.md`'s Darken-Never-Lighten rule has no light-mode counterpart.
                .preferredColorScheme(.dark)
        }
    }
}

private struct RootView: View {
    let store: TripsStore
    let plan: PlanStore
    @Environment(MapSearchStore.self) private var search

    @State private var tab: AppTab = .home
    /// **Hoisted out of `PanelContent`, and it has to be.** On the Map tab `PanelContent` leaves
    /// the tree entirely, so SwiftUI destroys its `@State` — coming back to Trips would drop you
    /// on the list with a half-filled draft still sitting in `PlanStore` that nothing renders.
    /// The wizard's actual content already survives, because it lives in `PlanStore`; only this
    /// boolean needed to move. Deliberately not a flag on `PlanStore`: that would be a second
    /// source of truth for one question.
    @State private var isPlanning = false
    /// The durable answers a finished trip is offering to keep, if they are worth offering.
    @State private var offer: ProfileOffer?
    @Environment(ProfileStore.self) private var profile

    var body: some View {
        AppShell(tab: $tab) {
            WorldMapView(
                route: store.route,
                // The panel counts stops in raw indices and the map's legs count in drawn ones.
                // Converted here, once, rather than on either side. See `RouteStop.rawIndex`.
                emphasis: store.emphasis.flatMap { store.route?.drawnIndex(forRawStop: $0) },
                pin: search.pin,
                focus: plan.previewRegion,
                onEmphasise: { store.emphasise($0) },
                onRegionSettled: { search.region = $0 }
            )
        } panel: {
            PanelContent(
                store: store, plan: plan, tab: tab, isPlanning: $isPlanning,
                onOfferProfile: { candidate in
                    Task {
                        // Loaded here rather than at launch: this is the first moment the answer
                        // is needed, and the traveller is between two screens anyway.
                        await profile.loadOnce()
                        guard candidate != profile.draft.travelerProfile else { return }
                        offer = ProfileOffer(profile: candidate)
                    }
                }
            )
        } home: {
            HomeView(plan: plan, onPlan: {
                // The capsule already holds whatever was typed; the wizard picks it up rather
                // than asking again. One `PlanDraft`, two ways in.
                isPlanning = true
                tab = .trips
            }, onTab: { tab = $0 })
        }
        .task { await store.loadTrips() }
        .sheet(item: $offer) { pending in
            SaveProfileSheet(
                candidate: pending.profile, store: profile, onFinish: { offer = nil }
            )
            .presentationDetents([.medium, .large])
        }
    }
}

/// `.sheet(item:)` wants identity, and a profile has none of its own — two travellers can
/// legitimately answer identically.
private struct ProfileOffer: Identifiable {
    let id = UUID()
    let profile: TravelerProfile
}

/// What the docked panel currently shows.
///
/// A plain conditional rather than a `NavigationStack`: the states are few, the transition is the
/// panel's own content changing, and a navigation bar would be a second piece of chrome competing
/// with the bar the shell already draws.
///
/// **Two routing axes now, and they do not interact.** `tab` picks the surface; `isPlanning` and
/// `store.open` pick what the Trips surface is showing. The governing rule is that **a tab switch
/// selects a surface and never mutates content state** — so the open trip, its active day and
/// emphasis, the wizard's step and every typed field, an in-flight generation, the search query
/// and pin all survive any number of tab switches. Nothing is reset by one.
///
/// `.map` never reaches here: the shell draws no panel for it at all.
private struct PanelContent: View {
    let store: TripsStore
    let plan: PlanStore
    let tab: AppTab
    @Binding var isPlanning: Bool
    let onOfferProfile: (TravelerProfile) -> Void

    var body: some View {
        Group {
            if tab == .profile {
                ProfileView()
            } else if isPlanning {
                PlanWizardView(
                    plan: plan,
                    onGenerated: { id in
                        isPlanning = false
                        // **Read before the reset, not after.** These are the wizard's answers
                        // and `reset()` is two lines away from throwing them out.
                        onOfferProfile(plan.draft.travelerProfile)
                        // The wizard's own copy is done with; the trip row is the record now.
                        plan.reset()
                        Task { await store.openTrip(id: id) }
                    },
                    onCancel: { isPlanning = false }
                )
            } else if let trip = store.open {
                TripDetailView(
                    trip: trip,
                    activeDay: store.activeDay,
                    emphasis: store.emphasis,
                    onSelectDay: { store.selectDay($0) },
                    onEmphasise: { store.emphasise($0) },
                    onBack: { store.closeTrip() },
                    onActualCost: { day, stop, amount in
                        await store.setActualCost(day: day, stop: stop, to: amount)
                    }
                )
            } else {
                TripsListView(
                    store: store,
                    onOpen: { summary in Task { await store.openTrip(id: summary.id) } },
                    onPlan: { isPlanning = true }
                )
            }
        }
        // The content's own inset. The *material* belongs to whichever container holds this —
        // the sheet on a phone, the docked column on an iPad — so that it is not drawn twice.
        .padding(Token.padCompact)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

enum AppConfiguration {
    /// Read from the build configuration rather than hardcoded, so a debug build can point at a
    /// local dev server and a release build cannot accidentally ship pointing at one.
    ///
    /// Nothing is deployed yet, so the fallback is the dev server's own address. When a hosted URL
    /// exists this becomes a per-configuration `Info.plist` key — not a literal edited by hand
    /// before each build, which is how a staging URL reaches the App Store.
    static var apiBaseURL: URL {
        if let raw = Bundle.main.object(forInfoDictionaryKey: "TripMateAPIBaseURL") as? String,
           let url = URL(string: raw) {
            return url
        }
        return URL(string: "http://localhost:3000")!
    }
}
