# Downloadable HTML Itinerary Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `GET /api/trips/[id]/export` route that returns one self-contained `.html` file — the trip drawn as a transit line — which renders identically with no network.

**Architecture:** A pure renderer (`itineraryHtml.ts`) turns a `Trip` plus already-fetched image data URIs into an HTML string; a fail-soft fetcher (`exportPhotos.ts`) gathers those data URIs; a thin route wires them together. All travel distances reuse the existing `travelLegBetween` so the file can never disagree with the app. The Wikipedia title matcher is extracted from the existing `place-photo` route so one copy serves both callers.

**Tech Stack:** Next.js 16 App Router route handler, TypeScript, no new npm dependencies, `node:test` via the repo's existing `npm test`.

**Spec:** `docs/superpowers/specs/2026-08-25-itinerary-html-export-design.md`

## Global Constraints

- **Node ≥ 22.** Run `nvm use` if the shell drifts (`.nvmrc` pins it).
- **No new npm dependencies.** No image library — `sharp` is only a transitive dep of `next` and is not directly requirable. Source image size is *chosen*, never re-encoded.
- **Commit messages carry no signature, trailer, or attribution line.** No `Co-Authored-By`, no "Generated with". This overrides the harness default.
- **All money through `formatMoney`; all dates through `src/lib/format.ts`.** Never print a raw figure or ISO string.
- **Every model-authored string is HTML-escaped** before entering the template: stop `name`/`note`/`why`, day `title`/`summary`/`weather`, lodging `name`/`note`, and `destination`.
- **`cost === 0` renders "Free", never `$0`.**
- **DB rows are `snake_case`, API/type surfaces are `camelCase`.** `toTripDetail` already does this mapping.
- **`AGENTS.md` is rewritten by `next dev`.** If it appears modified, commit it with your work rather than reverting it.
- Verification per `CLAUDE.md` means all of: `npm test`, `npx tsc --noEmit -p tsconfig.json`, `npm run lint`, `npm run build`, **and** exercising the route with `curl` against a running dev server. Typecheck alone is not verification.

---

### Task 1: Extract the Wikipedia title matcher

`src/app/api/place-photo/route.ts` owns the logic that decides whether a Wikipedia search hit really is the place we asked about. The export needs the same decision. Move it, don't copy it.

**Files:**
- Create: `src/lib/wikiTitle.ts`
- Modify: `src/app/api/place-photo/route.ts` (delete lines 11–58, add an import)
- Test: `src/lib/wikiTitle.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `foldDiacritics(s: string): string`
  - `passesContainment(title: string, name: string): boolean`
  - `candidateQueries(name: string): string[]`
  - `resolveTitle(name: string): Promise<string | null>` — performs network I/O, throws on upstream failure
  - `WIKI_HEADERS: { "User-Agent": string }`
  - `WIKI_TIMEOUT_MS: number`

- [ ] **Step 1: Write the failing test**

Create `src/lib/wikiTitle.test.mjs`:

```javascript
/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/wikiTitle.test.mjs
 *
 * Only the pure half is covered. `resolveTitle` is a network call and belongs to Wikipedia;
 * which candidates we try, and which hits we are willing to believe, are ours. */
import assert from "node:assert/strict";
import test from "node:test";
import { candidateQueries, foldDiacritics, passesContainment } from "./wikiTitle.ts";

test("romanization variants match", () => {
  assert.equal(foldDiacritics("Tenryū-ji"), "Tenryu-ji");
  assert.equal(foldDiacritics("Zürich"), "Zurich");
  assert.equal(foldDiacritics("Grossmünster"), "Grossmunster");
});

test("a real landmark passes containment, an unrelated hit does not", () => {
  assert.equal(passesContainment("Colosseum", "Colosseum & Roman Forum (Skip-the-Line Tour)"), true);
  assert.equal(passesContainment("Kyoto Station", "Lunch at Kyoto Station area"), true);
  // The failure this check exists to stop: a generic phrase whose top hit is a real article
  // about something else entirely.
  assert.equal(passesContainment("Lunch", "Lunch in Altstadt neighborhood"), true);
  assert.equal(passesContainment("Швейцария", "Lunch in Altstadt neighborhood"), false);
});

test("a parenthetical suffix is stripped from the title before comparing", () => {
  assert.equal(passesContainment("Uetliberg (mountain)", "Uetliberg summit exploration"), true);
});

test("candidates narrow from the full name down to the landmark", () => {
  assert.deepEqual(candidateQueries("Colosseum & Roman Forum (Skip-the-Line Tour)"), [
    "Colosseum & Roman Forum (Skip-the-Line Tour)",
    "Colosseum & Roman Forum",
    "Colosseum",
  ]);
});

