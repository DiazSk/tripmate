# Chaos in → trip out

**Date:** 2026-09-25 · **Author:** Zaid, with Claude · **Status:** Design approved in brainstorm; not implemented
**Roadmap:** Stage 1 of [`2026-09-25-emotional-product-roadmap-design.md`](2026-09-25-emotional-product-roadmap-design.md)
**Platform:** web first. The iOS Share Extension comes in Stage 2 and uses the same `/api/import`.

## Problem

The designated group planner arrives with a pile: saved TikToks, camera-roll screenshots, a friend's WhatsApp list,
and a Google Maps link or two. Today TripMate takes none of that in. It also ignores the places the planner *does*
type:

- The review step's POI picker ("Add a spot you already know about") stores picks and typed spots in
  `UserAnswers.selectedPois` / `customPois`.
- `buildGeneratePrompt` never reads either field, and `runGeneration` doesn't pass them on.
- Typed spots are never geocoded.

So the one field where a traveller says "we must go here" has no effect on the plan. That breaks trust silently,
and this spec fixes it as its first build step.

## Goals

1. Planners can drop their pile (screenshots, links, pasted notes) and see each place on the 3D map within seconds.
2. A place the planner marks as a must is scheduled. If that is impossible, the plan says why. This is checked in
   code, not just requested in the prompt.
3. Something worth looking at appears in about 20 seconds: a sketch of the days, instead of 5.8 minutes of waiting
   for the first real signal.

## Non-goals

- iOS UI (Stage 2).
- Accounts, sharing and voting (Stage 2).
- Instagram link reading. Its oEmbed needs a Meta app token, so we ask for a screenshot instead.
- Google Maps *list* links, which have no API. Single-place Maps links are in scope.
- Storing uploaded images.

## Experience

1. **Drop the pile.** The wizard's basics step gets a zone: *"Drop what you've saved: screenshots, links, notes."*
   It accepts paste (⌘V of images or text), drag-drop, and a file picker (`<input type="file" accept="image/*"
   multiple>`).
2. **Watch it become places.**
   - Each item appears in a tray as a thumbnail or link chip.
   - Extracted places land as pins on the map while they resolve, and the map flies to the city.
   - If the destination field is blank, it is filled with a suggestion the planner can change, e.g. *"These look
     like Tokyo: 14 places, 2 in Kyoto."*
3. **Must vs want.**
   - Each place has a star. Starred means `must`; the default is `want`.
   - Anything unreadable is named honestly, and none of it blocks generation:
     - *"Couldn't read this screenshot."*
     - *"Couldn't place 'that ramen spot': type it or skip."*
     - *"Instagram links need a screenshot."*
4. **Sketch (about 20s after Generate).**
   - Each day gets a model-written theme ("Old Tokyo, slowly"), an area, and the anchors assigned to it.
   - Those anchors are drawn on the map, and the theme shows in the day header until real stops stream in.
5. **Receipt (after generation).** For example: *"11 of your 12 places are in the plan. teamLab moved to Wednesday
   (closed Tuesdays). Kawagoe didn't fit: 70 min each way."* Every unplaced place gets a "Fit it anyway" action,
   which opens the existing chat editor pre-filled with the request — the traveler still sends it themselves.
   Same surface on the fresh plan and on saved trips.

## Architecture

### Reading images: one vision path through `runClaude()`

`runClaude()` in `src/lib/claude.ts` is still the single chokepoint for model calls. Its `prompt` parameter widens
from `string` to `string | ContentBlock[]`, where a block is text or a base64 image:

