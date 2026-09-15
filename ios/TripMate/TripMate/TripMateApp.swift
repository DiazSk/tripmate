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

    init() {
        let session = AuthSession(store: KeychainTokenStore())
        self.session = session
        _store = State(
            initialValue: TripsStore(
                api: TripMateAPI(
                    baseURL: AppConfiguration.apiBaseURL,
                    tokenProvider: session.tokenProvider()
                )
            )
        )
    }

    var body: some Scene {
        WindowGroup {
            RootView(store: store)
                // Dark-only, matching the web app's `color-scheme: dark` on :root. Not a
                // preference the system gets to override: the whole palette is one slate, and
                // `DESIGN.md`'s Darken-Never-Lighten rule has no light-mode counterpart.
                .preferredColorScheme(.dark)
        }
    }
}

private struct RootView: View {
    let store: TripsStore

    var body: some View {
        AppShell {
            PanelContent(store: store)
        }
        .task { await store.loadTrips() }
    }
}

/// What the docked panel currently shows.
///
/// A plain conditional rather than a `NavigationStack`: there are two states, the transition is
/// the panel's own content changing, and a navigation bar would be a second piece of chrome
/// competing with the one the shell already draws.
private struct PanelContent: View {
    let store: TripsStore

    var body: some View {
        Group {
            if let trip = store.open {
                TripDetailView(trip: trip) { store.closeTrip() }
            } else {
                TripsListView(store: store) { summary in
                    Task { await store.openTrip(id: summary.id) }
                }
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
