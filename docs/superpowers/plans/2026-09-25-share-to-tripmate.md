# Share to TripMate: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Share → TripMate" from Instagram, TikTok, Photos or any app, on iOS and Android. Shared screenshots, reels
(as on-device frames), links and text become places in a server-side **Saved places** inbox. The planning wizard
offers them for the destination, on mobile and the web.

**Architecture:**
- The mobile app becomes a development build. `expo-share-intent` provides the iOS share extension (hand-off through
  an App Group) and Android intent filters.
- A pure `shareItems.ts` turns a share payload into `/api/import` items. Instagram URLs become reminders, and videos
  become frame times.
- The app calls the existing `/api/import`, then a new owner-scoped `/api/saved-places`, backed by a `saved_places`
  table.

**Tech stack:**
- Server: Next.js 16, `libsql` (sync API), `node --test` + `scripts/ts-resolve.mjs`.
- Mobile: Expo SDK 57, expo-router, `expo-share-intent`, `expo-file-system`, `expo-video-thumbnails`, jest-expo.

**Spec:** `docs/superpowers/specs/2026-09-25-share-to-tripmate-design.md`. Read it first; it holds the Instagram
research and the non-goals.

**Worktree:** `/Users/zaidshaikh/GitHub/tripmate/.worktrees/react-native-app`, branch `react-native-app`. Paths are
relative to it, and mobile paths start with `mobile/`. The shell resets its cwd after each command, so always
`cd <worktree>` first.

## Global Constraints

- **Commits carry no `Co-Authored-By` or any other trailer** (CLAUDE.md).
- No pushes.
- **No live model calls in tests.** Only the Task 1 spike and the Task 9 end-to-end check touch the running app, and
  import calls cost one Sonnet 5 extract each.
- **Owner scoping:**
  - every saved-places read and delete goes through `readableOwners(ownerId)` (`src/lib/owner.ts`), as `deleteTrip`
    does;
  - writes use the caller's `ownerId` from `currentOwnerId()` (`src/lib/ownerRequest.ts`);
  - the route is throttled with `isThrottled(req)` (`src/lib/ipThrottle.ts`).
- **DB conventions:**
  - `CREATE TABLE IF NOT EXISTS` at import time, in `src/lib/db.ts`;
  - timestamps are `new Date().toISOString()`;
  - rows are snake_case and the API is camelCase, mapped by hand.
- **Place identity** is `anchorKey(name)` from `src/lib/anchors.ts` (server) or `mobile/src/lib/anchors.ts`
  (mobile). An Instagram reminder's key is `"ig:" + url`.
- **Limits:**
  - at most 40 places per POST;
  - names at most 120 characters, cities at most 120;
  - at most 6 frames per video, at frame times `[1, 3, 6, 10, 15, 20]` seconds;
  - at most 20 images plus frames per share.
- **Sources:** `screenshot | video | tiktok | youtube | gmaps | url | text | instagram`.
- **Identifiers:**
  - bundle ID and Android package `app.tripmate`;
  - URL scheme `tripmate`;
  - App Group `group.app.tripmate.shared`.
- **Copy, verbatim:**
  - "Instagram doesn't let apps read posts. Share a screenshot or the downloaded reel instead."
  - "Found N places: … Saved for your next trip."
  - "Couldn't read these right now."
  - "Couldn't find places in this video."
  - "Couldn't save them. Try again."
  - "Used the first 20"
  - "Your saved places (N)"
  - "Instagram post: screenshot it to add places"
- **Media stays in memory only.** Never persist screenshots, videos or frames.
- `mobile/ios/` and `mobile/android/` are generated (Continuous Native Generation) and git-ignored. Never commit them.
- **Gates before each commit:**
  - repo root: `npm test`, `npx tsc --noEmit -p tsconfig.json`, `npm run lint`;
  - `mobile/`: `npx jest`, `npx tsc --noEmit`, `npx expo lint`.

## Review Focus

1. **A place shared twice** (the same café from a screenshot, then a reel) must be one row, keeping any coordinates
   it already had. → Task 2 test `upsert dedupes and keeps coordinates`.
2. **Another owner's saved places must never be listed or deleted.** → Task 2 test `owner isolation`.
3. **An Instagram link arriving as `text`, not `webUrl`** (Instagram sometimes shares "caption… https://…") must still
   become a reminder, not a text import. → Task 4 test `instagram url inside text`.
4. **A video with no known duration** must still yield frames, at all 6 times. → Task 4 test `unknown duration`.
5. **A destination typed as "Kyoto" must match places saved under "Kyoto, Japan",** and "Tokyo" must not match
   "Kyoto". → Task 6 test `cityMatches`.

---

### Task 1: Native setup, plus a spike proving a share reaches the app

**Files:**
- Modify: `mobile/app.json`, `mobile/.gitignore`, `mobile/package.json` (via `npx expo install`)
- Create: `mobile/src/app/+native-intent.tsx`
- Modify: `mobile/src/app/_layout.tsx` (wrap in the provider)
- Modify: `docs/superpowers/specs/2026-09-25-share-to-tripmate-design.md` (append the spike result)

**Interfaces:**
- Produces:
  - the `expo-share-intent` provider mounted at the root;
  - `+native-intent.tsx` routing share launches to `/share`;
  - native builds via `npx expo run:ios`.

- [ ] **Step 1: Install the dependencies**

  Run: `cd /Users/zaidshaikh/GitHub/tripmate/.worktrees/react-native-app/mobile && npx expo install expo-share-intent expo-file-system expo-video-thumbnails`

  Expected: all three are added to `package.json` at SDK-57-compatible versions. Then read
  `node_modules/expo-share-intent/README.md` and note the exact names of its provider and hook (v8:
  `ShareIntentProvider`, `useShareIntentContext`) and its plugin options. Use the README's names wherever they differ
  from this plan.

- [ ] **Step 2: Configure `app.json`**

  Set `expo.scheme` to `"tripmate"`. Add `"ios": { ..., "bundleIdentifier": "app.tripmate" }` (keep the existing
  `icon`) and `"android": { "package": "app.tripmate" }`. Append to `plugins`:

  ```json
  [
    "expo-share-intent",
    {
      "iosActivationRules": {
        "NSExtensionActivationSupportsWebURLWithMaxCount": 1,
        "NSExtensionActivationSupportsText": true,
        "NSExtensionActivationSupportsImageWithMaxCount": 20,
        "NSExtensionActivationSupportsMovieWithMaxCount": 3
      },
      "iosAppGroupIdentifier": "group.app.tripmate.shared",
      "androidIntentFilters": ["text/*", "image/*", "video/*"],
      "androidMultiIntentFilters": ["image/*", "video/*"]
    }
  ]
  ```

  If the README names an option differently, use the README's name.

- [ ] **Step 3: Ignore the generated native folders**

  Append to `mobile/.gitignore`:

  ```
  # Continuous Native Generation: regenerated by `expo prebuild` / `expo run:*`
  /ios
  /android
  ```