- **API transport (`runClaudeViaApi`):** passes the blocks as the user message's `content`.
- **CLI transport (`runClaudeViaCli`):**
  - When the prompt contains an image block, switch from `-p <prompt>` to `-p --input-format stream-json` and write
    one SDK user message to stdin. Every other call stays as it is today.
  - `--tools ""` and `--setting-sources ""` are unchanged.
  - Build step 1 is a spike that proves this works on the installed CLI (2.1.258).
  - **If the CLI refuses image input:** calls carrying images throw a clear error ("screenshot reading needs
    `LLM_TRANSPORT=api`"). The import route turns that into a per-item "couldn't read" message. Links and text keep
    working on CLI, and nothing falls back silently.
- **Traces:** in the `llm_traces` prompt column, image blocks are replaced with `[image N · 640KB]`. Without this,
  every screenshot would sit in the SQLite file, which is shared across users.

Alternatives we rejected:

- **In-browser OCR (tesseract.js):** a WASM-embedding dependency, the same class as the `@spz-loader/core` failure
  recorded in CLAUDE.md. It also can't recognise a landmark photo that has no caption.
- **A per-call transport override:** breaks the rule that the transport is a whole-process setting.

### New units

**`src/lib/importSources.ts`** holds pure logic plus one fetch helper.

- `classifyItem(item) → "image" | "tiktok" | "youtube" | "gmaps" | "instagram" | "url" | "text"`.
- `parseGoogleMapsUrl(url) → {name, lat, lng} | null` reads the `/maps/place/<name>/@<lat>,<lng>` form. Short links
  (`maps.app.goo.gl`) have their redirect followed first.
- `readLink(url) → {title, text} | null`:
  - TikTok: `https://www.tiktok.com/oembed?url=` (public, no key).
  - YouTube: `https://www.youtube.com/oembed?url=`.
  - Anything else: HTML `<title>` and `og:title` / `og:description`.
- **SSRF guard on every fetch:**
  - https only;
  - the resolved address must not be private, loopback or link-local;
  - at most 3 redirects, each re-checked;
  - an 8s timeout;
  - a 512KB body cap.

  `null` means the fetch failed, following the house fail-soft convention.
- Follow the fetch shape in `src/lib/destinationFestivals.ts` (timeout, then a cheap-model extraction).

**`POST /api/import`** (`src/app/api/import/route.ts`)

- Request: `{ items: ImportItem[], destination?: string }`.
- Limits:
  - up to 20 images and 20 links/texts;
  - images arrive as base64 JPEG, downscaled in the browser with `<canvas>` to a 1568px long edge (no dependency);
  - 25MB total request.
- Flow:
  1. Classify each item.
  2. Maps links resolve directly, with no model call.
  3. Read the other links.
  4. Make **one** `extract` call with every image plus all link and text content, each labelled with its item
     index.
  5. Geocode the results.
  6. Respond.
- Response: `{ destinationGuess: string | null, places: ImportedPlace[], unread: {index, reason}[] }`.
- `ImportedPlace = { name, lat: number | null, lng: number | null, sourceIndex, category? }`.

**`extract` call type**

- Add it to `ClaudeCallType` and the `apiModelFor` / `apiEffortFor` / `maxTokensFor` switches in
  `src/lib/llmConfig.ts`, at the cheap tier.
- On CLI, the call passes `meta.model = cheapModel()`, since the CLI path is otherwise pinned to `MODEL`.
- Register it in `CALL_TYPES` (`src/app/api/llm-mode/route.ts`) and the label/icon maps (`RunCompareModal`,
  `RunPipelineDiagram`, `backend/FlowDiagram`, `backend/PipelineConsole`, `bench/BenchConsole`).
- Output is strict JSON: `{destinationGuess, places: [{name, cityHint, sourceIndex, confidence: "high"|"low"}]}`.
- The prompt tells the model to return only places that are actually named or clearly pictured, never to guess a
  venue from mood alone, and to skip anything with low confidence.

**Geocoding**

- Batch all names through `resolveNamedPlaceCoords(names, near)` in `src/lib/poiDetails.ts`. `near` is the city's
  geocode point, taken from the destination or from `destinationGuess`.
- Misses are retried one at a time with `searchPlaces` (`src/lib/placeSearch.ts`), up to 8 of them, to respect the
  Overpass rate limits recorded there.
- Anything still unresolved stays as a name-only anchor (`lat: null`), and the model still sees it.

### Anchors actually reach the plan

- **New field.** `UserAnswers.anchors: Anchor[]` in `src/lib/types.ts`, where
  `Anchor = { name, lat: number | null, lng: number | null, priority: "must" | "want", source?: "import" | "picked" | "typed" }`.
- **Old fields still accepted.** The server keeps accepting `selectedPois` / `customPois` and maps them to `want`
  anchors, so the iOS wizard works with no change. Typed `customPois` get geocoded through the same batch.
- **Prompt.** `runGeneration` (`src/lib/generationRunner.ts`) passes the anchors to `buildGeneratePrompt`
  (`src/lib/itineraryPrompt.ts`). That renders them as facts only: name, coordinates and priority. The rule itself
  lives in the skill, which keeps the skill/facts/ask separation.
- **New SKILL.md section, §15 "Traveler's places":**
  - Schedule every `must`, unless an opening hour, the distance or the day count makes it impossible.
  - Fit `want` places where they suit the day.
  - Never drop a `must` silently.
- **Output format.** SKILL.md §11 gains `Itinerary.unplaced?: { name: string, reason: string }[]` and
  `DayPlan.theme?: string`.
  - `theme` is model-written and separate from the user-written `title`.
- **Coverage check.** Add `evaluateAnchors(itinerary, anchors)` to `src/lib/guardrails.ts` (new `GuardrailRule`
  `"anchors"`). A `must` is covered if a stop matches it by normalised name or lies within 150m of its coordinates,
  or if it appears in `unplaced`.
  - Any `must` that is neither placed nor listed in `unplaced` becomes a guardrail warning.
  - The receipt reads this check's result. It never takes the model's word for which places made it in.

### Sketch

- **When it runs.** A new cheap-tier `sketch` call type, registered like `extract`. It runs in `runGeneration`
  after geocode/context and **before** `generate`.
- **What it returns.** `{ days: [{ date, theme, area, anchors: string[] }] }`.
- **Why serialised.** The sketch is passed into the generate prompt as a proposed day shape ("keep this unless it
  conflicts"). It adds about 20s to a run of about 6 minutes, and a sketch the final plan contradicts would cost
  the trust this feature exists to build.
- **Wiring:**
  - `LiveSink.onSketch` in `generationRunner.ts`;
  - a new SSE event `sketch` in `src/app/api/itinerary/route.ts`;
  - an `else if (event === "sketch")` branch in `runStreamed` (`src/app/HomeView.tsx`), which seeds day themes and
    anchor pins into the draft itinerary until real stops arrive.
- **Why an *event*, not a new `stage`.** The iOS `SSEReader.swift` decodes stage names as a closed enum and throws
  on unknown ones, while unknown events decode to `.unknown`. The new optional JSON fields (`theme`, `unplaced`)
  are ignored by Swift `Codable`.
- **If the sketch fails** (error or timeout, 30s cap), generation continues without it. The sketch is never on the
  failure path.

### Error handling summary

| Failure | What the planner sees | Blocks generation? |
|---|---|---|
| Screenshot unreadable / image input unsupported on CLI | "Couldn't read this screenshot" | No |
| Instagram link | "Instagram links need a screenshot" | No |
| Link fetch fails or is refused by the SSRF guard | "Couldn't open this link" | No |
| Place not geocodable | Name-only chip: "type it or skip" | No; the model still sees it by name |
| Must-have impossible | Receipt reason plus "Fit it anyway" | No |
| Sketch fails | No sketch; the normal streaming plan | No |

## Testing

- **`.test.mjs`, pure logic, beside each module:**
  - `classifyItem`;
  - `parseGoogleMapsUrl` (long form, encoded names, no coordinates);
  - the SSRF guard's address check (private, loopback, link-local, IPv6-mapped);
  - the extraction JSON parser, including malformed output;
  - mapping old `selectedPois` / `customPois` fields to anchors;
  - the anchors prompt section;
  - `evaluateAnchors` (name match, the 150m match, listed in `unplaced`, silently dropped);
  - trace redaction of image blocks.
- **Against `next dev`:**
  - `curl` `/api/import` with fixture screenshots, a TikTok URL, a Maps URL, a private-IP URL (must be refused) and
    an Instagram URL.
  - Generate a plan with 2 musts, one of them impossible (closed on the only day), and confirm the receipt.
- **Build step 1 spike:** one real CLI call with an image block. Record the result in this spec.
- **End to end:** real piles from 3 group planners (Stage 0 fixtures), checking extraction recall by hand.
- **Before calling any step done:** `npm test`, `npx tsc --noEmit -p tsconfig.json` and `npm run lint`.

## Build order

1. **Spike:** `claude -p --input-format stream-json --tools ""` with one image block. Decides whether the CLI path
   is fully supported or explicitly degraded.
2. **Anchors reach the plan:** `anchors`, the mapping from the old fields, the prompt section, SKILL §15, `unplaced`,
   `evaluateAnchors` and the receipt. This is valuable on its own, since it fixes the ignored POI picker.
3. **Import:** `importSources.ts`, `/api/import`, the `extract` call type, the drop zone and tray, map pins and
   destination inference.
4. **Sketch:** the `sketch` call type, the SSE event, `DayPlan.theme` and the client seeding.

Each step ships with its tests and its `docs/` tracker row (Features table, Developer column).

## Spike result (2026-09-25)

`claude -p --input-format stream-json` with one base64 image block, `--tools ""`, CLI 2.1.258:
WORKS — answered "Neuschwanstein Castle, Bavaria, Germany." in 3538ms.
