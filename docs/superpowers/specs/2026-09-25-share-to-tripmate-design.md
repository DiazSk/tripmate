# Share to TripMate: saved places from Instagram, TikTok and the camera roll

**Date:** 2026-09-25 · **Author:** Zaid, with Claude · **Status:** Design approved in brainstorm; not implemented
**Roadmap:** Stage 2 of [`2026-09-25-emotional-product-roadmap-design.md`](2026-09-25-emotional-product-roadmap-design.md)
**Builds on:** [`2026-09-25-chaos-in-trip-out-design.md`](2026-09-25-chaos-in-trip-out-design.md) (`/api/import`, anchors,
receipt). The mobile app in `mobile/` (Expo SDK 57) already has the drop zone, stars and receipt.

## Problem

Our audience keeps its travel inspiration on Instagram, and they save it weeks before they plan. Today, getting a
place into TripMate means opening TripMate, finding the wizard, and pasting. That's too far from the moment of
inspiration. Also, nothing is kept between that moment and the day they plan.

### What Instagram allows (researched 2026-09-25)

- **Meta's oEmbed returns no caption.** `author_name` and `thumbnail_url` were removed in late 2025. Its terms say
  content from the endpoint may be used for nothing but "providing a front-end view". So reading captions through it
  is both impossible and prohibited. Source: developers.facebook.com/docs/instagram-platform/oembed/
- **Instagram's share sheet hands other apps a post URL, and only that.** Every travel app surveyed (Wanderlog,
  Mindtrip, Layla) asks for a pasted link and gets no caption. We can't read the link: the page is login-walled for
  servers.
- **"Export your information" lists saved posts as permalinks only,** with no captions.
- **The official APIs don't help.** Instagram API with Instagram Login reads the user's *own* media. Business
  Discovery reads Business/Creator accounts by username, not an arbitrary post URL.