- [ ] **Step 4: Route share launches**

  A share opens the app through `tripmate://dataUrl=…`, which expo-router would otherwise treat as an unknown path.
  Create `mobile/src/app/+native-intent.tsx`:

  ```tsx
  // expo-share-intent opens the app with `tripmate://dataUrl=<key>`. Without this, expo-router
  // treats that as a path and shows "unmatched route" instead of the Share screen.
  export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
    return path.includes('dataUrl=') ? '/share' : path;
  }
  ```

  Then wrap the tree in `mobile/src/app/_layout.tsx`: import `{ ShareIntentProvider } from 'expo-share-intent'` and
  make it the outermost element in `RootLayout`'s return (outside `ThemeProvider`).

- [ ] **Step 5: Add a temporary `/share` probe screen, used for the spike only**

  Create `mobile/src/app/share.tsx`:

  ```tsx
  import { useShareIntentContext } from 'expo-share-intent';
  import { ThemedText } from '@/components/themed-text';
  import { ThemedView } from '@/components/themed-view';

  // SPIKE ONLY — replaced in Task 5.
  export default function ShareProbe() {
    const { shareIntent, hasShareIntent, error } = useShareIntentContext();
    return (
      <ThemedView style={{ flex: 1, padding: 24, paddingTop: 80 }}>
        <ThemedText selectable>{JSON.stringify({ hasShareIntent, error, shareIntent }, null, 2)}</ThemedText>
      </ThemedView>
    );
  }
  ```

  Register it in `_layout.tsx`'s Stack as `<Stack.Screen name="share" options={{ presentation: 'modal', headerShown: false }} />`.

- [ ] **Step 6: Build for the simulator and prove the hand-off**

  Run: `cd /Users/zaidshaikh/GitHub/tripmate/.worktrees/react-native-app/mobile && npx expo run:ios`. This prebuilds,
  then builds with Xcode for the simulator; the first build takes several minutes.

  Then, in the simulator:
  1. Open Photos.
  2. Pick a photo and tap Share. **TripMate** must appear in the share sheet.
  3. Tap it. The app opens on the probe, showing `files[0].path` and `mimeType: "image/jpeg"` (or HEIC).
  4. Repeat from Safari with a web page to confirm `webUrl` arrives.

  **If the build fails on App Group signing** (no paid Apple account): try once with the Xcode project's signing team
  set to "None / Sign to Run Locally" for the simulator. If it still fails, STOP and report. The spec says so, and
  every later mobile task depends on this.

- [ ] **Step 7: Record the result and commit**

  Append to the spec:

  ```markdown
  ## Spike result (2026-09-25)

  Simulator development build with expo-share-intent <version>: <WORKS — Photos image arrived as {…}, Safari URL arrived as {…} | FAILS — <error>>.
  Paid Apple account needed for simulator: <no | yes>.
  ```

  ```bash
  cd /Users/zaidshaikh/GitHub/tripmate/.worktrees/react-native-app && git add mobile/app.json mobile/.gitignore mobile/package.json mobile/package-lock.json "mobile/src/app/+native-intent.tsx" mobile/src/app/_layout.tsx mobile/src/app/share.tsx docs/superpowers/specs/2026-09-25-share-to-tripmate-design.md && git commit -m "Let TripMate receive shares from other apps"
  ```

---

### Task 2: The `saved_places` table and its functions

**Files:**
- Modify: `src/lib/db.ts` (append the table and three functions)
- Test: `src/lib/savedPlacesDb.test.mjs` (new)

**Interfaces:**
- Consumes: `anchorKey` from `src/lib/anchors.ts`; `readableOwners` from `src/lib/owner.ts` (already imported in db.ts).
- Produces:
  - `interface SavedPlaceRow { id: string; owner_id: string; name: string; place_key: string; lat: number | null; lng: number | null; city: string | null; source: string; url: string | null; created_at: string }`
  - `upsertSavedPlaces(ownerId: string, rows: { name: string; lat: number | null; lng: number | null; city: string | null; source: string; url: string | null }[]): number` (returns the number written)
  - `listSavedPlaces(ownerId: string): SavedPlaceRow[]` (newest first)
  - `deleteSavedPlace(ownerId: string, id: string): boolean`

- [ ] **Step 1: Write the failing tests**

  Create `src/lib/savedPlacesDb.test.mjs`:

  ```js
  /* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/savedPlacesDb.test.mjs */
  import assert from "node:assert/strict";
  import test from "node:test";
  import { randomUUID } from "node:crypto";
  import { deleteSavedPlace, listSavedPlaces, upsertSavedPlaces } from "./db.ts";

  const owner = () => `test-owner-${randomUUID()}`;
  const place = (name, extra = {}) => ({ name, lat: null, lng: null, city: "Kyoto, Japan", source: "screenshot", url: null, ...extra });

  test("upsert dedupes and keeps coordinates", () => {
    const o = owner();
    upsertSavedPlaces(o, [place("Nishiki Market", { lat: 35.005, lng: 135.764 })]);
    upsertSavedPlaces(o, [place("nishiki  market!", { source: "video" })]);
    const rows = listSavedPlaces(o);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].lat, 35.005);
    assert.equal(rows[0].name, "Nishiki Market");
  });

  test("owner isolation", () => {
    const a = owner();
    const b = owner();
    upsertSavedPlaces(a, [place("Kinkaku-ji")]);
    assert.equal(listSavedPlaces(b).length, 0);
    const [row] = listSavedPlaces(a);
    assert.equal(deleteSavedPlace(b, row.id), false);
    assert.equal(listSavedPlaces(a).length, 1);
    assert.equal(deleteSavedPlace(a, row.id), true);
    assert.equal(listSavedPlaces(a).length, 0);
  });

  test("instagram reminders are keyed by url and never collide with place names", () => {
    const o = owner();
    const url = "https://www.instagram.com/reel/abc/";
    upsertSavedPlaces(o, [place("Instagram post", { source: "instagram", url }), place("Instagram post", { source: "instagram", url: url + "x" })]);
    upsertSavedPlaces(o, [place("Instagram post", { source: "instagram", url })]);
    assert.equal(listSavedPlaces(o).length, 2);
  });

  test("list is newest first", async () => {
    const o = owner();
    upsertSavedPlaces(o, [place("First")]);
    await new Promise((r) => setTimeout(r, 5));
    upsertSavedPlaces(o, [place("Second")]);
    assert.deepEqual(listSavedPlaces(o).map((r) => r.name), ["Second", "First"]);
  });
  ```

- [ ] **Step 2: Run the tests and confirm they fail**

  Run: `cd /Users/zaidshaikh/GitHub/tripmate/.worktrees/react-native-app && node --import ./scripts/ts-resolve.mjs --test src/lib/savedPlacesDb.test.mjs`

  Expected: FAIL, `upsertSavedPlaces` is not exported.

- [ ] **Step 3: Implement**

  In `src/lib/db.ts`, add `import { anchorKey } from "./anchors";` next to the other imports (anchors.ts is pure). Then
  append:

  ```ts
  /**
   * Places a traveller shared into TripMate before planning — "save now, plan later". One row per
   * place per owner, keyed by `anchorKey(name)` so the same café shared from a screenshot and then a
   * reel is one entry. Instagram links (which cannot be read) are kept as reminders keyed by URL.
   * Holds names and coordinates only: the screenshots and frames they came from are never stored.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_places (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      place_key TEXT NOT NULL,
      lat REAL,
      lng REAL,
      city TEXT,
      source TEXT NOT NULL,
      url TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (owner_id, place_key)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_saved_places_owner ON saved_places (owner_id, created_at)`);

  export interface SavedPlaceRow {
    id: string;
    owner_id: string;
    name: string;
    place_key: string;
    lat: number | null;
    lng: number | null;
    city: string | null;
    source: string;
    url: string | null;
    created_at: string;
  }

  export function upsertSavedPlaces(
    ownerId: string,
    rows: { name: string; lat: number | null; lng: number | null; city: string | null; source: string; url: string | null }[]
  ): number {
    const stmt = db.prepare(
      `INSERT INTO saved_places (id, owner_id, name, place_key, lat, lng, city, source, url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (owner_id, place_key) DO UPDATE SET
         lat = COALESCE(excluded.lat, saved_places.lat),
         lng = COALESCE(excluded.lng, saved_places.lng),
         city = COALESCE(excluded.city, saved_places.city),
         created_at = excluded.created_at`
    );
    let written = 0;
    for (const r of rows) {
      const key = r.source === "instagram" && r.url ? `ig:${r.url}` : anchorKey(r.name);
      if (!key) continue;
      stmt.run(randomUUID(), ownerId, r.name, key, r.lat, r.lng, r.city, r.source, r.url, new Date().toISOString());
      written++;
    }
    return written;
  }

  export function listSavedPlaces(ownerId: string): SavedPlaceRow[] {
    const owners = readableOwners(ownerId);
    return db
      .prepare(
        `SELECT * FROM saved_places WHERE owner_id IN (${owners.map(() => "?").join(",")})
         ORDER BY created_at DESC, rowid DESC`
      )
      .all(...owners) as SavedPlaceRow[];
  }

  export function deleteSavedPlace(ownerId: string, id: string): boolean {
    const owners = readableOwners(ownerId);
    return (
      db
        .prepare(`DELETE FROM saved_places WHERE id = ? AND owner_id IN (${owners.map(() => "?").join(",")})`)
        .run(id, ...owners).changes > 0
    );
  }
  ```

  If `readableOwners` also grants the legacy owner's rows, the isolation test between two fresh random owners still
  holds, because neither owner is legacy. Keep the `readableOwners` call so the table behaves like `trips`.

- [ ] **Step 4: Run the tests and confirm they pass**

  Run: `cd /Users/zaidshaikh/GitHub/tripmate/.worktrees/react-native-app && node --import ./scripts/ts-resolve.mjs --test src/lib/savedPlacesDb.test.mjs`

  Expected: PASS, 4 tests.

- [ ] **Step 5: Gates, then commit**

  ```bash
  cd /Users/zaidshaikh/GitHub/tripmate/.worktrees/react-native-app && npm test && npx tsc --noEmit -p tsconfig.json && npm run lint
  git add src/lib/db.ts src/lib/savedPlacesDb.test.mjs && git commit -m "Keep the places a traveller saves until they plan"
  ```

---

### Task 3: `/api/saved-places`

**Files:**
- Create: `src/lib/savedPlaces.ts` (the pure body parser)
- Test: `src/lib/savedPlaces.test.mjs`
- Create: `src/app/api/saved-places/route.ts`
- Modify: `docs/backend.md` (a Features row)

**Interfaces:**
- Consumes: Task 2's three functions.
- Produces:
  - `SAVED_SOURCES`, `type SavedSource`
  - `parseSavedPlacesBody(body: unknown): { rows: {name; lat; lng; city; source; url}[] } | { error: string }`
  - HTTP:
    - `GET /api/saved-places` → `{ places: SavedPlace[] }`, where `SavedPlace = { id, name, lat, lng, city, source, url, createdAt }`;
    - `POST` with body `{ places: {name, lat, lng}[], city?, source, url? }` → `{ saved: number }`, or 400 with `{ error }`;
    - `DELETE ?id=` → `{ ok: true }` or 404.

- [ ] **Step 1: Write the failing tests**

  Create `src/lib/savedPlaces.test.mjs`:

  ```js
  /* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/savedPlaces.test.mjs */
  import assert from "node:assert/strict";
  import test from "node:test";
  import { parseSavedPlacesBody } from "./savedPlaces.ts";

  test("accepts places with a city and a source", () => {
    const out = parseSavedPlacesBody({ places: [{ name: " Kinkaku-ji ", lat: 35.04, lng: 135.73 }], city: "Kyoto, Japan", source: "screenshot" });
    assert.deepEqual(out, { rows: [{ name: "Kinkaku-ji", lat: 35.04, lng: 135.73, city: "Kyoto, Japan", source: "screenshot", url: null }] });
  });

  test("rejects an unknown source, a non-array, and over 40 places", () => {
    assert.ok("error" in parseSavedPlacesBody({ places: [], source: "fax" }));
    assert.ok("error" in parseSavedPlacesBody({ places: "x", source: "text" }));
    assert.ok("error" in parseSavedPlacesBody({ places: Array.from({ length: 41 }, (_, i) => ({ name: `P${i}` })), source: "text" }));
  });

  test("drops blank or oversized names and non-numeric coordinates", () => {
    const out = parseSavedPlacesBody({ places: [{ name: "" }, { name: "x".repeat(121) }, { name: "Ok", lat: "1", lng: 2 }], source: "text" });
    assert.deepEqual(out.rows, [{ name: "Ok", lat: null, lng: 2, city: null, source: "text", url: null }]);
  });

  test("an instagram reminder needs an instagram https url and gets a default name", () => {
    assert.ok("error" in parseSavedPlacesBody({ places: [], source: "instagram", url: "http://evil.test/x" }));
    const out = parseSavedPlacesBody({ places: [], source: "instagram", url: "https://www.instagram.com/reel/abc/" });
    assert.deepEqual(out.rows, [{ name: "Instagram post", lat: null, lng: null, city: null, source: "instagram", url: "https://www.instagram.com/reel/abc/" }]);
  });
  ```

- [ ] **Step 2: Run the tests and confirm they fail**

  Run: `cd /Users/zaidshaikh/GitHub/tripmate/.worktrees/react-native-app && node --import ./scripts/ts-resolve.mjs --test src/lib/savedPlaces.test.mjs`

  Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/lib/savedPlaces.ts`**

  ```ts
  /** Trust boundary for POST /api/saved-places: the body comes from any client. Malformed places
   *  are dropped; a malformed request is rejected with a reason. */
  export const SAVED_SOURCES = ["screenshot", "video", "tiktok", "youtube", "gmaps", "url", "text", "instagram"] as const;
  export type SavedSource = (typeof SAVED_SOURCES)[number];

  const MAX_PLACES = 40;
  const MAX_TEXT = 120;

  type Row = { name: string; lat: number | null; lng: number | null; city: string | null; source: SavedSource; url: string | null };

  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const text = (v: unknown) => (typeof v === "string" && v.trim() && v.trim().length <= MAX_TEXT ? v.trim() : null);

  export function parseSavedPlacesBody(body: unknown): { rows: Row[] } | { error: string } {
    const b = (body ?? {}) as Record<string, unknown>;
    if (!SAVED_SOURCES.includes(b.source as SavedSource)) return { error: "Unknown source." };
    const source = b.source as SavedSource;
    if (source === "instagram") {
      let url: URL;
      try {
        url = new URL(String(b.url));
      } catch {
        return { error: "An Instagram reminder needs its link." };
      }
      const host = url.hostname.replace(/^www\./, "");
      if (url.protocol !== "https:" || !(host === "instagram.com" || host.endsWith(".instagram.com"))) {
        return { error: "An Instagram reminder needs its link." };
      }
      return { rows: [{ name: "Instagram post", lat: null, lng: null, city: null, source, url: url.toString() }] };
    }
    if (!Array.isArray(b.places)) return { error: "Expected a list of places." };
    if (b.places.length > MAX_PLACES) return { error: `Up to ${MAX_PLACES} places at a time.` };
    const city = text(b.city);
    const rows = (b.places as Record<string, unknown>[]).flatMap((p) => {
      const name = text(p?.name);
      return name ? [{ name, lat: num(p.lat), lng: num(p.lng), city, source, url: null }] : [];
    });
    return { rows };
  }
  ```