test("a plain name yields exactly one candidate", () => {
  assert.deepEqual(candidateQueries("Kunsthaus Zurich"), ["Kunsthaus Zurich"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --test-name-pattern="romanization"
```

Expected: FAIL — `Cannot find module './wikiTitle.ts'`.

- [ ] **Step 3: Create the module**

Create `src/lib/wikiTitle.ts` by moving lines 3–58 of `src/app/api/place-photo/route.ts` verbatim, exporting what was private, and keeping every existing comment:

```typescript
/**
 * Resolving a stop's free-text name to a Wikipedia article title.
 *
 * Extracted from `src/app/api/place-photo/route.ts` when the HTML export needed the same
 * decision. Two copies of a containment rule is one copy too many: they drift, and the drift
 * shows up as one surface finding a photo the other refuses.
 */
export const WIKI_HEADERS = { "User-Agent": "TripMate/1.0 (personal project)" };

/** Wall-clock cap on each outbound call. Without a signal, undici lets a hung upstream sit for
 *  ~5 minutes and the request that triggered it hangs with it — the literal "the page is stuck"
 *  failure. An abort throws, which is the same shape as any other network failure here, so it
 *  lands on the fail-soft path that already exists rather than adding a new error surface. */
export const WIKI_TIMEOUT_MS = 8_000;

// Strip diacritics so romanization variants match (e.g. "Tenryū-ji" vs. "Tenryu-ji").
export function foldDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

async function searchTitle(query: string): Promise<string | null> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
    query
  )}&format=json&srlimit=1`;
  const res = await fetch(url, {
    headers: WIKI_HEADERS,
    signal: AbortSignal.timeout(WIKI_TIMEOUT_MS),
  });
  // Upstream failure (commonly a rate limit) — throw rather than returning null, so the caller
  // can tell "lookup failed, retry later" apart from "this place genuinely has no photo".
  if (!res.ok) throw new Error(`wikipedia search ${res.status}`);
  const data = await res.json();
  return data.query?.search?.[0]?.title ?? null;
}

// Full-text search can surface an unrelated top hit for generic phrases (e.g. "Lunch
// at Kyoto Station area"). Only trust it when the resolved title is actually contained
// in the stop name — real landmark names pass this easily, unrelated matches don't.
export function passesContainment(title: string, name: string): boolean {
  const bareTitle = foldDiacritics(title.replace(/\s*\([^)]*\)$/, "").toLowerCase());
  return foldDiacritics(name.toLowerCase()).includes(bareTitle);
}

// The model's stop names are often a real landmark plus marketing/descriptive suffixes
// ("Colosseum & Roman Forum (Skip-the-Line Tour)"), which as a single search query dilute
// Wikipedia's full-text ranking away from the landmark's own article. Retry with
// progressively stripped-down queries — cheap, since each extra request only fires when
// the previous one already missed — before giving up. Containment is always checked
// against the full original name, not the stripped candidate, so a match on a shortened
// query still counts.
export function candidateQueries(name: string): string[] {
  const candidates = [name];
  const noParenthetical = name.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (noParenthetical !== name) candidates.push(noParenthetical);
  const beforeConjunction = noParenthetical.split(/\s+(?:&|and)\s+/i)[0].trim();
  if (beforeConjunction && beforeConjunction !== noParenthetical) candidates.push(beforeConjunction);
  return candidates;
}

export async function resolveTitle(name: string): Promise<string | null> {
  for (const query of candidateQueries(name)) {
    const title = await searchTitle(query);
    if (title && passesContainment(title, name)) return title;
  }
  return null;
}
```

**Note:** the original source writes the diacritic range as a literal combining-mark class. Use the escaped `[̀-ͯ]` form above — it is the same range and survives copy-paste.

- [ ] **Step 4: Rewrite the route to import it**

In `src/app/api/place-photo/route.ts`, delete the `HEADERS`, `FETCH_TIMEOUT_MS`, `foldDiacritics`, `searchTitle`, `passesContainment`, `candidateQueries` and `resolveTitle` declarations (lines 3–58), and replace them with:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { resolveTitle, WIKI_HEADERS, WIKI_TIMEOUT_MS } from "@/lib/wikiTitle";
```

Then inside `GET`, rename the two remaining uses: `HEADERS` → `WIKI_HEADERS`, `FETCH_TIMEOUT_MS` → `WIKI_TIMEOUT_MS`. Change nothing else — the handler's status codes and comments stay exactly as they are.

- [ ] **Step 5: Run tests and typecheck**

```bash
npm test -- --test-name-pattern="romanization|containment|candidates"
```

Expected: PASS, 5 tests.

```bash
npx tsc --noEmit -p tsconfig.json && npm run lint
```

Expected: both clean.

- [ ] **Step 6: Verify the route still works**

Start the dev server (`npm run dev`) in another shell, then:

```bash
curl -s "http://localhost:3000/api/place-photo?name=Kunsthaus%20Zurich" | head -c 300
```

Expected: JSON with a non-null `thumbnailUrl`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/wikiTitle.ts src/lib/wikiTitle.test.mjs src/app/api/place-photo/route.ts
git commit -m "Give the photo matcher one home, so two callers cannot disagree"
```

---

### Task 2: Export primitives — escaping, emoji, cost labels, legs

The four small decisions the renderer makes over and over. Pure, no I/O, all four already known to be wrong in some observable way if skipped.

**Files:**
- Create: `src/lib/export/exportPrimitives.ts`
- Test: `src/lib/export/exportPrimitives.test.mjs`

**Interfaces:**
- Consumes: `travelLegBetween` from `src/lib/travelTime.ts`; `formatMoney` from `src/lib/format.ts`; `Stop` and `TransportMode` from `src/lib/types.ts`.
- Produces:
  - `escapeHtml(value: string): string`
  - `stripEmoji(value: string): string`
  - `costLabel(cost: number): string`
  - `ExportLeg` = `{ mode: TransportMode; distanceKm: number; minutes: number }`
  - `dayLegs(stops: Stop[]): (ExportLeg | null)[]` — length `stops.length - 1`, index `i` is the hop from `stops[i]` to `stops[i+1]`, `null` where the hop is not worth drawing
  - `slugify(value: string): string`

- [ ] **Step 1: Write the failing test**

Create `src/lib/export/exportPrimitives.test.mjs`:

```javascript
/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/export/exportPrimitives.test.mjs
 *
 * Four decisions the exported file makes on every stop. Each one is here because the live data
 * already contains the case that gets it wrong: coincident coordinates, emoji in a model
 * summary, a free stop, and a stop name that is untrusted model output. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  costLabel,
  dayLegs,
  escapeHtml,
  slugify,
  stripEmoji,
} from "./exportPrimitives.ts";

const stop = (lat, lng, name = "x") => ({
  name,
  lat,
  lng,
  cost: 0,
  note: "",
  time: "9:00 AM",
  durationLabel: "1 hour",
  category: "other",
});

test("every HTML metacharacter is escaped", () => {
  assert.equal(
    escapeHtml(`<script>alert("x" & 'y')</script>`),
    "&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;"
  );
});

test("escaping is not double-applied to an already-escaped ampersand", () => {
  // & is escaped once. Running the result through again would give &amp;amp; — the caller must
  // escape exactly at the template boundary, and this documents the single-pass contract.
  assert.equal(escapeHtml("Fish & Chips"), "Fish &amp; Chips");
});

test("emoji are stripped from a real model summary", () => {
  assert.equal(
    stripEmoji("Medieval Altstadt history and Zurich West's scene. 🏛️🎨"),
    "Medieval Altstadt history and Zurich West's scene."
  );
  assert.equal(stripEmoji("Relaxed final morning, then departure. ✈️☀️"), "Relaxed final morning, then departure.");
});

test("stripping emoji leaves ordinary punctuation and accents alone", () => {
  assert.equal(stripEmoji("Zürich West — galleries, murals & rösti"), "Zürich West — galleries, murals & rösti");
});

test("a free stop says Free, never $0", () => {
  assert.equal(costLabel(0), "Free");
  assert.equal(costLabel(100), "$100");
});

test("coincident stops produce no leg at all", () => {
  // Live Zurich data: the tram stop, the summit and the mountain restaurant share one coordinate.
  const legs = dayLegs([stop(47.338, 8.487), stop(47.338, 8.487)]);
  assert.equal(legs.length, 1);
  assert.equal(legs[0], null, "a zero-distance hop must not render as '1 min walk'");
});

test("a real hop carries its computed mode, distance and minutes", () => {
  // Altstadt lunch -> Zurich West, the day-3 hop that the itinerary's own note calls "Tram 4 (10 mins)".
  const legs = dayLegs([stop(47.377, 8.53), stop(47.389, 8.516)]);
  assert.equal(legs.length, 1);
  assert.equal(legs[0].mode, "transit");
  assert.ok(legs[0].distanceKm > 1.5, `expected a transit-scale hop, got ${legs[0].distanceKm}km`);
  assert.ok(legs[0].minutes >= 1);
});

test("a short hop is a walk", () => {
  const legs = dayLegs([stop(47.377, 8.544), stop(47.373, 8.548)]);
  assert.equal(legs[0].mode, "walk");
});

test("legs are one shorter than stops, and an empty day has none", () => {
  assert.equal(dayLegs([stop(1, 1), stop(2, 2), stop(3, 3)]).length, 2);
  assert.equal(dayLegs([stop(1, 1)]).length, 0);
  assert.equal(dayLegs([]).length, 0);
});

test("the filename slug is ASCII and never empty", () => {
  assert.equal(slugify("Zürich"), "zurich");
  assert.equal(slugify("Val d'Orcia, Italy"), "val-d-orcia-italy");
  assert.equal(slugify("!!!"), "trip");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --test-name-pattern="HTML metacharacter"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/export/exportPrimitives.ts`:

```typescript
import { formatMoney } from "../format";
import { travelLegBetween } from "../travelTime";
import type { Stop, TransportMode } from "../types";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Single-pass escape, applied exactly once at the template boundary.
 *
 * Every string this file interpolates — stop names, notes, day summaries, lodging — is model
 * output, and the artifact is a file the traveler AirDrops to other people. Escaping at the
 * boundary rather than at the source is what makes "did this value get escaped?" answerable by
 * reading one function instead of auditing every call site.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** Pictographs, dingbats, and the variation selector that trails them. The model decorates day
 *  summaries ("...museum treasures. 🏛️🍽️") and they read as noise in a printed-feeling
 *  document. Deliberately narrow: accented Latin, em dashes and typographic quotes all survive. */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;

export function stripEmoji(value: string): string {
  return value.replace(EMOJI, "").replace(/\s+/g, " ").trim();
}

/** DESIGN.md: don't show a label for a value that isn't there. `Food $0 · Entry $0` was the
 *  shape of getting this wrong. */
export function costLabel(cost: number): string {
  return cost > 0 ? formatMoney(cost) : "Free";
}

export interface ExportLeg {
  mode: TransportMode;
  distanceKm: number;
  minutes: number;
}

/**
 * The hops between one day's stops, `null` where there is nothing worth drawing.
 *
 * Two details that bite. First, `travelLegBetween` takes `{ lat, lon }` while `Stop` carries
 * `lng` — the rename is the whole reason this adapter exists. Second, it floors `minutes` at 1,
 * so a pair of stops sharing a coordinate reports "1 min walk" rather than nothing; real
 * itineraries do this constantly (a hotel that appears twice, a summit whose three stops share
 * one point). Suppression therefore keys on the rounded distance, not on minutes.
 */
export function dayLegs(stops: Stop[]): (ExportLeg | null)[] {
  const legs: (ExportLeg | null)[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const leg = travelLegBetween(
      { lat: stops[i].lat, lon: stops[i].lng },
      { lat: stops[i + 1].lat, lon: stops[i + 1].lng }
    );
    legs.push(leg.distanceKm === 0 ? null : leg);
  }
  return legs;
}

/** ASCII-only, so it is safe in a `Content-Disposition` filename without RFC 5987 encoding. */
export function slugify(value: string): string {
  const out = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return out || "trip";
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --test-name-pattern="metacharacter|emoji|Free|coincident|computed mode|short hop|one shorter|slug"
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Typecheck and lint**

```bash
npx tsc --noEmit -p tsconfig.json && npm run lint
```

Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/export/exportPrimitives.ts src/lib/export/exportPrimitives.test.mjs
git commit -m "Teach the export the four things it gets wrong on real data"
```

---

### Task 3: The pure renderer

The whole document as one string. No fetch, no clock, no globals — which is what lets the test suite reach it.

**Files:**
- Create: `src/lib/export/itineraryHtml.ts`
- Test: `src/lib/export/itineraryHtml.test.mjs`

**Interfaces:**
- Consumes: everything Task 2 produces; `dayPlanned` from `src/lib/itinerary.ts`; `formatDateRange`, `formatDateWithWeekday`, `formatMoney` from `src/lib/format.ts`; `Trip`, `DayPlan` from `src/lib/types.ts`.
- Produces:
  - `ExportPhotos` = `{ cover: string | null; days: (string | null)[] }`
  - `ExportAssets` = `{ photos: ExportPhotos; fontDataUri: string | null }`
  - `renderItineraryHtml(trip: Trip, assets: ExportAssets): string`
  - `dayHeading(day: DayPlan, index: number): string`
  - `exportFilename(destination: string): string`

- [ ] **Step 1: Write the failing test**

Create `src/lib/export/itineraryHtml.test.mjs`:

```javascript
/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/export/itineraryHtml.test.mjs
 *
 * The renderer is pure by construction — no fetch, no clock, no globals — which is the only
 * reason a document this size is reachable from a test at all. What is covered: the invariants
 * a reader checks the file against (day figures summing to the trip figure), and the failures
 * that would ship silently (an unescaped stop name, a missing photo taking the page with it). */
import assert from "node:assert/strict";
import test from "node:test";
import { dayHeading, exportFilename, renderItineraryHtml } from "./itineraryHtml.ts";

const stop = (over = {}) => ({
  name: "Kunsthaus Zurich",
  lat: 47.378,
  lng: 8.555,
  cost: 0,
  note: "Free galleries on Wednesdays",
  why: "Rainy-day art without a ticket",
  time: "9:30 AM",
  durationLabel: "1.5 hours",
  category: "entry",
  ...over,
});

const trip = (over = {}) => ({
  id: "t1",
  destination: "Zurich, Switzerland",
  startDate: "2026-08-20",
  endDate: "2026-08-21",
  budget: 3500,
  itinerary: {
    tier: "luxury",
    days: [
      {
        date: "2026-08-20",
        weather: "Mixed (15-21°C)",
        summary: "Museums and markets. 🏛️🎨",
        lodging: { name: "Boutique hotel", cost: 350, note: "Altstadt" },
        stops: [stop(), stop({ name: "Lunch at Markthalle", cost: 100, lat: 47.377, lng: 8.53 })],
      },
      {
        date: "2026-08-21",
        weather: "Clear",
        stops: [stop({ name: "Lake Zurich", cost: 40 })],
      },
    ],
  },
  ...over,
});

const noAssets = { photos: { cover: null, days: [] }, fontDataUri: null };

test("the document is a complete standalone page", () => {
  const html = renderItineraryHtml(trip(), noAssets);
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<\/html>\s*$/);
  assert.match(html, /<meta name="viewport"/);
  // No external subresources: the file must render in airplane mode.
  assert.doesNotMatch(html, /<link[^>]+href="https?:/);
  assert.doesNotMatch(html, /<script[^>]+src=/);
});

test("every stop appears", () => {
  const html = renderItineraryHtml(trip(), noAssets);
  assert.ok(html.includes("Kunsthaus Zurich"));
  assert.ok(html.includes("Lunch at Markthalle"));
  assert.ok(html.includes("Lake Zurich"));
});

test("a stop name that is model output cannot execute", () => {
  const evil = trip();
  evil.itinerary.days[0].stops[0].name = `<script>alert(1)</script>`;
  const html = renderItineraryHtml(evil, noAssets);
  assert.ok(!html.includes("<script>alert(1)</script>"), "the raw tag must not survive");
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
});

test("day figures sum to the trip figure", () => {
  // The invariant the print page is built on, carried over: a document meant to be checked line
  // by line must not have day totals that fail to add up to its own header.
  const html = renderItineraryHtml(trip(), noAssets);
  // day 1 = 0 + 100 + 350 lodging = 450; day 2 = 40; trip = 490
  assert.ok(html.includes("$450"), "day 1 total");
  assert.ok(html.includes("$40"), "day 2 total");
  assert.ok(html.includes("$490"), "trip total");
});

test("emoji never reach the page", () => {
  const html = renderItineraryHtml(trip(), noAssets);
  assert.doesNotMatch(html, /\u{1F300}-\u{1FAFF}/u);
  assert.ok(html.includes("Museums and markets."));
});

test("a free stop reads Free and never $0", () => {
  const html = renderItineraryHtml(trip(), noAssets);
  assert.ok(html.includes("Free"));
  assert.ok(!/\$0\b/.test(html), "no bare $0 anywhere");
});

test("missing photos do not take the document with them", () => {
  const html = renderItineraryHtml(trip(), noAssets);
  assert.ok(html.includes("Kunsthaus Zurich"));
  assert.doesNotMatch(html, /<img[^>]+src=""/, "an absent photo renders no img at all");
});

test("a supplied cover is inlined as a data URI", () => {
  const html = renderItineraryHtml(trip(), {
    photos: { cover: "data:image/jpeg;base64,AAAA", days: [null, null] },
    fontDataUri: null,
  });
  assert.ok(html.includes('src="data:image/jpeg;base64,AAAA"'));
});

test("a day with no title falls back to its stripped summary, then to nothing", () => {
  const t = trip();
  assert.equal(dayHeading(t.itinerary.days[0], 0), "Museums and markets.");
  t.itinerary.days[0].title = "Rainy day";
  assert.equal(dayHeading(t.itinerary.days[0], 0), "Rainy day");
  // Day 2 has neither title nor summary.
  assert.equal(dayHeading(t.itinerary.days[1], 1), "Day 2");
});

test("a trip with a single day still renders", () => {
  const t = trip();
  t.itinerary.days = [t.itinerary.days[0]];
  const html = renderItineraryHtml(t, noAssets);
  assert.match(html, /^<!DOCTYPE html>/);
  assert.ok(html.includes("Kunsthaus Zurich"));
});

test("the filename is safe for a Content-Disposition header", () => {
  assert.equal(exportFilename("Zürich, Switzerland"), "zurich-itinerary.html");
  assert.equal(exportFilename("Val d'Orcia, Italy"), "val-d-orcia-itinerary.html");
});

test("the direction contract survives into the markup", () => {
  // Impeccable's contract must be auditable in the shipped artifact, not only in source.
  const html = renderItineraryHtml(trip(), noAssets);
  assert.ok(html.includes("THESIS:"), "the contract comment must be in the emitted body");
  assert.ok(html.includes("e57fcfdf"), "seed key");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --test-name-pattern="complete standalone page"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/export/itineraryHtml.ts`. Take the markup and CSS from the approved comp at `.impeccable/comps/comp-b-linemap.html` — that file is the design authority for this task; reproduce its type scale, trunk weight, node treatment and spacing rather than re-deriving them.

The module's shape:

```typescript
import { formatDateRange, formatDateWithWeekday, formatMoney } from "../format";
import { dayPlanned } from "../itinerary";
import type { DayPlan, Trip } from "../types";
import { costLabel, dayLegs, escapeHtml, slugify, stripEmoji } from "./exportPrimitives";

export interface ExportPhotos {
  cover: string | null;
  /** Index-aligned with `trip.itinerary.days`. A `null` entry renders a plain station node. */
  days: (string | null)[];
}

export interface ExportAssets {
  photos: ExportPhotos;
  /** A `data:font/woff2;base64,...` URI, or null to fall back to the system stack. */
  fontDataUri: string | null;
}

/** THESIS / OWN-WORLD / STORY / FIRST VIEWPORT / FORM / FINISH — see the design spec. Emitted as
 *  the first child of <body> so the contract is auditable in the shipped file, not only here. */
const DIRECTION_CONTRACT = `<!--
  THESIS: A day is a route, not a list. Refuses the itinerary-app default of stacked cards.
  OWN-WORLD: Transit-diagram grammar on #F5F7F7. 8px trunk in TripMate's own #0d2e37; stops are
    interchange nodes; #fb9826 marks only the active stop, per the app's reserved-accent rule.
  STORY: The traveler sees the trip as one line, taps into a day, and reads it like a metro map.
  FIRST VIEWPORT: Destination photo ~44svh, destination at clamp(3.2rem,17vw,5rem)/900, dates and
    budget beneath, then the trip line with one station per day.
  FORM: Route-as-spine, candidate 7 of 7, seed key e57fcfdf.
  FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the
    verdict, and DESIGN.md.
-->`;

export function dayHeading(day: DayPlan, index: number): string {
  if (day.title) return day.title;
  if (day.summary) {
    const stripped = stripEmoji(day.summary);
    if (stripped) return stripped;
  }
  return `Day ${index + 1}`;
}

export function exportFilename(destination: string): string {
  // `cityName`'s rule, matching ItineraryCard: the part before the first comma.
  return `${slugify(destination.split(",")[0].trim())}-itinerary.html`;
}

export function renderItineraryHtml(trip: Trip, assets: ExportAssets): string { /* ... */ }
```

`renderItineraryHtml` composes, in order:

1. `<!DOCTYPE html>`, `<html lang="en">`, `<head>` with charset, `viewport` including `viewport-fit=cover`, and `<title>{destination} — TripMate</title>`.
2. `<style>` — the comp's CSS verbatim, prefixed with an `@font-face` block **only when** `assets.fontDataUri` is non-null:
   ```
   @font-face{font-family:Archivo;src:url(<uri>) format('woff2');font-weight:100 900;font-display:swap}
   ```
   The `body` rule's stack is always `Archivo, ui-sans-serif, system-ui, sans-serif`, so a null font degrades to the system stack with no other change.
3. `<body>`, `DIRECTION_CONTRACT` as its first child.
4. Cover: `<img src="{photos.cover}">` **only when non-null**, then `<h1>` with the city name, `formatDateRange(startDate, endDate)`, day and stop counts, and the budget line using `formatMoney`.
5. The trip line: one `.st` station per day, `data-date="{day.date}"`, carrying the day number and a short weekday+day label from `formatDateWithWeekday`. Where `photos.days[i]` is non-null, the station renders the thumb; otherwise the plain node.
6. One `<details class="day" data-date="{day.date}">` per day: `<summary>` with the number, `dayHeading`, `formatDateWithWeekday(day.date)`, stop count and `formatMoney(dayPlanned(day))`; then the body with the weather pill, the stripped summary, the `<ol class="route">`, the lodging block when `day.lodging` exists, and the day total.
7. Inside the route: for each stop, the time, name, `{durationLabel} · {costLabel(cost)}`, then `why` and `note` when present. Between stops `i` and `i+1`, render the leg pill only when `dayLegs(stops)[i]` is non-null, reading `{minutes} min {mode === "transit" ? "tram" : mode} · {distanceKm} km`.
8. The runtime script from Task 4 (leave a `__RUNTIME__` placeholder for now; Task 4 fills it).
9. `</body></html>`.

**Every** interpolated model string goes through `escapeHtml`. Every figure goes through `formatMoney` or `costLabel`. Every date goes through `format.ts`.

The trip total is `days.reduce((sum, d) => sum + dayPlanned(d), 0)`, and `flightCostUsd` — when present — is stated as its own separate term beside that total, never folded into it.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --test-name-pattern="standalone page|every stop|cannot execute|sum to the trip|emoji never|reads Free|Missing photos|data URI|falls back|single day|Content-Disposition|direction contract"
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Typecheck and lint**

```bash
npx tsc --noEmit -p tsconfig.json && npm run lint
```

Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/export/itineraryHtml.ts src/lib/export/itineraryHtml.test.mjs
git commit -m "Draw the trip as a line, in one string with no I/O in it"
```

---

### Task 4: The offline runtime

Twenty-odd lines of vanilla JS. Everything it does must still be *readable* with JS switched off, which is why days are `<details>` and not divs.

**Files:**
- Modify: `src/lib/export/itineraryHtml.ts` (replace the `__RUNTIME__` placeholder)
- Modify: `src/lib/export/itineraryHtml.test.mjs` (add cases)

**Interfaces:**
- Consumes: `renderItineraryHtml` from Task 3.
- Produces: no new exports. The emitted document gains a `<script>` and stops gain `data-stop` attributes.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/export/itineraryHtml.test.mjs`:

```javascript
test("the runtime is inline and self-contained", () => {
  const html = renderItineraryHtml(trip(), noAssets);
  assert.ok(html.includes("<script>"), "a runtime must be present");
  assert.doesNotMatch(html, /<script[^>]+src=/, "never an external script");
});

test("days and stops carry the attributes the runtime keys on", () => {
  const html = renderItineraryHtml(trip(), noAssets);
  assert.ok(html.includes('data-date="2026-08-20"'), "days are addressable by date");
  assert.ok(html.includes('data-stop="0:0"'), "stops are addressable by day and index");
  assert.ok(html.includes('data-trip="t1"'), "storage is namespaced per trip");
});

test("the runtime compares calendar dates as strings, never by parsing them", () => {
  // The repo's standing date trap: new Date("2026-08-20") is UTC midnight, and local accessors
  // roll it back a day west of Greenwich. Building today's key from local parts and comparing
  // strings sidesteps parsing entirely.
  const html = renderItineraryHtml(trip(), noAssets);
  assert.doesNotMatch(html, /new Date\(\s*[a-zA-Z_$][\w$]*\.dataset/, "must not parse a day's date");
  assert.ok(html.includes("getFullYear()"), "today's key is built from local parts");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --test-name-pattern="runtime is inline"
```

Expected: FAIL — no `<script>` in the output.

- [ ] **Step 3: Implement the runtime**

In `itineraryHtml.ts`, define the constant and interpolate it where `__RUNTIME__` was:

```typescript
/**
 * The whole client. It does two things and neither is load-bearing: without it the file is still
 * a complete, readable itinerary, because days are native <details> and check-off is additive.
 *
 * Dates are compared as strings. `new Date("2026-08-20")` parses as UTC midnight and formatting
 * it with local accessors rolls it back a day anywhere west of Greenwich — the trap that has
 * already put a wrong weekday into generated output. Building today's key from local parts and
 * doing a string compare never constructs a Date from the data at all.
 */
const RUNTIME = `<script>
(function(){
  var pad = function(n){ return n < 10 ? "0" + n : "" + n; };
  var now = new Date();
  var today = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());

  var days = document.querySelectorAll("details.day");
  for (var i = 0; i < days.length; i++) {
    if (days[i].dataset.date === today) {
      days[i].open = true;
      days[i].scrollIntoView({ block: "start" });
    }
  }

  var trip = document.body.dataset.trip;
  var key = "tripmate:" + trip + ":done";
  var done = {};
  try { done = JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) { done = {}; }

  var stops = document.querySelectorAll("[data-stop]");
  for (var j = 0; j < stops.length; j++) {
    (function (el) {
      var id = el.dataset.stop;
      if (done[id]) el.classList.add("done");
      el.addEventListener("click", function () {
        if (done[id]) { delete done[id]; el.classList.remove("done"); }
        else { done[id] = 1; el.classList.add("done"); }
        try { localStorage.setItem(key, JSON.stringify(done)); } catch (e) {}
      });
    })(stops[j]);
  }
})();
</script>`;
```

Then:
- add `data-trip="{escapeHtml(trip.id)}"` to `<body>`;
- add `data-date="{day.date}"` to each `<details class="day">` and each `.st` station;
- add `data-stop="{dayIndex}:{stopIndex}"` to each `<li class="stop">`;
- add the `.done` styling to the CSS — the node fills solid and the name takes `opacity:.55`, no strikethrough (a struck-out line at 0.875rem on a phone in sun is unreadable):
  ```css
  .stop.done .sname{opacity:.55}
  .stop.done::before{background:var(--deep)}
  .stop[data-stop]{cursor:pointer}
  ```
- add one line of copy under the trip line so the behaviour is not a surprise: `Ticking a stop is saved on this phone only — it doesn't reach the app.`

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --test-name-pattern="runtime is inline|attributes the runtime|calendar dates as strings"
```

Expected: PASS, 3 tests. Then the whole suite:

```bash
npm test
```

Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/lib/export/itineraryHtml.ts src/lib/export/itineraryHtml.test.mjs
git commit -m "Open today's day on load, and let a stop be ticked off"
```

---

### Task 5: Fail-soft photo collection

Network work, isolated from the renderer so the renderer stays pure.

**Files:**
- Create: `src/lib/export/exportPhotos.ts`
- Test: `src/lib/export/exportPhotos.test.mjs`

**Interfaces:**
- Consumes: `resolveTitle`, `WIKI_HEADERS`, `WIKI_TIMEOUT_MS` from Task 1; `ExportPhotos` from Task 3.
- Produces: `collectExportPhotos(trip: Trip): Promise<ExportPhotos>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/export/exportPhotos.test.mjs`:

```javascript
/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/export/exportPhotos.test.mjs
 *
 * Only the budget arithmetic and the fail-soft contract are covered — the fetching itself is
 * Wikipedia's. What matters here is that no failure mode can take the export down with it. */
import assert from "node:assert/strict";
import test from "node:test";
import { withinBudget, MAX_IMAGE_BYTES, MAX_TOTAL_BYTES } from "./exportPhotos.ts";

test("an oversized single image is refused", () => {
  assert.equal(withinBudget(MAX_IMAGE_BYTES + 1, 0), false);
  assert.equal(withinBudget(MAX_IMAGE_BYTES, 0), true);
});

test("images are refused once the running total is spent", () => {
  assert.equal(withinBudget(1000, MAX_TOTAL_BYTES), false);
  assert.equal(withinBudget(1000, MAX_TOTAL_BYTES - 1000), true);
});

test("the caps leave room for a cover plus a week of thumbs", () => {
  // Measured against the saved Zurich trip: cover ~233KB, day thumbs ~27KB mean.
  assert.ok(MAX_TOTAL_BYTES > 233_000 + 27_000 * 7, "a 7-day trip must fit comfortably");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --test-name-pattern="oversized single image"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/export/exportPhotos.ts`:

```typescript
import { resolveTitle, WIKI_HEADERS, WIKI_TIMEOUT_MS } from "../wikiTitle";
import type { Trip } from "../types";
import type { ExportPhotos } from "./itineraryHtml";

/** A single image this large is a mistake, not a photo — skip it rather than bloat the file. */
export const MAX_IMAGE_BYTES = 400_000;
/** Whole-file ceiling on inlined imagery. A trip long enough to exceed it loses day thumbs from
 *  the tail; the cover is fetched first and is never the thing dropped. */
export const MAX_TOTAL_BYTES = 1_200_000;

export function withinBudget(bytes: number, spent: number): boolean {
  return bytes <= MAX_IMAGE_BYTES && spent + bytes <= MAX_TOTAL_BYTES;
}

interface Summary {
  thumbnail?: { source?: string };
  originalimage?: { source?: string };
}

async function summaryFor(name: string): Promise<Summary | null> {
  const title = await resolveTitle(name);
  if (!title) return null;
  const res = await fetch(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
    { headers: WIKI_HEADERS, signal: AbortSignal.timeout(WIKI_TIMEOUT_MS) }
  );
  if (!res.ok) throw new Error(`wikipedia summary ${res.status}`);
  return (await res.json()) as Summary;
}

async function toDataUri(url: string, budget: { spent: number }): Promise<string | null> {
  const res = await fetch(url, { headers: WIKI_HEADERS, signal: AbortSignal.timeout(WIKI_TIMEOUT_MS) });
  if (!res.ok) return null;
  const type = res.headers.get("content-type") ?? "image/jpeg";
  if (!type.startsWith("image/")) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!withinBudget(bytes.length, budget.spent)) return null;
  budget.spent += bytes.length;
  return `data:${type};base64,${bytes.toString("base64")}`;
}

/**
 * Wikimedia rejects an arbitrary thumbnail width with a 400 — measured on
 * `Altstadt_Zürich_2015.jpg`, every one of 640/800/1024/1200 fails and only 1280 succeeds,
 * because the permitted widths are per-file. `Special:FilePath?width=` resizes server-side and
 * snaps to the nearest rendered size, so it is the only safe way to ask for a specific scale.
 * Never hand-build a `/thumb/.../<w>px-` URL.
 */
function filePathUrl(originalUrl: string, width: number): string | null {
  const file = originalUrl.split("/").pop();
  if (!file) return null;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${file}?width=${width}`;
}