**Consequence:** the compliant ways in are **what the traveller can see**, meaning screenshots, and **media they
already hold**, meaning downloaded reels and screen recordings. Scraping and spoofing a crawler user agent are out
(Instagram's terms).

## Goals

1. From Instagram, TikTok, Photos or any app, **Share → TripMate** in one move. It accepts screenshots, videos, links
   and text.
2. Shared places are kept in a server-side **Saved places** inbox under the owner. The wizard offers them when that
   city is planned, on mobile and on the web.
3. Reels become places. The phone pulls a few frames from a downloaded reel or screen recording and reads them like
   screenshots, so on-screen text such as "📍 Café X" is caught.
4. Instagram links are handled honestly: kept as a "screenshot this one" reminder, never silently dropped.

## Non-goals

- Reading Instagram captions from a URL (see above).
- Returning the traveller to Instagram after sharing. iOS doesn't allow it; they swipe back.
- An offline queue. A share with no network shows Retry.
- A custom extension UI. The extension hands off to the app, which shows the result.
- Audio or voice-over transcription of reels.

## Experience

1. **Share from Instagram:**
   - *Downloadable reel:* Share → Download, then in Photos, Share → **TripMate**.
   - *Otherwise:* take a screenshot, tap the thumbnail, then Share → **TripMate**.
   - *The link itself:* TripMate says *"Instagram doesn't let apps read posts. Share a screenshot or the downloaded reel
     instead."* and saves the link as a reminder.
2. **TripMate opens on a small Share screen:** *"Found 2 places: Café Kitsune, Nishiki Market. Saved for your next
   trip."* with **Done**, or Retry on failure. Nothing is ever planned automatically.
3. **Planning later:** the basics step shows **Your saved places (N)**, grouped by city. Choosing a destination
   pre-selects the places saved for that city into `anchors`, and the star and remove work as they do today.
4. **The web wizard** shows the same Saved places above its drop zone.

## Architecture

### Server (Next.js, repo root)

**Table**, in `src/lib/db.ts`, following the existing `CREATE TABLE IF NOT EXISTS` pattern:

```sql
CREATE TABLE IF NOT EXISTS saved_places (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  place_key TEXT NOT NULL,          -- anchorKey(name): dedupe per owner
  lat REAL, lng REAL,               -- null when unplaced
  city TEXT,                        -- the import's destinationGuess, for grouping
  source TEXT NOT NULL,             -- screenshot | video | tiktok | youtube | gmaps | url | text | instagram
  url TEXT,                         -- only for instagram reminders
  created_at TEXT NOT NULL,         -- ISO string (see CLAUDE.md on datetime())
  UNIQUE (owner_id, place_key)
);
```

- Functions `listSavedPlaces(ownerId)`, `upsertSavedPlaces(ownerId, rows)` and `deleteSavedPlace(ownerId, id)`.
- Upserts keep existing coordinates when the incoming row has none.
- An Instagram reminder's `place_key` is `"ig:" + url`, so reminders never collide with place names.

**Route** `src/app/api/saved-places/route.ts`:
- `GET` returns `{ places: SavedPlace[] }`, newest first.
- `POST { places: Anchor[], city?: string|null, source, url? }` returns `{ saved: number }`. It's validated at this
  trust boundary: at most 40 places, names at most 120 characters, `source` from the fixed list.
- `DELETE ?id=` returns 200 or 404.
- All three are scoped by `currentOwnerId()` (`src/lib/ownerRequest.ts`) and throttled with `isThrottled`, as
  `/api/trip-edit` is.

**`/api/import` is unchanged.** The client composes import, then save.

**Web:** a "Your saved places" chip list in `src/components/ImportDropZone.tsx`. Tapping a chip merges it into
`anchors` through the existing updater pattern.

### Mobile (`mobile/`, Expo SDK 57)

**Native setup:**
- Add `expo-share-intent` (maintained for SDK 57, v8+).
- iOS: an extension that activates for images, movies, URLs and text, with an App Group
  `group.app.tripmate.shared` for hand-off.
- Android: intent filters for `ACTION_SEND` / `ACTION_SEND_MULTIPLE` on `image/*`, `video/*` and `text/*`.
- `app.json` gains `ios.bundleIdentifier: "app.tripmate"`, `android.package: "app.tripmate"` and `scheme: "tripmate"`.
- The app becomes a **development build** (`npx expo run:ios` / `run:android`), with Continuous Native Generation:
  `ios/` and `android/` are added to `mobile/.gitignore`.

**Dependencies:** `expo-share-intent`, `expo-file-system` (read shared files as base64) and `expo-video-thumbnails`
(frames). All three are maintained for the SDK.

**`src/lib/shareItems.ts`** (pure, and unit tested):
- Input: `{ text?, webUrl?, files?: {path, mimeType, duration?}[] }`.
- Output: `{ items: ImportItem[], instagramUrls: string[], videoFrames: {path, times}[] }`.
- Rules:
  - A URL on instagram.com is a reminder, not an import item.
  - Other URLs are url items; remaining text is one text item.
  - Images become image items.
  - Each video gets frame times `[1, 3, 6, 10, 15, 20]` seconds, filtered to below its duration when that's known, at
    most 6 frames per video.
  - The total of images plus frames is capped at 20, in order, dropping the extras.
- `ponytail:` fixed frame times, not scene detection. Upgrade if reels with late text get missed.

**Share screen** `src/app/share.tsx`, reached from the `useShareIntent()` hook in `src/app/_layout.tsx`:
1. Build the items.
2. Read files as base64 (frames via `VideoThumbnails.getThumbnailAsync`, at quality 0.5).
3. Call `importPlaces`.
4. Call `saveSavedPlaces({places, city: destinationGuess, source})` and `saveSavedPlaces` for each Instagram reminder.
5. Show the result, and `resetShareIntent()`.

Any failure shows the reason and a Retry that re-runs from step 3 with the items still in memory.

**API client** `src/api/tripMateApi.ts`: `listSavedPlaces()`, `saveSavedPlaces(body)` and `deleteSavedPlace(id)`,
following the file's `undefined`-on-transport-failure convention.

**Basics step** `src/app/plan/basics.tsx`:
- A "Your saved places (N)" section, loaded with `useFocusedFetch`, grouped by `city`.
- When the destination changes, places whose `city` matches it are merged into `draft.anchors` through `mergeAnchors`
  (`src/lib/anchors.ts`). Matching is case-insensitive, on the text before the first comma of each.
- Instagram reminders show as "Instagram post: screenshot it to add places", with a button that opens the URL.

### Error handling

| Failure | What the traveller sees |
|---|---|
| Share with no network, or the import fails | "Couldn't read these right now." + Retry |
| A video with no readable frames | "Couldn't find places in this video." |
| Only an Instagram link | The reminder text; the link is saved |
| The save fails after a successful import | The places are shown, "Couldn't save them. Try again." + Retry, which re-runs the save only |
| An oversized share | The first 20 images/frames are used, and it says "Used the first 20" |

### Privacy

Screenshots, videos and frames exist only in memory during the import, and are never uploaded except as the frames
sent to `/api/import`, which doesn't store them. Stored: the place name, coordinates, city, source type, and for
Instagram reminders, the URL.

## Build order

1. **Spike:** a simulator development build with `expo-share-intent`, then share one photo from the simulator's
   Photos app. This proves the plugin, the App Group and building with no paid Apple account. Record the result here.
   If App Groups need a paid account even on the simulator, stop and report.
2. **Server:** the `saved_places` table, its functions and `/api/saved-places`, with tests.
3. **Mobile:** the native setup, `shareItems.ts` with tests, the Share screen and the API client.
4. **Mobile:** saved places on the basics step, then the video frames.
5. **Web:** saved places in `ImportDropZone`.

## Testing

- **`.test.mjs` (web):**
  - the saved_places functions: upsert dedupe, coordinates kept, owner isolation, Instagram reminder keys;
  - the route's input validation.
- **jest (mobile):**
  - `shareItems`: Instagram URL → reminder, mixed text and URLs, frame times against duration, the 20 cap;
  - the city-match pre-select.
- **iOS Simulator end to end:**
  - Photos → Share → TripMate → the Share screen shows the places → the wizard's Saved places lists them;
  - an Instagram URL shared from Safari becomes a reminder.
- **Real iPhone (Zaid):** whether Instagram's Download works for a public reel, and the full Instagram → Photos →
  TripMate path. This needs a paid Apple Developer account for a device build; until then it's simulator only.
- **Android:** built and unit-tested only. There's no Android SDK on the dev Mac, so running it on an emulator waits on
  Android Studio being installed. Until then, Android is **unverified at runtime**.
- **Before each step is done:** `npm test`, `tsc` and lint at the repo root, and `npx jest`, `npx tsc --noEmit` and
  `npx expo lint` in `mobile/`.

## Spike result (2026-09-25)

**Works, on the iOS 27.0 simulator (iPhone 17), with no paid Apple account.** expo-share-intent 8.0.1: a real Photos →
Share → TripMate share opened the app on `/share` with
`{ files: [{ path: ".../Shared/AppGroup/<id>/<uuid>.JPG", mimeType: "image/jpeg", fileName, width, height, size, duration: null }], text: null, webUrl: null, type: "media" }`.
`files[].duration` is in milliseconds (README).

**iOS 27 finding.** Expo SDK 57's prebuild template produces a window-based AppDelegate with no
`UIApplicationSceneManifest`, and iOS 27 aborts at launch (`_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`,
SIGTRAP) for **every** launch. This is app-wide and not caused by sharing. Expo already ships
`ExpoAppSceneDelegate` (`@objc EXExpoAppSceneDelegate`) for this, but the template doesn't wire it.
`mobile/plugins/withSceneLifecycle.js` does: it adds the scene manifest and makes the AppDelegate an
`ExpoReactNativeFactoryProvider` that no longer starts React Native itself. It can be deleted once Expo's template adopts it.

**Two build notes:**
- CocoaPods silently installs nothing unless `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` is set.
- A hand-typed `tripmate://dataUrl=x` link with no `#media`/`#weburl`/`#text` fragment crashes inside expo-share-intent
  (it force-unwraps `url.fragment`). Real shares always carry the fragment.
