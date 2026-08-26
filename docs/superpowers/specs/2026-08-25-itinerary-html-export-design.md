# Downloadable HTML itinerary — design

**Date:** 2026-08-25 · **Author:** Claude (with Zaid) · **Status:** approved, not yet implemented

## Problem

There is no traveler-facing export. `/trip/[id]/print` exists but is a *reviewer* document — it
labels every stop "Day 2 · Stop 3" so a tester can report what's wrong, and it ends with six
critique questions. It is also not linked from anywhere in the UI. Printing it to PDF gives a
traveler a flat, unnavigable page, and a PDF cannot show the one thing a plan is actually made of:
the movement between stops.

**Goal:** one self-contained `.html` file the traveler downloads and opens on their phone, abroad,
offline.

## What the artifact is

Cover-first, opening into working day pages. Rich where photos are reliable (destination level),
utilitarian per-stop where they are not.

The file must render identically in airplane mode. That is not a nice-to-have — offline is the
exact moment it gets opened.

## Direction

Structure assigned by `concept-seed.mjs --scope surface --mode read`, seed key `e57fcfdf`,
assigned index 7 of the ordered candidate list below. Rendition chosen by the user from three
built comps.

Ordered structural candidates (1 = most obvious):

1. Cover → accordion day list
2. Contents → swipeable day pages
3. Continuous scroll, sticky day headers
4. Fixed clock rail, whole trip as one timeline
5. Boarding-pass stack, one stub per day
6. Now-first — opens at what is happening now
7. **The day is a drawn route, not a list** ← assigned

### Direction contract

This block goes verbatim into the emitted HTML as the first child of `<body>`, per Impeccable's
new-work flow.

- **THESIS:** A day is a route, not a list. Refuses the itinerary-app default of stacked cards
  with a time on the left.
- **OWN-WORLD:** Transit-diagram grammar on a cool off-white ground (`#F5F7F7`). Trunk line 8px in
  TripMate's own `--surface-deep` `#0d2e37`; stops are interchange nodes (white fill, 4px teal
  ring); `--accent` `#fb9826` marks only the active stop, matching the app's rule that amber is
  reserved for the selected thing. Archivo throughout, tracking tightening as type grows.
- **STORY:** The traveler sees the whole trip as one line with each day a station, taps into a
  day, and reads it the way they read a metro map — where they are, what is next, and how they get
  there.
- **FIRST VIEWPORT:** Full-bleed destination photo top ~44svh; destination set at
  `clamp(3.2rem,17vw,5rem)/900`; dates, stop count and budget beneath; then the trip line — seven
  day-stations on one horizontal trunk, today's struck in amber.
- **FORM:** Route-as-spine, candidate 7 of 7, seed key `e57fcfdf`.
- **FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review,
  the verdict, and DESIGN.md.

### Why light, when the app is dark

DESIGN.md's own rule: *"Dark or light is never a default: write one sentence of physical scene and
let it force the answer."* The scene is a phone held outdoors, abroad, possibly on low battery.
That forces light. The app is dark because its panels float over a live globe; there is no globe
in a downloaded file, so the reason does not travel with the artifact.

## Architecture

### Delivery

`GET /api/trips/[id]/export` → `text/html; charset=utf-8` with
`Content-Disposition: attachment; filename="<destination-slug>-itinerary.html"`.

One Download control on `/trip/[id]`. No new page, no new route segment for the UI.

### Modules

| File | Responsibility | Depends on |
|---|---|---|
| `src/lib/export/itineraryHtml.ts` | **Pure.** `(trip: Trip, photos: ExportPhotos) => string` | `format.ts`, `itinerary.ts`, `travelTime.ts` |
| `src/lib/export/exportPhotos.ts` | Fetch + base64 encode. Fail-soft per slot | `wikiTitle.ts` |
| `src/lib/export/wikiTitle.ts` | Wikipedia title resolution + containment check | — |
| `src/app/api/trips/[id]/export/route.ts` | Thin wiring | `db.ts`, `tripPayload.ts`, the two above |

`itineraryHtml.ts` takes no clock, does no I/O, and reads no globals. That is what makes it
testable under the repo's existing narrow-suite convention.

`wikiTitle.ts` is **extracted from** `src/app/api/place-photo/route.ts`, not copied. That route's
`foldDiacritics` / `passesContainment` / `candidateQueries` / `resolveTitle` move into the new
module and the route imports them. One matcher, two callers — a second copy would drift.

Travel legs reuse `src/lib/travelTime.ts` unchanged. The export must not be able to disagree with
the app about how far apart two stops are.

### Photo pipeline

Both slots degrade to `null` independently; `null` renders a design that is complete without the
image, never a gap or a broken frame.

| Slot | Source | Size |
|---|---|---|
| Cover (×1) | `Special:FilePath/<file>?width=1080` | ~233 KB base64 |
| Day station (×N) | summary API `thumbnail.source` (330px) | ~27 KB base64 each |