/**
 * Every slot degrades to null independently. A photo miss is the expected case, not an error:
 * the chosen design renders a plain station node where a thumb is absent, which is exactly why
 * a per-stop photo grid was rejected — its holes were visible and these are not.
 */
export async function collectExportPhotos(trip: Trip): Promise<ExportPhotos> {
  const budget = { spent: 0 };
  const days = trip.itinerary.days;

  let cover: string | null = null;
  try {
    const s = await summaryFor(trip.destination.split(",")[0].trim());
    const original = s?.originalimage?.source;
    const url = original ? filePathUrl(original, 1080) : null;
    cover = (url && (await toDataUri(url, budget))) || null;
    if (!cover && s?.thumbnail?.source) cover = await toDataUri(s.thumbnail.source, budget);
  } catch {
    cover = null;
  }

  const dayPhotos: (string | null)[] = [];
  for (const day of days) {
    let thumb: string | null = null;
    // The first stop whose name Wikipedia actually recognises. Generic stops ("Lunch in Altstadt
    // neighborhood") correctly resolve to nothing, so this walks past them.
    for (const stop of day.stops) {
      try {
        const s = await summaryFor(stop.name);
        const src = s?.thumbnail?.source;
        if (src) {
          thumb = await toDataUri(src, budget);
          if (thumb) break;
        }
      } catch {
        // Upstream hiccup on one stop must not cost the day its photo — try the next stop.
      }
    }
    dayPhotos.push(thumb);
  }

  return { cover, days: dayPhotos };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --test-name-pattern="oversized single image|running total is spent|week of thumbs"
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Typecheck and lint**

```bash
npx tsc --noEmit -p tsconfig.json && npm run lint
```

Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/export/exportPhotos.ts src/lib/export/exportPhotos.test.mjs
git commit -m "Gather what photos exist, and shrug off the ones that do not"
```

---

### Task 6: Vendor the Archivo subset

`next/font/google` self-hosts at build time and leaves nothing on disk to read, so the woff2 has to be committed.

**Files:**
- Create: `public/fonts/archivo-latin-var.woff2`
- Create: `src/lib/export/exportFont.ts`
- Modify: `README.md` (one line recording where the file came from)

**Interfaces:**
- Consumes: nothing.
- Produces: `loadExportFont(): Promise<string | null>` — a `data:font/woff2;base64,...` URI, or null.

- [ ] **Step 1: Fetch the font**

```bash
mkdir -p public/fonts
curl -sS -H "User-Agent: Mozilla/5.0" \
  "https://fonts.googleapis.com/css2?family=Archivo:wght@100..900&display=swap" \
  -o /tmp/archivo.css
grep -o "https://fonts.gstatic.com[^)]*\.woff2" /tmp/archivo.css | head -1
```

Take the **last** `@font-face` block's URL (the `latin` subset — the CSS emits subsets in order ending with `latin`), download it, and confirm the size:

```bash
curl -sS "$(grep -o 'https://fonts.gstatic.com[^)]*\.woff2' /tmp/archivo.css | tail -1)" \
  -o public/fonts/archivo-latin-var.woff2
ls -l public/fonts/archivo-latin-var.woff2
```

Expected: a file between 15KB and 60KB. If it exceeds 60KB you have the wrong subset — re-check which block you took.

- [ ] **Step 2: Write the loader**

Create `src/lib/export/exportFont.ts`:

```typescript
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Archivo reaches the app through `next/font/google`, which self-hosts at build time and leaves
 * no readable file on disk — so the export's copy is committed under `public/fonts/`.
 *
 * Worth the ~30KB against ~420KB of photos: every tracking value in DESIGN.md (-0.078em display,
 * -0.06em node labels) was tuned for this face, and the transit-diagram rendition leans on that
 * tightness. A null return degrades to the system stack rather than failing the export.
 */
let cached: string | null | undefined;

export async function loadExportFont(): Promise<string | null> {
  if (cached !== undefined) return cached;
  try {
    const file = path.join(process.cwd(), "public", "fonts", "archivo-latin-var.woff2");
    cached = `data:font/woff2;base64,${(await readFile(file)).toString("base64")}`;
  } catch {
    cached = null;
  }
  return cached;
}
```

- [ ] **Step 3: Verify it loads**

```bash
node --import ./scripts/ts-resolve.mjs -e "
  const { loadExportFont } = await import('./src/lib/export/exportFont.ts');
  const uri = await loadExportFont();
  console.log(uri ? 'loaded ' + (uri.length/1024).toFixed(0) + 'KB data URI' : 'NULL — file missing');
"
```

Expected: `loaded NNKB data URI`.

- [ ] **Step 4: Record the provenance**

Add to `README.md` under whatever setup section exists:

```markdown
`public/fonts/archivo-latin-var.woff2` is the latin subset of Archivo Variable, taken from
Google Fonts (OFL). The app itself loads Archivo through `next/font/google`; this committed copy
exists only so the downloadable HTML itinerary can inline the face and render offline.
```

- [ ] **Step 5: Commit**

```bash
git add public/fonts/archivo-latin-var.woff2 src/lib/export/exportFont.ts README.md
git commit -m "Commit the one font file the offline export cannot fetch for itself"
```

---

### Task 7: The export route

**Files:**
- Create: `src/app/api/trips/[id]/export/route.ts`

**Interfaces:**
- Consumes: `getTrip` (`src/lib/db.ts`), `toTripDetail` (`src/lib/tripPayload.ts`), and Tasks 3, 5, 6.
- Produces: `GET /api/trips/[id]/export`.

- [ ] **Step 1: Write the route**

Create `src/app/api/trips/[id]/export/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getTrip } from "@/lib/db";
import { collectExportPhotos } from "@/lib/export/exportPhotos";
import { loadExportFont } from "@/lib/export/exportFont";
import { exportFilename, renderItineraryHtml } from "@/lib/export/itineraryHtml";
import { toTripDetail } from "@/lib/tripPayload";