- [ ] **Step 4: Run the tests and confirm they pass**

  Run: `cd /Users/zaidshaikh/GitHub/tripmate/.worktrees/react-native-app && node --import ./scripts/ts-resolve.mjs --test src/lib/savedPlaces.test.mjs`

  Expected: PASS, 4 tests.

- [ ] **Step 5: The route**

  Create `src/app/api/saved-places/route.ts`:

  ```ts
  import { NextRequest, NextResponse } from "next/server";
  import { deleteSavedPlace, listSavedPlaces, upsertSavedPlaces } from "@/lib/db";
  import { currentOwnerId } from "@/lib/ownerRequest";
  import { isThrottled } from "@/lib/ipThrottle";
  import { parseSavedPlacesBody } from "@/lib/savedPlaces";

  /** The traveller's "save now, plan later" inbox. Owner-scoped like trips; see saved_places in db.ts. */

  const tooMany = () => NextResponse.json({ error: "Too many requests — slow down and try again shortly." }, { status: 429 });

  export async function GET(req: NextRequest) {
    if (isThrottled(req)) return tooMany();
    const rows = listSavedPlaces(await currentOwnerId());
    return NextResponse.json({
      places: rows.map((r) => ({ id: r.id, name: r.name, lat: r.lat, lng: r.lng, city: r.city, source: r.source, url: r.url, createdAt: r.created_at })),
    });
  }

  export async function POST(req: NextRequest) {
    if (isThrottled(req)) return tooMany();
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    const parsed = parseSavedPlacesBody(body);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    return NextResponse.json({ saved: upsertSavedPlaces(await currentOwnerId(), parsed.rows) });
  }

  export async function DELETE(req: NextRequest) {
    if (isThrottled(req)) return tooMany();
    const id = req.nextUrl.searchParams.get("id");
    if (!id || !deleteSavedPlace(await currentOwnerId(), id)) {
      return NextResponse.json({ error: "That place isn't saved here." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  }
  ```