Measured against the real saved Zürich trip: one cover (233 KB) plus seven day thumbs
(~27 KB each) ≈ **~420 KB** total. Day thumbs vary widely — the same measurement returned 64 KB
for Grossmünster and 3 KB for Bahnhofstrasse, where Wikipedia's lead image is a near-empty
placeholder, so treat 27 KB as a mean and not a per-image budget.

Two findings that constrain this, both hit during design:

- **Wikimedia rejects arbitrary thumbnail widths with a 400.** `640px-`, `800px-`, `1024px-` and
  `1200px-` all fail for `Altstadt_Zürich_2015.jpg`; only `1280px-` succeeds. Allowed widths are
  per-file. Never construct a `thumb/.../<w>px-` URL — use `Special:FilePath?width=`, which resizes
  server-side and snaps to the nearest rendered size, or the URL the summary API hands back.
- **No image library is available.** `sharp` is present only as a transitive dep of `next` and is
  not exported for direct require. Adding one is unnecessary: choosing the right source size
  removes the need to re-encode.

Guards: skip any single image over 400 KB; cap total inlined bytes at ~1.2 MB. A trip long enough
to exceed the cap loses day thumbs from the tail, never the cover.

### Typography

Archivo is loaded via `next/font/google`, so no `.woff2` exists on disk. Vendor one latin-subset
Archivo **variable** woff2 into `public/fonts/`, base64 it into the export, and fall back to the
system stack. ~30 KB against ~393 KB of photos.

This is not vanity: every tracking value in DESIGN.md (`-0.078em` display, `-0.06em` node labels)
was tuned for Archivo, and the transit-diagram rendition leans on that tightness.

### Interactivity

Offline, zero dependencies, no framework.

- Days are native `<details>`/`<summary>` — works with JS disabled.
- One inline script, ~25 lines:
  - opens the day matching today's date on load, using `getUTC*` accessors (see the calendar-date
    gotcha in CLAUDE.md — local accessors roll back a day west of Greenwich);
  - if the trip has not started or has ended, opens nothing and leaves the cover in view;
  - stop check-off persisted to `localStorage`, keyed by trip id + day + stop index.

Check-off is **local to the file** and never syncs back to the app. The file states this in one
line so nobody expects otherwise.

## Content rules

Each of these comes from something observed in the live data, not anticipated:

- **Suppress legs under ~100 m.** Real Zürich days contain consecutive stops at identical
  coordinates, which produce `0.00 km / 0 min` legs.
- **Strip emoji from model summaries.** Live summaries carry them (`🏛️🎨`, `✈️☀️`).
- **`cost === 0` renders "Free", never "$0"** — DESIGN.md's existing rule against showing a label
  for a value that isn't there.
- **All money through `formatMoney`, all dates through `format.ts`.** Non-negotiable per DESIGN.md.
- **HTML-escape every model-authored string.** Stop names, notes, `why`, day titles and summaries
  are LLM output being written into a file the user shares with other people. Escape at the single
  point where values enter the template.
- **Day figures use `dayPlanned`**, and must sum to the trip figure — the same line-by-line
  checkable invariant the print page is built on. Flight cost is stated as its own term, outside
  the day sum.

## Testing

`src/lib/export/itineraryHtml.test.mjs`, run by the existing `npm test`:

1. A zero-distance leg renders no leg element.
2. A leg over the threshold renders its computed mode and minutes.
3. Emoji are stripped from a day summary.
4. `cost: 0` renders "Free" and never the string `$0`.
5. Day totals sum to the trip total.
6. A stop named `<script>alert(1)</script>` produces no executable tag.
7. `photos: { cover: null, days: [] }` still returns valid HTML containing every stop.

Beyond the suite, per CLAUDE.md: `npx tsc --noEmit`, `npm run lint`, `npm run build` (the
verify-build step matters — this adds no new chunk, but the rule stands), and `curl` the export
route against a running dev server, then open the downloaded file in a browser with the network
disabled.

## Out of scope

- **Per-stop photos.** Coverage is unpredictable — the containment check correctly rejects
  "Lunch in Altstadt neighborhood" — and the chosen rendition does not use them.
- **Any PDF path.** This replaces the idea of one, not an existing feature.
- **`/trip/[id]/print`.** It keeps its reviewer job and its critique questions, unchanged.
- **Syncing check-offs back to the app.**

## Docs

Per `docs/project-crux.md`, implementation adds a new **Features** row to `docs/frontend.md`
(the artifact and its Download control) and to `docs/backend.md` (the export route and photo
pipeline), each with a `Since` date of the merge day and the contributor's own name.

## Definition of done

Beyond the checks above: the direction contract is present in the emitted markup, the Impeccable
finish review has returned a verdict with no open material findings, and DESIGN.md records the
built world via the documenter. A clean detector pass alone is not finished.