/**
 * The traveler's copy of one trip: a single self-contained .html file, drawn as a transit line,
 * that renders identically with no network.
 *
 * Distinct from `/trip/[id]/print`, which is a reviewer document — it labels every stop
 * "Day 2 · Stop 3" for bug reports and ends with critique questions. That route keeps its job.
 *
 * `force-dynamic` because the itinerary is edited in place and a cached export would hand the
 * traveler a plan they have already changed.
 */
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const row = getTrip(id);
  if (!row) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  const trip = toTripDetail(row);

  // Photos are the only failure surface here, and `collectExportPhotos` swallows its own — an
  // export with no imagery is a complete document, so there is no error path to add.
  const [photos, fontDataUri] = await Promise.all([collectExportPhotos(trip), loadExportFont()]);

  const html = renderItineraryHtml(trip, { photos, fontDataUri });

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(trip.destination)}"`,
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Step 2: Typecheck and lint**

```bash
npx tsc --noEmit -p tsconfig.json && npm run lint
```

Expected: both clean.

- [ ] **Step 3: Exercise it against a running server**

Start `npm run dev` in another shell. Get a real trip id:

```bash
sqlite3 tripmate.db "select id, destination from trips order by created_at desc limit 1;"
```

Then:

```bash
TRIP=$(sqlite3 tripmate.db "select id from trips order by created_at desc limit 1;")
curl -sS -D- -o /tmp/export.html "http://localhost:3000/api/trips/$TRIP/export" | head -6
ls -l /tmp/export.html
```