- [ ] **Step 6: Curl check against a running dev server**

  Use the already-running server on port 3000 if one exists (`curl -s localhost:3000/api/geocode?destination=x`);
  otherwise start one through `preview_start`. Use one cookie jar so the owner stays the same:

  ```bash
  J=/private/tmp/sp.jar; B=http://localhost:3000/api/saved-places
  curl -s -c $J -b $J -X POST $B -H 'content-type: application/json' -d '{"places":[{"name":"Kinkaku-ji","lat":35.04,"lng":135.73}],"city":"Kyoto, Japan","source":"screenshot"}'
  curl -s -c $J -b $J $B
  curl -s -c $J -b $J -X POST $B -H 'content-type: application/json' -d '{"places":[],"source":"fax"}' -w " %{http_code}\n"
  ```

  Expected: `{"saved":1}`, then a list containing Kinkaku-ji, then a `400`. Then delete the row with
  `curl -s -c $J -b $J -X DELETE "$B?id=<id>"`, which returns `{"ok":true}`.

- [ ] **Step 7: Docs row, gates, commit**

  Add a row to `docs/backend.md`'s Features table: `/api/saved-places`, the owner-scoped "save now, plan later" inbox
  (GET/POST/DELETE, deduped by place key, Instagram reminders by URL). Since 2026-09-25, Developer Claude.

  ```bash
  cd /Users/zaidshaikh/GitHub/tripmate/.worktrees/react-native-app && npm test && npx tsc --noEmit -p tsconfig.json && npm run lint
  git add src/lib/savedPlaces.ts src/lib/savedPlaces.test.mjs src/app/api/saved-places/route.ts docs/backend.md && git commit -m "Give saved places an owner-scoped endpoint"
  ```

---

### Task 4: `shareItems`, turning a share payload into import items

**Files:**
- Create: `mobile/src/lib/shareItems.ts`
- Test: `mobile/src/lib/shareItems.test.ts`

**Interfaces:**
- Consumes: `ImportItem` from `mobile/src/api/types.ts` (`{kind:'image', mediaType, data}` | `{kind:'url', url}` |
  `{kind:'text', text}`).
- Produces:
  - `SharePayload = { text?: string | null; webUrl?: string | null; files?: { path: string; mimeType: string; duration?: number | null }[] | null }`
  - `planShare(p: SharePayload): { linkItems: ImportItem[]; imagePaths: string[]; videoFrames: { path: string; times: number[] }[]; instagramUrls: string[]; truncated: boolean }`
  - `FRAME_TIMES_S = [1, 3, 6, 10, 15, 20]`, `MAX_MEDIA = 20`

- [ ] **Step 1: Write the failing tests**

  Create `mobile/src/lib/shareItems.test.ts`:

  ```ts
  import { FRAME_TIMES_S, planShare } from './shareItems';

  describe('planShare', () => {
    it('turns an instagram webUrl into a reminder, not an import item', () => {
      const out = planShare({ webUrl: 'https://www.instagram.com/reel/abc/' });
      expect(out.instagramUrls).toEqual(['https://www.instagram.com/reel/abc/']);
      expect(out.linkItems).toEqual([]);
    });

    it('instagram url inside text', () => {
      const out = planShare({ text: 'Best ramen in Kyoto 🍜 https://www.instagram.com/p/xyz/?igsh=1' });
      expect(out.instagramUrls).toEqual(['https://www.instagram.com/p/xyz/?igsh=1']);
      expect(out.linkItems).toEqual([{ kind: 'text', text: 'Best ramen in Kyoto 🍜' }]);
    });

    it('splits other urls from the remaining text', () => {
      const out = planShare({ text: 'Maya says Nishiki Market\nhttps://maps.app.goo.gl/abc' });
      expect(out.linkItems).toEqual([
        { kind: 'url', url: 'https://maps.app.goo.gl/abc' },
        { kind: 'text', text: 'Maya says Nishiki Market' },
      ]);
    });

    it('frame times stop before a known duration', () => {
      const out = planShare({ files: [{ path: 'v.mov', mimeType: 'video/quicktime', duration: 7000 }] });
      expect(out.videoFrames).toEqual([{ path: 'v.mov', times: [1, 3, 6] }]);
    });

    it('unknown duration', () => {
      const out = planShare({ files: [{ path: 'v.mp4', mimeType: 'video/mp4' }] });
      expect(out.videoFrames[0].times).toEqual(FRAME_TIMES_S);
    });

    it('caps images plus frames at 20, in order, and says so', () => {
      const images = Array.from({ length: 18 }, (_, i) => ({ path: `i${i}.jpg`, mimeType: 'image/jpeg' }));
      const out = planShare({ files: [...images, { path: 'v.mp4', mimeType: 'video/mp4' }] });
      expect(out.imagePaths).toHaveLength(18);
      expect(out.videoFrames).toEqual([{ path: 'v.mp4', times: [1, 3] }]);
      expect(out.truncated).toBe(true);
    });
  });
  ```

