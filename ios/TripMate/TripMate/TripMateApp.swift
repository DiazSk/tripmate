import SwiftUI
import TripMateKit

@main
struct TripMateApp: App {
    /// One session for the process, holding the token in the Keychain behind it.
    ///
    /// Constructed here rather than injected because there is exactly one, for the app's whole
    /// lifetime. `TripMateAPI` takes its bearer from `session.tokenProvider()`, which captures the
    /// actor rather than a value — so a sign-out is visible on the very next request instead of
    /// whenever the client happened to be built.
    private let session = AuthSession(store: KeychainTokenStore())

    var body: some Scene {
        WindowGroup {
            AppShell {
                PlanPanel(trip: nil)
            }
            // Dark-only, matching the web app's `color-scheme: dark` on :root. Not a preference
            // the system gets to override: the whole palette is one slate, and `DESIGN.md`'s
            // Darken-Never-Lighten rule has no light-mode counterpart to fall back on.
            .preferredColorScheme(.dark)
        }
    }

    /// Wired here so the unused-warning is a real signal: the moment a screen needs the network,
    /// this is what it takes.
    private var api: TripMateAPI {
        TripMateAPI(
            baseURL: AppConfiguration.apiBaseURL,
            tokenProvider: session.tokenProvider()
        )
    }
}

enum AppConfiguration {
    /// Read from the build configuration rather than hardcoded, so a debug build can point at a
    /// local dev server and a release build cannot accidentally ship pointing at one.
    ///
    /// Nothing is deployed yet, so the fallback is the dev server's own address. When the hosted
    /// URL exists this becomes an `Info.plist` key set per configuration — not a literal edited
    /// by hand before each build, which is how a staging URL reaches the App Store.
    static var apiBaseURL: URL {
        if let raw = Bundle.main.object(forInfoDictionaryKey: "TripMateAPIBaseURL") as? String,
           let url = URL(string: raw) {
            return url
        }
        return URL(string: "http://localhost:3000")!
    }
}