Expected: `200`, `Content-Type: text/html; charset=utf-8`, a `Content-Disposition` naming a slugged file, and a body between 100KB and 1.3MB.

- [ ] **Step 4: Prove it is genuinely offline**

```bash
grep -c 'src="http' /tmp/export.html || echo "0 external images"
grep -c '<link' /tmp/export.html || echo "0 stylesheets"
node -e "
  const h=require('fs').readFileSync('/tmp/export.html','utf8');
  const ext=[...h.matchAll(/(?:src|href)=\"(https?:[^\"]+)\"/g)].map(m=>m[1]);
  console.log(ext.length ? 'EXTERNAL REFS FOUND:\n'+ext.join('\n') : 'no external references — offline-safe');
"
```

Expected: `no external references — offline-safe`.

- [ ] **Step 5: Check a 404**

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/trips/nope/export"
```

Expected: `404`.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/trips/\[id\]/export/route.ts
git commit -m "Serve the trip as a file the traveler can keep"
```

---

### Task 8: The Download control

**Files:**
- Modify: `src/components/ItineraryCard.tsx` (the trip-level chrome around lines 527–557, beside `BudgetBar` and above `DayTabs`)

**Interfaces:**
- Consumes: the route from Task 7. `ItineraryCard` already receives `destination` (rendered as `cityName(destination)` at line 527) **and an optional `trip?: TripSummary`** (declared at line 111), so no new prop is needed.
- Produces: no new exports.