- [ ] **Step 2: Run the tests and confirm they fail**

  Run: `cd /Users/zaidshaikh/GitHub/tripmate/.worktrees/react-native-app/mobile && npx jest src/lib/shareItems.test.ts`

  Expected: FAIL, cannot find module `./shareItems`.

- [ ] **Step 3: Implement `mobile/src/lib/shareItems.ts`**

  ```ts
  import type { ImportItem } from '@/api/types';

  /**
   * What a share from another app becomes, before anything is read off disk.
   *
   * Instagram URLs cannot be read by any app (Meta's oEmbed carries no caption and its terms forbid
   * non-display use), so they become reminders rather than import items — see the share spec.
   * Videos become frame times: the frames are pulled on the phone and read like screenshots.
   * ponytail: fixed frame times, not scene detection — upgrade if reels with late text get missed.
   */
  export const FRAME_TIMES_S = [1, 3, 6, 10, 15, 20];
  export const MAX_MEDIA = 20;

  export interface SharePayload {
    text?: string | null;
    webUrl?: string | null;
    files?: { path: string; mimeType: string; duration?: number | null }[] | null;
  }

  const URL_RE = /https?:\/\/\S+/g;
  const isInstagram = (u: string) => {
    try {
      const h = new URL(u).hostname.replace(/^www\./, '');
      return h === 'instagram.com' || h.endsWith('.instagram.com');
    } catch {
      return false;
    }
  };

  export function planShare(p: SharePayload) {
    const urls = [...(p.webUrl ? [p.webUrl] : []), ...((p.text ?? '').match(URL_RE) ?? [])];
    const rest = (p.text ?? '').replace(URL_RE, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
    const unique = [...new Set(urls)];
    const instagramUrls = unique.filter(isInstagram);
    const linkItems: ImportItem[] = [
      ...unique.filter((u) => !isInstagram(u)).map((url) => ({ kind: 'url' as const, url })),
      ...(rest ? [{ kind: 'text' as const, text: rest }] : []),
    ];

    let budget = MAX_MEDIA;
    let truncated = false;
    const imagePaths: string[] = [];
    const videoFrames: { path: string; times: number[] }[] = [];
    for (const f of p.files ?? []) {
      if (f.mimeType.startsWith('image/')) {
        if (budget > 0) {
          imagePaths.push(f.path);
          budget--;
        } else truncated = true;
      } else if (f.mimeType.startsWith('video/')) {
        const all = f.duration ? FRAME_TIMES_S.filter((t) => t * 1000 < (f.duration as number)) : FRAME_TIMES_S;
        const times = all.slice(0, Math.min(6, budget));
        if (times.length < all.length) truncated = true;
        if (times.length) videoFrames.push({ path: f.path, times });
        budget -= times.length;
      }
    }
    return { linkItems, imagePaths, videoFrames, instagramUrls, truncated };
  }
  ```

  Note: `duration` is in milliseconds as expo-share-intent reports it. Confirm this against its README. If it reports
  seconds, drop the `* 1000` and adjust the test to `duration: 7`.

- [ ] **Step 4: Run the tests and confirm they pass**

  Run: `cd /Users/zaidshaikh/GitHub/tripmate/.worktrees/react-native-app/mobile && npx jest src/lib/shareItems.test.ts`

  Expected: PASS, 6 tests.

- [ ] **Step 5: Gates, then commit**

  ```bash
  cd /Users/zaidshaikh/GitHub/tripmate/.worktrees/react-native-app/mobile && npx jest && npx tsc --noEmit && npx expo lint
  cd .. && git add mobile/src/lib/shareItems.ts mobile/src/lib/shareItems.test.ts && git commit -m "Decide what a share becomes before reading it"
  ```

---

### Task 5: The Share screen, with images, links and text

**Files:**
- Modify: `mobile/src/api/types.ts` (`SavedPlace`, `SavedSource`)
- Modify: `mobile/src/api/tripMateApi.ts` (`listSavedPlaces`, `saveSavedPlaces`, `deleteSavedPlace`)
- Replace: `mobile/src/app/share.tsx` (the spike probe → the real screen)

**Interfaces:**
- Consumes: `planShare` (Task 4); `importPlaces(items, destination?)` (existing; returns `ImportResult | string |
  undefined`); `/api/saved-places` (Task 3); the expo-share-intent hook (Task 1).
- Produces:
  - `type SavedSource = 'screenshot' | 'video' | 'tiktok' | 'youtube' | 'gmaps' | 'url' | 'text' | 'instagram'`
  - `interface SavedPlace { id: string; name: string; lat: number | null; lng: number | null; city: string | null; source: SavedSource; url: string | null; createdAt: string }`
  - `listSavedPlaces(): Promise<SavedPlace[] | undefined>`
  - `saveSavedPlaces(body: { places: { name: string; lat: number | null; lng: number | null }[]; city?: string | null; source: SavedSource; url?: string }): Promise<boolean>`
  - `deleteSavedPlace(id: string): Promise<boolean>`

