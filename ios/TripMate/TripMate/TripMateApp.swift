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
    }

    var body: some Scene {
        WindowGroup {
            RootView(store: store, plan: plan)
                .environment(search)
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

    var body: some View {
        AppShell {
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
            PanelContent(store: store, plan: plan)
        }
        .task { await store.loadTrips() }
    }
}

/// What the docked panel currently shows.
///
/// A plain conditional rather than a `NavigationStack`: there are three states, the transition is
/// the panel's own content changing, and a navigation bar would be a second piece of chrome
/// competing with the one the shell already draws.
private struct PanelContent: View {
    let store: TripsStore
    let plan: PlanStore
    @State private var isPlanning = false

    var body: some View {
        Group {
            if isPlanning {
                PlanWizardView(
                    plan: plan,
                    onGenerated: { id in
                        isPlanning = false
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
                    onBack: { store.closeTrip() }
                )
            } else {
                TripsListView(
                    store: store,
                    onOpen: { summary in Task { await store.openTrip(id: summary.id) } },
                    onPlan: { isPlanning = true }
                )
            }
        }
        .padding(Token.padCompact)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .glassPanel()
        .padding(.top, Token.navHeight + Token.gapRows)
        .padding([.horizontal, .bottom], Token.padCompact)
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