**Two facts already established — do not re-derive them:**

- `TripView.tsx` passes `trip={trip}` with the real saved row, so `trip?.id` is the trip id.
- `HomeView.tsx:2080` passes a **synthetic** `trip={{ id: "preview", destination, startDate, endDate, budget }}` for the pre-save result view. That id has no database row, so an ungated control there would download a 404 page. Gate on the same `PREVIEW_ID` constant `src/app/trip/[id]/page.tsx` already uses.

- [ ] **Step 1: Read the surrounding code**

```bash
sed -n '515,565p' src/components/ItineraryCard.tsx
```

Note how `BudgetBar` is placed relative to the city-name heading and `DayTabs`, and match that spacing.

- [ ] **Step 2: Add the control**

Place it in the header row beside the city name. Use the repo's `button-primary` token shape from DESIGN.md — `rounded-full`, `min-h-11` for the touch target, `--accent` background — and an inline SVG icon (DESIGN.md bans glyph/icon-font icons):

```tsx
{trip?.id && trip.id !== "preview" && (
  <a
    href={`/api/trips/${trip.id}/export`}
    download
    className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-accent px-4 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
  >
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M12 3v12M7.5 10.5 12 15l4.5-4.5M4 20h16" />
    </svg>
    Download
  </a>
)}
```