- [ ] **Step 1: Add the types and the API client**

  In `mobile/src/api/types.ts`, append:

  ```ts
  export type SavedSource = 'screenshot' | 'video' | 'tiktok' | 'youtube' | 'gmaps' | 'url' | 'text' | 'instagram';

  /** A place shared into TripMate before planning — see /api/saved-places. */
  export interface SavedPlace {
    id: string;
    name: string;
    lat: number | null;
    lng: number | null;
    city: string | null;
    source: SavedSource;
    url: string | null;
    createdAt: string;
  }
  ```

  In `mobile/src/api/tripMateApi.ts`, next to `importPlaces`, add these, following the file's
  `fetchWithSession` / `undefined`-on-transport-failure conventions:

  ```ts
  /** `GET /api/saved-places` — the traveller's "save now, plan later" inbox, newest first. */
  export async function listSavedPlaces(): Promise<SavedPlace[] | undefined> {
    try {
      const res = await fetchWithSession('/api/saved-places', {});
      if (!res.ok) return undefined;
      return ((await res.json()) as { places: SavedPlace[] }).places;
    } catch {
      return undefined;
    }
  }

  /** `POST /api/saved-places`. False on any failure — the caller offers Retry. */
  export async function saveSavedPlaces(body: {
    places: { name: string; lat: number | null; lng: number | null }[];
    city?: string | null;
    source: SavedSource;
    url?: string;
  }): Promise<boolean> {
    try {
      const res = await fetchWithSession('/api/saved-places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  export async function deleteSavedPlace(id: string): Promise<boolean> {
    try {
      const res = await fetchWithSession(`/api/saved-places?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      return res.ok;
    } catch {
      return false;
    }
  }
  ```

  Add `SavedPlace, SavedSource` to the file's type import from `./types`.

- [ ] **Step 2: The Share screen**

  Replace `mobile/src/app/share.tsx`. Reuse the existing themed components and styles (`ThemedText`, `ThemedView`, the
  button style used on `basics.tsx`'s import actions, and `Colors` from `@/constants/theme`). Keep the logic exactly
  as below; only the styling classes and components may follow local patterns.

  ```tsx
  import { useCallback, useEffect, useState } from 'react';
  import { Pressable, ScrollView, StyleSheet } from 'react-native';
  import { router } from 'expo-router';
  import { useShareIntentContext } from 'expo-share-intent';
  import { readAsStringAsync } from 'expo-file-system/legacy';
  import { importPlaces, saveSavedPlaces } from '@/api/tripMateApi';
  import type { ImportItem, SavedSource } from '@/api/types';
  import { ThemedText } from '@/components/themed-text';
  import { ThemedView } from '@/components/themed-view';
  import { planShare } from '@/lib/shareItems';

  type State =
    | { kind: 'reading' }
    | { kind: 'done'; names: string[]; reminders: number; truncated: boolean; unread: string[] }
    | { kind: 'importFailed' }
    | { kind: 'saveFailed'; names: string[] };

  const INSTAGRAM_NOTE = "Instagram doesn't let apps read posts. Share a screenshot or the downloaded reel instead.";

  /** One source label for the whole share — the inbox groups by city, not by item. */
  function sourceOf(items: ImportItem[], hasVideo: boolean): SavedSource {
    if (hasVideo) return 'video';
    if (items.some((i) => i.kind === 'image')) return 'screenshot';
    const url = items.find((i) => i.kind === 'url');
    if (url && url.kind === 'url') {
      if (/tiktok\.com/.test(url.url)) return 'tiktok';
      if (/youtu\.?be/.test(url.url)) return 'youtube';
      if (/google\.[^/]+\/maps|maps\.app\.goo\.gl/.test(url.url)) return 'gmaps';
      return 'url';
    }
    return 'text';
  }

  export default function ShareScreen() {
    const { shareIntent, hasShareIntent, resetShareIntent } = useShareIntentContext();
    const [state, setState] = useState<State>({ kind: 'reading' });
    const [items, setItems] = useState<ImportItem[] | null>(null);
    const [meta, setMeta] = useState({ hasVideo: false, truncated: false, instagramUrls: [] as string[] });

    // Build the import items once per share. Frames are added in Task 7; images are read here.
    useEffect(() => {
      if (!hasShareIntent) return;
      const plan = planShare({ text: shareIntent.text, webUrl: shareIntent.webUrl, files: shareIntent.files });
      (async () => {
        const images: ImportItem[] = [];
        for (const path of plan.imagePaths) {
          try {
            images.push({ kind: 'image', mediaType: 'image/jpeg', data: await readAsStringAsync(path, { encoding: 'base64' }) });
          } catch {
            // An unreadable file is skipped; the result line says how many places were found.
          }
        }
        setMeta({ hasVideo: plan.videoFrames.length > 0, truncated: plan.truncated, instagramUrls: plan.instagramUrls });
        setItems([...plan.linkItems, ...images]);
      })();
    }, [hasShareIntent, shareIntent]);

    const run = useCallback(async () => {
      if (!items) return;
      setState({ kind: 'reading' });
      for (const url of meta.instagramUrls) await saveSavedPlaces({ places: [], source: 'instagram', url });
      if (items.length === 0) {
        setState({ kind: 'done', names: [], reminders: meta.instagramUrls.length, truncated: meta.truncated, unread: [] });
        return;
      }
      const result = await importPlaces(items);
      if (result === undefined || typeof result === 'string') {
        setState({ kind: 'importFailed' });
        return;
      }
      const names = result.places.map((p) => p.name);
      const ok = await saveSavedPlaces({
        places: result.places.map((p) => ({ name: p.name, lat: p.lat, lng: p.lng })),
        city: result.destinationGuess,
        source: sourceOf(items, meta.hasVideo),
      });
      setState(ok
        ? { kind: 'done', names, reminders: meta.instagramUrls.length, truncated: meta.truncated, unread: result.unread.map((u) => u.reason) }
        : { kind: 'saveFailed', names });
    }, [items, meta]);

    useEffect(() => {
      if (items) run();
    }, [items, run]);

    const close = () => {
      resetShareIntent();
      router.replace('/');
    };

    return (
      <ThemedView style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          {state.kind === 'reading' && <ThemedText>Reading what you shared…</ThemedText>}
          {state.kind === 'done' && (
            <>
              {state.names.length > 0 && (
                <ThemedText type="subtitle">
                  Found {state.names.length} {state.names.length === 1 ? 'place' : 'places'}: {state.names.join(', ')}. Saved for your next trip.
                </ThemedText>
              )}
              {state.names.length === 0 && meta.hasVideo && <ThemedText>Couldn't find places in this video.</ThemedText>}
              {state.reminders > 0 && <ThemedText>{INSTAGRAM_NOTE}</ThemedText>}
              {state.truncated && <ThemedText themeColor="muted">Used the first 20</ThemedText>}
              {state.unread.map((u, i) => (
                <ThemedText key={i} themeColor="muted">{u}</ThemedText>
              ))}
            </>
          )}
          {state.kind === 'importFailed' && <ThemedText>Couldn't read these right now.</ThemedText>}
          {state.kind === 'saveFailed' && (
            <>
              <ThemedText>Found: {state.names.join(', ')}</ThemedText>
              <ThemedText>Couldn't save them. Try again.</ThemedText>
            </>
          )}
          {(state.kind === 'importFailed' || state.kind === 'saveFailed') && (
            <Pressable accessibilityRole="button" onPress={run} style={styles.button}>
              <ThemedText>Retry</ThemedText>
            </Pressable>
          )}
          {state.kind !== 'reading' && (
            <Pressable accessibilityRole="button" onPress={close} style={styles.button}>
              <ThemedText>Done</ThemedText>
            </Pressable>
          )}
        </ScrollView>
      </ThemedView>
    );
  }

  const styles = StyleSheet.create({
    root: { flex: 1 },
    content: { padding: 24, paddingTop: 80, gap: 16 },
    button: { paddingVertical: 14, paddingHorizontal: 20, borderRadius: 999, alignSelf: 'flex-start' },
  });
  ```

  On `saveFailed`, the Retry above re-runs the import too. To match the spec ("re-runs the save only"), keep the last
  import result in a ref and branch `run` to skip `importPlaces` when a result is already held:

  ```tsx
  const lastResult = useRef<ImportResult | null>(null);
  // in run(): const result = lastResult.current ?? (await importPlaces(items)); ... lastResult.current = result;
  ```

  Import `useRef`, and `ImportResult` from `@/api/types`. Check how `ThemedText` accepts `type` and `themeColor`
  (`mobile/src/components/themed-text.tsx`), and use its real prop names.

- [ ] **Step 3: Typecheck and lint**

  Run: `cd /Users/zaidshaikh/GitHub/tripmate/.worktrees/react-native-app/mobile && npx tsc --noEmit && npx expo lint && npx jest`

  Expected: clean.

- [ ] **Step 4: Check it in the simulator**

  Run: `cd /Users/zaidshaikh/GitHub/tripmate/.worktrees/react-native-app/mobile && npx expo run:ios`. The API must be
  reachable on `localhost:3000`.

  Share a screenshot from Photos to TripMate. Expected:
  1. "Reading what you shared…", then "Found N places: … Saved for your next trip."
  2. `GET /api/saved-places`, curled with the app's session or checked with `listSavedPlaces()`, lists them.

  Then share a Safari page on instagram.com. Expected: the Instagram note, and a reminder row.

- [ ] **Step 5: Commit**

  ```bash
  cd /Users/zaidshaikh/GitHub/tripmate/.worktrees/react-native-app && git add mobile/src/api/types.ts mobile/src/api/tripMateApi.ts mobile/src/app/share.tsx && git commit -m "Read a share and keep its places for the next trip"
  ```

---

### Task 6: Saved places on the basics step

**Files:**
- Create: `mobile/src/lib/savedPlaces.ts` (pure: `cityMatches`, `groupByCity`, `toAnchor`)
- Test: `mobile/src/lib/savedPlaces.test.ts`
- Modify: `mobile/src/app/plan/basics.tsx` (a new `SavedPlacesSection` above `ImportSection`)
- Modify: `docs/frontend.md` (a Features row)

**Interfaces:**
- Consumes: `listSavedPlaces`, `deleteSavedPlace`, `SavedPlace` (Task 5); `mergeAnchors(prev, incoming)` from
  `mobile/src/lib/anchors.ts`; `useFocusedFetch<T>(fetcher)` from `mobile/src/lib/useFocusedFetch.ts`; `patch`
  (accepts an updater) from `usePlanDraft()`.
- Produces:
  - `cityMatches(city: string | null, destination: string): boolean`
  - `groupByCity(places: SavedPlace[]): { city: string; places: SavedPlace[] }[]`
  - `toAnchor(p: SavedPlace): Anchor`

- [ ] **Step 1: Write the failing tests**

  Create `mobile/src/lib/savedPlaces.test.ts`:

  ```ts
  import { cityMatches, groupByCity, toAnchor } from './savedPlaces';

  const sp = (name: string, city: string | null, source = 'screenshot') =>
    ({ id: name, name, lat: null, lng: null, city, source, url: null, createdAt: '2026-09-25T00:00:00.000Z' }) as never;

  describe('cityMatches', () => {
    it('matches on the part before the first comma, case-insensitively', () => {
      expect(cityMatches('Kyoto, Japan', 'kyoto')).toBe(true);
      expect(cityMatches('Kyoto, Japan', 'Kyoto, Japan')).toBe(true);
      expect(cityMatches('Kyoto', 'Kyoto, Kyoto Prefecture, Japan')).toBe(true);
    });
    it('does not match a different city or a missing one', () => {
      expect(cityMatches('Kyoto, Japan', 'Tokyo')).toBe(false);
      expect(cityMatches(null, 'Kyoto')).toBe(false);
      expect(cityMatches('Kyoto, Japan', '')).toBe(false);
    });
  });

  describe('groupByCity', () => {
    it('groups by city, puts "Somewhere" last, and leaves instagram reminders out of place groups', () => {
      const groups = groupByCity([sp('A', 'Kyoto, Japan'), sp('B', null), sp('C', 'Kyoto, Japan'), sp('IG', null, 'instagram')]);
      expect(groups.map((g) => [g.city, g.places.map((p) => p.name)])).toEqual([
        ['Kyoto, Japan', ['A', 'C']],
        ['Somewhere', ['B']],
      ]);
    });
  });

  it('toAnchor makes a want anchor from an import source', () => {
    expect(toAnchor(sp('A', 'Kyoto'))).toEqual({ name: 'A', lat: null, lng: null, priority: 'want', source: 'import' });
  });
  ```

- [ ] **Step 2: Run the tests and confirm they fail**

  Run: `cd /Users/zaidshaikh/GitHub/tripmate/.worktrees/react-native-app/mobile && npx jest src/lib/savedPlaces.test.ts`

  Expected: FAIL, module not found.

- [ ] **Step 3: Implement `mobile/src/lib/savedPlaces.ts`**

  ```ts
  import type { Anchor, SavedPlace } from '@/api/types';

  const cityPart = (s: string) => s.split(',')[0].trim().toLowerCase();

  /** "Kyoto" matches places saved under "Kyoto, Japan". The part before the first comma is the city. */
  export function cityMatches(city: string | null, destination: string): boolean {
    if (!city || !destination.trim()) return false;
    return cityPart(city) === cityPart(destination);
  }

  /** Places by city for the saved-places section. Instagram reminders are listed separately. */
  export function groupByCity(places: SavedPlace[]): { city: string; places: SavedPlace[] }[] {
    const groups = new Map<string, SavedPlace[]>();
    for (const p of places) {
      if (p.source === 'instagram') continue;
      const key = p.city ?? 'Somewhere';
      groups.set(key, [...(groups.get(key) ?? []), p]);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => (a === 'Somewhere' ? 1 : b === 'Somewhere' ? -1 : 0))
      .map(([city, list]) => ({ city, places: list }));
  }

  export function toAnchor(p: SavedPlace): Anchor {
    return { name: p.name, lat: p.lat, lng: p.lng, priority: 'want', source: 'import' };
  }
  ```

- [ ] **Step 4: Run the tests and confirm they pass**

  Run: `cd /Users/zaidshaikh/GitHub/tripmate/.worktrees/react-native-app/mobile && npx jest src/lib/savedPlaces.test.ts`

  Expected: PASS.

- [ ] **Step 5: Add the section to `basics.tsx`**

  Add a `SavedPlacesSection` component in the same file, rendered directly above `<ImportSection`, with this
  behaviour:

  ```tsx
  function SavedPlacesSection({
    destination,
    anchors,
    onAnchorsChange,
  }: {
    destination: string;
    anchors: Anchor[];
    onAnchorsChange: (update: (prev: Anchor[]) => Anchor[]) => void;
  }) {
    const saved = useFocusedFetch(listSavedPlaces);
    const places = saved ?? [];
    // Pre-select the places saved for this destination, once per destination change.
    useEffect(() => {
      const matches = places.filter((p) => p.source !== 'instagram' && cityMatches(p.city, destination));
      if (matches.length) onAnchorsChange((prev) => mergeAnchors(prev, matches.map(toAnchor)));
      // eslint-disable-next-line react-hooks/exhaustive-deps -- run on destination/list change only
    }, [destination, saved]);
    if (places.length === 0) return null;
    const chosen = new Set(anchors.map((a) => anchorKey(a.name)));
    const reminders = places.filter((p) => p.source === 'instagram');
    return (
      <View style={styles.saved}>
        <ThemedText type="label">Your saved places ({places.length - reminders.length})</ThemedText>
        {groupByCity(places).map((g) => (
          <View key={g.city} style={styles.savedGroup}>
            <ThemedText themeColor="muted">{g.city}</ThemedText>
            <View style={styles.chips}>
              {g.places.map((p) => {
                const on = chosen.has(anchorKey(p.name));
                return (
                  <Pressable
                    key={p.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${on ? 'Remove' : 'Add'} ${p.name}`}
                    onPress={() =>
                      onAnchorsChange((prev) =>
                        on ? prev.filter((a) => anchorKey(a.name) !== anchorKey(p.name)) : mergeAnchors(prev, [toAnchor(p)])
                      )
                    }
                    style={[styles.chip, on && styles.chipOn]}
                  >
                    <ThemedText>{p.name}</ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
        {reminders.map((r) => (
          <Pressable key={r.id} accessibilityRole="link" onPress={() => r.url && Linking.openURL(r.url)}>
            <ThemedText themeColor="muted">Instagram post: screenshot it to add places</ThemedText>
          </Pressable>
        ))}
      </View>
    );
  }
  ```

  - **Imports:** `useEffect`, `View`, `Pressable`, and `Linking` from react-native; `listSavedPlaces`;
    `cityMatches`, `groupByCity`, `toAnchor` from `@/lib/savedPlaces`; `anchorKey` from `@/lib/anchors`.
  - **Styles:** reuse the chip styles `ImportSection` already uses, and add only `saved`, `savedGroup` and `chipOn`
    if they're missing.
  - **Props and ESLint:** check `ThemedText`'s real `type` values. If `useFocusedFetch`'s signature differs from
    `(fetcher) => T | undefined`, adapt. If ESLint refuses the disable comment, depend on `[destination, saved]` and
    wrap `onAnchorsChange` at the call site with `useCallback`.
  - **Render:** `<SavedPlacesSection destination={destination} anchors={draft.anchors} onAnchorsChange={(update) => patch((prev) => ({ anchors: update(prev.anchors) }))} />`

- [ ] **Step 6: Gates, simulator check, docs, commit**

  1. Run: `cd /Users/zaidshaikh/GitHub/tripmate/.worktrees/react-native-app/mobile && npx jest && npx tsc --noEmit && npx expo lint`
  2. In the simulator, after Task 5's share: open Plan a trip. "Your saved places (N)" lists the shared places under
     their city. Typing that city's name as the destination pre-selects them into the chips below.
  3. Add a row to `docs/frontend.md`: mobile Share to TripMate plus the saved places on the basics step. Since
     2026-09-25, Developer Claude.
  4. Commit:

  ```bash
  cd /Users/zaidshaikh/GitHub/tripmate/.worktrees/react-native-app && git add mobile/src/lib/savedPlaces.ts mobile/src/lib/savedPlaces.test.ts mobile/src/app/plan/basics.tsx docs/frontend.md && git commit -m "Offer saved places when planning their city"
  ```

---

### Task 7: Reels, with frames pulled on the phone

**Files:**
- Modify: `mobile/src/app/share.tsx` (add frames to the items)

**Interfaces:**
- Consumes: `plan.videoFrames` (Task 4); `VideoThumbnails.getThumbnailAsync(uri, { time, quality })` from
  `expo-video-thumbnails`, which returns `{ uri }`.

- [ ] **Step 1: Read the frames into image items**

  In the item-building effect in `share.tsx`, after the image loop, add:

  ```tsx
  for (const v of plan.videoFrames) {
    for (const t of v.times) {
      try {
        const { uri } = await VideoThumbnails.getThumbnailAsync(v.path, { time: t * 1000, quality: 0.5 });
        images.push({ kind: 'image', mediaType: 'image/jpeg', data: await readAsStringAsync(uri, { encoding: 'base64' }) });
      } catch {
        // Past the end of an unknown-duration video, or an unreadable frame — skipped.
      }
    }
  }
  ```

  Add `import * as VideoThumbnails from 'expo-video-thumbnails';`. Frames exist only as temp files plus the base64 in
  memory. They're never saved, per the spec.

- [ ] **Step 2: Gates, and a simulator check**

  1. Run: `cd /Users/zaidshaikh/GitHub/tripmate/.worktrees/react-native-app/mobile && npx tsc --noEmit && npx expo lint && npx jest`
  2. In the simulator, drag a short `.mov`/`.mp4` with a place name visible on screen onto the simulator window (it
     lands in Photos), then share it to TripMate. Expected: "Found … places …", or "Couldn't find places in this
     video." for a clip with no names.
  3. **Rebuild before testing:** `expo-video-thumbnails` is native, so run `npx expo run:ios` first.

- [ ] **Step 3: Commit**

  ```bash
  cd /Users/zaidshaikh/GitHub/tripmate/.worktrees/react-native-app && git add mobile/src/app/share.tsx && git commit -m "Read the places a reel shows on screen"
  ```

---

### Task 8: Saved places on the web wizard

**Files:**
- Modify: `src/components/ImportDropZone.tsx`

**Interfaces:**
- Consumes: `GET /api/saved-places` (Task 3); the existing `onAnchorsChange(update)` prop and `anchorKey` import.

- [ ] **Step 1: Add the list above the drop zone**

  In `ImportDropZone`, load the saved places once on mount, and render them above the drop label as chips that toggle
  into `anchors`:

  ```tsx
  const [saved, setSaved] = useState<{ id: string; name: string; lat: number | null; lng: number | null; city: string | null; source: string }[]>([]);
  useEffect(() => {
    fetch("/api/saved-places")
      .then((r) => (r.ok ? r.json() : { places: [] }))
      .then((j) => setSaved((j.places ?? []).filter((p: { source: string }) => p.source !== "instagram")))
      .catch(() => setSaved([]));
  }, []);
  const chosen = new Set(anchors.map((a) => anchorKey(a.name)));
  ```

  ```tsx
  {saved.length > 0 && (
    <div className="mb-3">
      <p className="text-sm text-muted">Your saved places ({saved.length})</p>
      <ul className="mt-2 flex flex-wrap gap-2" aria-label="Your saved places">
        {saved.map((p) => {
          const on = chosen.has(anchorKey(p.name));
          return (
            <li key={p.id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() =>
                  onAnchorsChange((prev) =>
                    on
                      ? prev.filter((a) => anchorKey(a.name) !== anchorKey(p.name))
                      : [...prev, { name: p.name, lat: p.lat, lng: p.lng, priority: "want", source: "import" }]
                  )
                }
                className="rounded-full bg-white/10 px-3 py-1 text-sm"
              >
                {p.name}
                {p.city ? <span className="text-muted"> · {p.city.split(",")[0]}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  )}
  ```

  Reuse the chip classes this file's existing anchors chips use, instead of the placeholder classes above. Add
  `useEffect` to the React import.

- [ ] **Step 2: Gates, a browser check, and commit**

  1. Run: `cd /Users/zaidshaikh/GitHub/tripmate/.worktrees/react-native-app && npm test && npx tsc --noEmit -p tsconfig.json && npm run lint`
  2. In the browser preview: POST one place through the Task 3 curl, using the browser's own cookie via
     `javascript_tool` `fetch("/api/saved-places", {method:"POST", …})`. Reload the wizard. The chip shows, and
     clicking it adds it to "Your places".
  3. Commit:

  ```bash
  git add src/components/ImportDropZone.tsx && git commit -m "Show saved places in the web wizard too"
  ```

---

### Task 9: End to end, and Android

- [ ] **Step 1: The full gates**

  Run:
  - `cd /Users/zaidshaikh/GitHub/tripmate/.worktrees/react-native-app && npm test && npx tsc --noEmit -p tsconfig.json && npm run lint && npm run build`
  - `cd mobile && npx jest && npx tsc --noEmit && npx expo lint`

  Expected: all green.

- [ ] **Step 2: The iOS simulator end-to-end pass**

  1. Share one screenshot from Photos → TripMate. The places are saved.
  2. Share an instagram.com page from Safari. The reminder is saved.
  3. Share one video. The frames are read.
  4. Open Plan a trip. The saved places are grouped by city, and the destination pre-selects them.
  5. Take one screenshot of each screen.

- [ ] **Step 3: Android**

  Run `ls ~/Library/Android/sdk`.
  - **If the SDK exists:** `npx expo run:android`, then repeat step 2 on the emulator with its Photos and Chrome apps.
  - **If it doesn't:** record "Android unverified at runtime: no SDK on this machine" in the spec's spike section, and
    confirm that `npx expo prebuild --platform android --no-install` generates an `AndroidManifest.xml` containing
    `android.intent.action.SEND` for `image/*`, `video/*` and `text/*`. Check it with
    `grep -n "action.SEND" android/app/src/main/AndroidManifest.xml`, then delete the generated `android/` folder,
    which is git-ignored anyway.

- [ ] **Step 4: Report**

  Summarise:
  - what shipped;
  - the spike result;
  - whether Android ran at runtime;
  - the one real-iPhone check left for Zaid: Instagram → Download → Photos → Share → TripMate.
