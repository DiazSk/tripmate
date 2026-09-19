import Observation
import SwiftUI
import TripMateKit

/// One photograph lookup per place name, shared by every view that asks.
///
/// **Three behaviours port from `usePlacePhoto`, and each exists because it broke once:**
///
/// 1. **One in-flight request per name.** A memories card, the header behind it and a stop
///    avatar all ask for the same destination at once, and the burst trips Wikipedia's rate
///    limiter. The web shares the promise; this shares the `Task`.
/// 2. **A failed lookup is not cached.** The route answers a *miss* with all-null and a **200**
///    so it can be cached; a **503** means the lookup itself failed. Caching that would leave a
///    trip photo-less for the whole session. `TripMateAPI.placePhoto` already collapses that to
///    `nil`, and `nil` is what goes uncached here.
/// 3. **Three variants, one request.** Thumbnail, full and extract arrive together, so asking
///    for the extract beside a photo costs nothing.
///
/// Only the *metadata* is cached here. The image bytes are `URLSession`'s problem, and
/// `AsyncImage` already goes through its shared cache — so a resolved URL costs nothing to
/// re-render, which is what the Constant-Ground Rule needs.
@MainActor
@Observable
final class PlacePhotoStore {
    private var resolved: [String: PlacePhoto] = [:]
    @ObservationIgnored private var inFlight: [String: Task<PlacePhoto?, Never>] = [:]

    private let api: TripMateAPI

    init(api: TripMateAPI) {
        self.api = api
    }

    /// What is known *now*, without starting a lookup. Views read this; `load` fills it.
    func cached(_ name: String) -> PlacePhoto? { resolved[name] }

    /// Fetch once per name. Safe to call from every view on every appearance.
    func load(_ name: String) async {
        let key = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty, resolved[key] == nil else { return }

        if let existing = inFlight[key] {
            _ = await existing.value
            return
        }
        let task = Task { await api.placePhoto(name: key) }
        inFlight[key] = task
        let photo = await task.value
        inFlight[key] = nil
        // Only a real answer is kept. `nil` means the lookup failed, so the next view that
        // asks tries again rather than inheriting a failure.
        if let photo { resolved[key] = photo }
    }
}

/// A destination photograph over the one slate base.
///
/// **The Constant-Ground Rule, which is the reason this is a view and not an `AsyncImage` at
/// each call site.** `DESIGN.md` states it twice: a slow lookup must never blank a card, and a
/// resolved one must never repaint the tile. So the slate is always drawn and the photograph
/// fades in *over* it — the card is never empty, never flashes, and a place with no picture is
/// a finished state rather than a pending one.
struct PlacePhotoView: View {
    let name: String
    /// `thumbnailUrl` for rows and avatars, `imageUrl` for header backgrounds.
    var large = false
    /// Darkens the photograph so type can sit on it. `DESIGN.md` measures why this is not
    /// optional: destination photography runs 0.040-0.348 mean luminance and **Kyoto peaks at
    /// 0.947**, where white body text is 2.41:1 under a 60% scrim and 3.56:1 under 75%.
    var scrim: Double = 0

    @Environment(PlacePhotoStore.self) private var store

    private var url: URL? {
        guard let photo = store.cached(name) else { return nil }
        return (large ? photo.imageUrl : photo.thumbnailUrl).flatMap(URL.init(string:))
    }

    var body: some View {
        // **The base is the only thing that sizes this, and that is load-bearing.**
        // These were ZStack siblings, and a resolved photograph then blew the tile out to the
        // image's own pixel width — `.scaledToFill()` reports the natural size as its ideal and
        // `.clipped()` clips *drawing*, not layout, so a 2000pt-wide JPEG made a 2000pt-wide
        // card and pushed the whole panel off the right of the screen. It looked fine until the
        // download finished, which is why it survived a screenshot.
        //
        // An overlay cannot influence its parent's size, so the ground defines the tile and the
        // photograph is painted onto it. That is the Constant-Ground Rule expressed as layout
        // rather than as a comment.
        Color.white.opacity(0.06)
            .overlay {
                if let url {
                    AsyncImage(
                        url: url, transaction: Transaction(animation: .easeOut(duration: 0.35))
                    ) { phase in
                        if case .success(let image) = phase {
                            image.resizable().scaledToFill()
                        }
                        // Deliberately nothing for `.empty` and `.failure`: a spinner would be
                        // the card blanking, which is the exact thing the rule forbids, and a
                        // failure should look like a place with no photograph rather than an
                        // error.
                    }
                    .transition(.opacity)
                }
            }
            .overlay {
                if scrim > 0, url != nil {
                    Color.black.opacity(scrim)
                }
            }
            .clipped()
            .task(id: name) { await store.load(name) }
    }
}