An `<a download>` rather than a button with a fetch: the browser's own download handling is the whole feature, and there is no state to manage.

- [ ] **Step 3: Verify in the browser**

With `npm run dev` running, open `http://localhost:3000/trip/<id>`, confirm the control renders beside the city name, click it, and confirm the browser saves a file named `<city>-itinerary.html`.

Then open the saved file, switch the browser to offline (DevTools → Network → Offline), and reload it. Confirm the cover photo and all type still render.

- [ ] **Step 4: Confirm neither unsaved surface offers a download**

```bash
curl -s "http://localhost:3000/trip/preview" -o /dev/null -w "%{http_code}\n"
```

Expected: `200`, and the page shows no Download control.

Then generate an itinerary on `/` without saving it and confirm the result card shows no Download control either — that view passes `id: "preview"`, which has no row.

- [ ] **Step 5: Typecheck, lint, build**

```bash
npx tsc --noEmit -p tsconfig.json && npm run lint && npm run build
```

Expected: all three clean. The `verify-build.mjs` step must pass — this adds no new chunk, but the guard stands.

- [ ] **Step 6: Commit**

```bash
git add src/components/ItineraryCard.tsx src/app/trip/\[id\]/TripView.tsx
git commit -m "Put the download where the trip already names itself"
```

---

### Task 9: Verification, docs, and finish

The spec's definition of done is not "tests pass".

**Files:**
- Modify: `docs/frontend.md`, `docs/backend.md`
- Create: `DESIGN.md` entry (written by the documenter, not by hand)

- [ ] **Step 1: Full verification sweep**

```bash
npm test && npx tsc --noEmit -p tsconfig.json && npm run lint && npm run build
```

Expected: all clean. Record the actual test count in the commit message rather than asserting "all pass".

- [ ] **Step 2: Real-device check**

Export a real trip, AirDrop or copy the `.html` to a phone, put the phone in airplane mode, and open it. Confirm: the cover renders, the trip line scrolls, tapping a day opens it, tapping a stop ticks it, and reopening the file remembers the ticks.

- [ ] **Step 3: Run the mechanical design detector**

```bash
node /Users/zaidshaikh/.claude/plugins/cache/impeccable/impeccable/4.0.4/skills/impeccable/scripts/detect.mjs --json src/lib/export/itineraryHtml.ts src/components/ItineraryCard.tsx
```

Run it once. Fix what is mechanical; carry the rest into Step 4's input packet.

- [ ] **Step 4: Finish review**

Capture the exported file at 390px and at desktop width to PNG files, then spawn `impeccable-finish-reviewer` with: the original request, the confirmed answers, the artifact path, the screenshot paths, the direction contract from `itineraryHtml.ts`, the detector findings, the approved comp at `.impeccable/comps/comp-b-linemap.html`, and the craft-floor reference path. Apply its material fixes in one batch, recapture, and send back for a verdict.

Report the verdict table as it stands, open items included, under the reviewer's own disposition word.

- [ ] **Step 5: Add the docs rows**

Per `docs/project-crux.md`, add one **Features** row to each of `docs/frontend.md` (the artifact and its Download control) and `docs/backend.md` (the export route and photo pipeline), with a `Since` date of the merge day and the contributor's own name.

- [ ] **Step 6: Record the built world**

Spawn `impeccable-documenter` with the project root, `src/lib/export/itineraryHtml.ts`, the direction contract, `PRODUCT.md`, the `document.md` reference path, and the boundary to write at. It records DESIGN.md from what shipped, not from what was intended.

- [ ] **Step 7: Commit**

```bash
git add docs/frontend.md docs/backend.md DESIGN.md AGENTS.md
git commit -m "Record the export in the trackers and the design system"
```

---

## Self-Review

**Spec coverage.** Every section maps to a task: delivery → 7; the four modules → 1, 2+3, 5, 7; photo pipeline and both Wikimedia findings → 5; typography → 6; interactivity → 4; all six content rules → 2 and 3; all seven listed tests → 2, 3, 5; docs → 9; definition of done → 9. Out-of-scope items appear in no task, as intended.

**Type consistency.** `ExportPhotos` is declared once in Task 3 and imported by Task 5. `ExportAssets` wraps it plus `fontDataUri` and is the only shape Task 7 constructs. `dayLegs` returns `(ExportLeg | null)[]` in Task 2 and is consumed as such in Task 3. `exportFilename` is defined in Task 3 and used in Task 7. `loadExportFont` returns `Promise<string | null>` in Task 6, matching `ExportAssets.fontDataUri`.

**Resolved while writing, not left to the implementer:** `ItineraryCard` already carries an optional `trip?: TripSummary`, so the Download control needs no new prop. `HomeView` passes a synthetic `id: "preview"` for the unsaved result view, which has no database row — Task 8 gates on it, and Task 8 Step 4 verifies both unsaved surfaces.

**One thing the implementer must not "fix":** `src/lib/format.ts` has its own `parseISO` that deliberately builds dates in **local** time. The CLAUDE.md warning about UTC midnight applies to naive `new Date(iso)` calls, not to that helper. Task 4's runtime sidesteps the whole question by comparing date strings and never constructing a `Date` from trip data.
