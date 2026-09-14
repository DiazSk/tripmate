# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev      # next dev (Turbopack)
npm run build    # next build, then verify-build.mjs (see below)
npm run lint     # eslint (no path arg needed)
npx tsc --noEmit -p tsconfig.json   # typecheck — not wired to a script
node scripts/browser-matrix.mjs     # cross-engine boot check against a running server
npm run verify-hero                 # asserts the hero film works (needs a running server)
```

**`npm run build` fails the build if any emitted chunk cannot be parsed.** That second step is
not ceremony. `next build` reported success for months while shipping a Cesium chunk no browser
could parse: `@spz-loader/core` embeds its WASM decoder as a string of raw bytes, and SWC's
minifier re-encoded it as a template literal, where a NUL byte followed by a digit is an illegal
escape. Production served a 200 and rendered the whole interface **with no globe at all** — in
Chromium, Firefox and WebKit alike. `next dev` never showed it because dev does not minify, and
neither `tsc`, `eslint` nor `node --test` can see a bundler's output. `shims/spz-loader-core.ts`
is the fix (aliased in `next.config.ts`); `scripts/verify-build.mjs` is the guard.

**`npm run verify-hero` is the manual gate for the landing hero, and it is manual for a reason.**
Every defect the hero film shipped with was *silent*: `position: sticky` inside an
`overflow-hidden` ancestor renders identically to sticky never being applied; `img.decode()`'s
promise never settling looks like slow footage; `Cache-Control: immutable` on unversioned filenames
serves a stale cut to returning visitors only. None threw, none logged, none failed a build. The
script asserts nine properties whose failure is invisible by eye on a fast machine, and it is
proven to catch them — adding `overflow: hidden` to `.hero-track` fails it with exit 1 while
`getComputedStyle(stage).position` still reads `sticky`.

It needs a browser and a running server, and Playwright is deliberately not a dependency here (see
`scripts/browser-matrix.mjs` for why). So it is not wired into `npm run build`. Run it by hand after
touching `Hero`, `HeroFrames`, the `.hero-*` rules, or `scripts/build-frame-sequence.mjs`.

**Node ≥ 22 is mandatory.** `better-sqlite3`'s native binding silently kills the dev server on Node 20 the moment any DB-touching route is hit. `.nvmrc` pins 22 — run `nvm use` if the shell drifts.

**The test suite is deliberately narrow, not small.** `npm test` runs
`node --import ./scripts/ts-resolve.mjs --test "src/**/*.test.mjs"` — 17 files, ~220 tests, no
framework and no build step. It covers only pure, deterministic logic, most of it logic that has
already broken once. Nothing renders, no route is booted, no DB is opened.

So passing tests prove far less here than in a normally-covered repo. Verification still means: `npm test`, `tsc --noEmit`, `eslint`, **and** exercising routes against a running dev server with `curl`. Don't claim a change is verified on typecheck alone.

**A `.test.mjs` can import any `.ts` module, value imports included.** `scripts/ts-resolve.mjs`
registers an ESM resolve hook that retries an extensionless relative specifier as `.ts`, then
`/index.ts`, then `.tsx` — so `import { TIERS } from "./tiers"` inside a module under test resolves
fine. `src/lib/tripDays.test.mjs` imports `applyPatch` from `itineraryPatch.ts`, which value-imports
`./tripDays`; `src/lib/bench/bench.test.mjs` reaches `runBenchmark.ts`, which pulls in `../db` and
`better-sqlite3`. Write the test where the logic lives.

The hook is registered by `--import` in the `test` script only, so the dev server and the build never
load it. Import specifiers **inside a `.test.mjs` itself** still need the explicit `.ts` extension —
the hook fires on the failed resolve of a relative import, and the test files all write `./foo.ts`
directly.

**What the hook does NOT fix: a type imported without the `type` keyword.** Node erases
`import type { X }`, but a plain `import { X }` stays in the emitted module, so if `X` is an
`interface` or `type` the loader throws at instantiation:

```
SyntaxError: The requested module './types' does not provide an export named 'CritiqueResult'
```

That is `src/lib/generationRunner.ts` today (line 11 pulls `CritiqueResult` into a value import
block), which is why `runGeneration()` cannot be reached from a `.mjs` script at all — a script that
needs it has to go through `/api/itinerary` over HTTP against a running dev server, the way
`scripts/perf-bench.mjs` does. Path resolution is solved; import *kind* is not. Move the type into an
`import type` block if you need a module to be script-reachable.

The glob in the `test` script needs **double** quotes. Single quotes reach Node literally on Windows and it matches nothing — the suite reported success while running zero tests.

## Git commits

**No signature or trailer of any kind.** Never append `Co-Authored-By`, "Generated with Claude Code", or any similar attribution line to a commit message in this repo. This overrides the harness's default commit-message template — write the message and stop at the description.

## Architecture

Next.js 16 App Router + React 19 + Tailwind v4. A 3D map renders behind most of the UI (engine assets copied into `public/` by the `postinstall` script).

### Two map engines, one interface

The world behind the itinerary is drawn by either **CesiumJS + Google Photorealistic 3D Tiles** (what the app shipped with) or **MapLibre GL JS + OpenFreeMap vector tiles + a terrarium DEM** (3D terrain and extruded buildings, deliberately no satellite imagery). **MapLibre is the default**; Cesium is one flag away and fully wired.

`src/lib/mapRenderer.ts` is the contract both implement. **Nothing above it imports either engine** — `mapCamera.tsx`, `StopMarkerLayer`, `MapControls` and `SplitEditor`'s map picking all go through `MapRenderer`. The contract is in **metres, degrees and CSS pixels**: no `Cartesian3` and no `LngLat` crosses it, camera aim is a target point plus a *range* (not a zoom), and **pitch is Cesium's convention everywhere — negative is down**. MapLibre's complement is converted inside `maplibreRenderer.ts`; getting that backwards silently inverts the tilt slider.

Pick the engine with the **Map / Satellite toggle** (top-left, under the wordmark), or at load with `?map=cesium|maplibre` (sticky — it writes `localStorage.tripmateMapEngine`) or `NEXT_PUBLIC_MAP_ENGINE` in `.env.local`.

The toggle **keeps the view**: `MapRenderer.cameraState()` is captured off the outgoing engine on the click and `restoreCamera()` applied to the incoming one, with the route, highways, city outline and pin replayed from the provider's caches rather than refetched. Both backgrounds stay mounted — each only *builds* when it is the active engine (`active` prop feeding their existing one-way `built` latch), and neither is ever destroyed, so a second toggle is instant. Capture must happen synchronously in `setEngine`, not in an effect reacting to the change: by then the outgoing canvas may already be hidden, and a hidden canvas is a camera nobody can read.

MapLibre's day routes are real translucent tubes drawn by a **custom WebGL layer** (`src/lib/maplibreArcLayer.ts`), not a style layer. That is not a preference: MapLibre has no elevated-line primitive (no `line-z-offset`, every `line-*` layer is draped on the terrain), and `fill-extrusion` prisms are axis-aligned so a segment across a steep stretch becomes a tall box — which read as a staircase of cubes. Don't try to move it back into the style.

`docs/map-engine-gpu.md` has the side-by-side cost measurement (`scripts/map-engine-probe.mjs`) and the list of what MapLibre deliberately does not reproduce. The headline: **both engines idle at 0 WebGL draw calls/s**, which is the number that governs this app — every map frame re-blurs every `backdrop-filter` panel above the canvas. Under a drag Cesium issues 3.4x the draw calls (8,706/s vs 2,539/s), and the cost lands in the frame-time tail rather than the median (p95 25.2ms vs 9.8ms) and in streaming (798 requests / 16.9MB vs 158 / 9.2MB).

**MapLibre's tile-parsing worker does not survive Turbopack.** It resolves the worker from `new URL("./maplibre-gl-worker.mjs", import.meta.url)`, Turbopack does not serve that path, the module worker dies on its own import, and **not one tile is ever parsed** — with no error anywhere. The style, sprite and raster layers all load, `getStyle()` shows every layer present, and the canvas stays a flat fill. `scripts/copy-maplibre-assets.mjs` copies the worker into `public/maplibre/` at postinstall and `createMapLibreMap` calls `setWorkerUrl` at it — same shape as `copy-cesium-assets.mjs`, same underlying reason (no CopyWebpackPlugin under Turbopack). Don't "simplify" that away.

### Two transports, one chokepoint

Every model call goes through `runClaude()` in `src/lib/claude.ts`. That is the single choke point — it writes a row to `llm_traces` on *every* outcome (success, non-zero exit, timeout, malformed envelope), and `meta.runId` groups sibling calls into an `llm_runs` row for the trace viewer. Route new model calls through it rather than adding your own client.

It now **branches on transport**, and the branch is the only place that knows which one serves a call:

- **`api` (the default)** — an HTTPS request through `@anthropic-ai/sdk`, in `src/lib/claudeApi.ts`. Needs `ANTHROPIC_API_KEY`; a missing key fails loudly rather than falling back.
- **`cli`** — the original `spawn` of the **`claude` CLI** as a one-shot child process, unchanged.

Set `LLM_MODE=api|cli` in `.env.local`, or flip it mid-session with `POST /api/llm-mode {"mode":"cli"}` (`GET` the same route to see the mode, its source, and what each call type resolves to). The two paths are held to being indistinguishable to callers: same signature, same `ClaudeResult` including `sessionId`, same meaning for `timeoutMs`, and the API path **synthesizes the CLI's JSON envelope** so `parseUsage()` in `runs.ts` and the trace viewer read both without branching.

Two things genuinely differ, and both are deliberate:

- **Which model answers.** The API path routes per task through `apiModelFor()` in `src/lib/llmConfig.ts` — strong (`claude-opus-5`) for anything that writes or judges a whole plan, cheap (`claude-haiku-4-5`) for bounded work against facts that already exist. The CLI path stays pinned to `MODEL` (`claude-sonnet-4-5`) because the timeout constants in `claude.ts` were calibrated against that model; re-pointing it silently invalidates them. **`src/lib/llmConfig.ts` is the only place model names belong** — don't hardcode one at a call site.
- **Where conversational memory lives.** A JSONL file on one machine for the CLI, an `llm_sessions` row for the API. See "Chat memory" below.

`effort` and `thinking` are **capability-gated, and that gate is load-bearing**: both are a 400, not a no-op, on `claude-haiku-4-5` and `claude-sonnet-4-5`. Forwarding the CLI's `--effort low` to the cheap tier unconditionally would fail every chat call.

Four non-obvious CLI-path constraints are already handled there; don't "fix" them back:
- `CLAUDECODE` is stripped from the child env, or the CLI refuses to launch nested inside a Claude Code session.
- `spawn`, never `execFile` — `execFile` reliably hangs on this binary.
- `~/.local/bin` is forced onto `PATH`, since non-login process launchers don't source the shell profile.
- `--setting-sources ""` and `--tools ""` mean the CLI loads **no** settings sources and has **no** Skill tool. Skills in `.claude/skills/` therefore *cannot* auto-load; `src/lib/skill.ts` reads `SKILL.md` off disk and injects the body into the prompt instead.

### Two transports, one interface

`runClaude()` is a dispatcher, not the implementation. It routes to one of two functions based on
`LLM_TRANSPORT` (default `"cli"`):

- `runClaudeViaCli()` — the subprocess described above, unchanged. Serves local development for
  free under the existing CLI subscription; no `ANTHROPIC_API_KEY` needed.
- `runClaudeViaApi()` — calls the Anthropic Messages API directly via `@anthropic-ai/sdk`. Used
  only where `LLM_TRANSPORT=api` is set (Railway's deployed environment), since there's no `claude`
  CLI binary or logged-in session on a container.

This is a deliberate, permanent dual-path design, not a migration in progress — both stay in
service. Consequences worth knowing:

- **Session continuity works differently per transport but never crosses transports.** The CLI
  replays a local JSONL transcript on `--resume`; the API path replays a message array stored in
  the `llm_sessions` table (`src/lib/db.ts`). Because `LLM_TRANSPORT` is a whole-process setting,
  a session is only ever resumed under the transport that created it.
- **`llm_traces.raw_response` holds two envelope shapes side by side, forever.** A CLI-transport
  row has the CLI's `modelUsage`/`total_cost_usd` shape; an API-transport row has the Messages
  API's `usage` shape and a separately-populated `cost_usd` column (the Messages API reports no
  cost at all — see `src/lib/modelPricing.ts`). `src/lib/runs.ts` and `src/lib/perfAggregate.ts`
  branch on which shape they're reading; don't "simplify" that branch away.
- `src/lib/skill.ts` is unaffected either way — it only ever produced a prompt-text string to
  splice into the messages/prompt, independent of how the call is transported.

See `docs/superpowers/specs/2026-08-25-deploy-and-direct-api-design.md` for the full design and
why (LinkedIn demo needed a public deploy link, which the CLI-only mechanism blocked).

### Two generation paths coexist

1. **Legacy single-shot:** `POST /api/itinerary` → `buildGeneratePrompt()` in `src/lib/itineraryPrompt.ts` → strict-JSON `Itinerary` (`{ tier, days[] }`), saved to `trips.itinerary_json`. This is what the current UI uses.
2. **Staged pipeline:** `trip-submit` (validate) → `trip-fetch` (2a, preference-independent data) ∥ Q&A in `HomeView.tsx` (2b) → `trip-prepare` (barrier/reconcile + POI enrichment) → `trip-generate` (digest facts into `trip-context.md`, then one LLM call combining skill + context + a fixed ask). Emits **markdown**, persisted to `trip_artifacts` keyed by `run_id`.

The pipeline's governing separation: the **skill** (`.claude/skills/itinerary-planner/SKILL.md`) holds planning *rules*, `trip-context.md` holds *facts only* (no instructions), and `src/lib/generationPrompt.ts` holds the *ask* with no trip data. Don't duplicate rules into the prompt or facts into the skill.

### Story mode owns the camera, and the beat is the clock

Pressing Play on a day narrates it: the camera flies to each stop while a voice reads a story-format
script and the matching line lights up. `src/lib/storyMode.tsx` is the controller, `StoryStage.tsx`
the only thing that draws it, both mounted in `AppShell` beside the map chrome.

**The plan panel stays; it shuts to its capsule.** That single clean line — photo, destination,
length, day in focus — *is* the film's header. Its action slot carries Play only while there is no
film: the moment one starts, the button **leaves** for `StoryStage`'s transport row, between
Previous and Next, and the capsule keeps only the trip. It travels rather than teleports —
`src/lib/controlHandoff.ts` hands the capsule's rect to the stage, which flies from it with
`Element.animate`. That hand-off is deliberately one-way (the capsule is clipped by two
`overflow-hidden` ancestors, so a return flight would run behind them), which is why it is not
Framer's symmetric `layoutId`. `StoryStage` otherwise repeats none of the capsule and docks
directly beneath, its geometry copied from
`DockedPanel`'s collapsed branch (same insets, same `sm:w-96`/`max-w-[520px]`, offset by the
capsule's `h-14` plus a gap) so the two read as one stack in the column the plan already owned. An
earlier revision hid the whole panel and floated the narration bottom-centre over the map; that put
the film's controls nowhere near the control that started it and covered the ground the camera had
just flown to. What *is* hidden is chrome — the navbar, the map search box, the zoom/2D/tilt/compass
stack and the install prompt, by `display: none` on a wrapper so each keeps its own state. The
Map/Satellite toggle stays: it chooses the world being filmed rather than acting on the page.
`LlmTraceFab` mounts as a sibling of `.app-shell`, above the provider, so no context reaches it —
`data-story-mode` on `<html>` plus one rule in globals.css is its lever.

**The film draws stops, not a route.** `connectors: false` on `RouteDrawRequest` (set through
`setRouteConnectorsHidden`, the same shape as `setRouteFramingSuspended` and for the same reason —
`showTripRoute` already takes three booleans) drops the line between one stop and the next. The
arcs are what make a day read as an *order*, which is the most useful thing on the map while you
are reading a plan and a spoiler drawn across the shot while you are being told about one place.
What stays is the stop: its pool, its ring, its stem and its name. On Cesium the flag empties
`segments` in `buildRouteGeometry`, so the arcs, their glows, their pulses and the emphasis loop all
become empty together rather than being suppressed in four places; on MapLibre it drops the arc
tubes **and** the line draped on the terrain beneath them, since hiding only the tubes leaves a flat
rope one dimension down. The per-day "DAY 1" cluster badge goes too, by the `data-story-mode` CSS
lever — the capsule already says which day is playing.

**The film's camera inherits the retired tour's facing and pacing.** `legBearingRad` frames each
stop along the direction of travel, so the next place is ahead of you as you arrive — without it
every arrival is due north and four in a row are the same frame, which is what made the old tour
read as a slideshow. `tourFlightSeconds` puts the distance in the *flight* rather than the hold, and
`prefers-reduced-motion` drops the flight to zero while the beat keeps its length. All of that is
`tourPacing.ts`, written for the Play tour this replaced; `TOUR_HOLD_MS` is the only part that does
not transfer, because a film already has a hold — the sentence.

**On Cesium the film's own camera is the cost, and it is not the panel.** Measured: a whole film on
MapLibre drops **0 frames over 32ms**; the same film on Cesium drops 20-34 per window with 100-280ms
main-thread stalls, and `display: none` on the entire narration panel while the camera keeps flying
changes that by nothing. Six beat advances blocked the main thread for **2,157ms in 4 seconds**;
running on over ground already covered dropped it to **0**. It is tile decode — `LOD_TIERS` in
`GlobeBackground` sets `maximumScreenSpaceError` to 8 below 2,000m (twice Cesium's default, for
legibility) and `flyToStoryStop` dives to 1200m at every stop, so each beat is a fresh high-detail
burst. Don't go looking for it in the DOM.

**So the film's dive runs at Cesium's own default and the hold gets the sharpened ceiling back.**
`inStoryFlight()` in `mapCamera` is a `performance.now()` deadline set by `flyToStoryStop`, read by
`installLodController` on the frame loop it already runs. Measured A/B, same trip, same day, reload
before each, six beat advances: **3 and 11 frames over 32ms with it, against 84 and 30 without.** The
arrival is untouched — only the ground going past is cheaper. **The deadline expires ~150ms *before*
the flight does, and that is load-bearing**: under `requestRenderMode` frames stop when the camera
does, so a deadline set to the full length would come due on a frame that never arrives and the stop
you came to look at would never sharpen. Second and later passes over the same ground are free on
both sides — only the first costs anything, which is why any measurement here has to reload first.
What the chrome can do on top — and now does — is animate on the compositor so it rides through the
remaining stalls instead of freezing with them.

**The film's camera is `flyToStoryStop`, not `flyToPlace`.** `flyToPlace` pulls back to
`STOP_CONTEXT_RADIUS_M` and refuses to come nearer than `STOP_MIN_RANGE_M` (3.5km, ~zoom 14.5),
because a reader is asking "where is this *in the city*". A film is not: at that floor the flight
from a day's framing to a stop is a few hundred metres of range, and it read as the map not moving
at all. The film dives straight to 1200m at -30°, shallower than any other flight here, because it
wants facades and a horizon rather than a plan view.

**The beat is the clock, and that is why the old Play tour could not be extended.** `useStopTour`
stepped stops on a fixed 6.5s interval; a narrated beat lasts exactly as long as it takes to say,
which is known only when the voice reports it finished. So the camera, the audio and the row
highlight are all derived from one beat index, `Next` cancels the sentence rather than nudging a
timer the audio then talks over, and the hook is deleted rather than kept beside this.

**While a film runs, the card stops driving the map.** `ItineraryCard`'s route effect takes
`story.active` as a **dependency, not just a guard** — leaving story mode re-runs it, which is what
pulls the view back to the day framed beside the panel that just came back. Without the dependency
the map would keep the film's centred, panel-less framing.

**Two narrators behind one seam.** Everything above `src/lib/storyVoice.ts` calls `speakOn(engine,
…)` and knows nothing else — the same shape `placeSearch.ts` puts in front of Google Places and
Overpass. `browser` is the platform's `speechSynthesis`: free, instant, offline, and it sounds like
an OS voice because it is one. `natural` is **Kokoro-82M in the browser** (`kokoroVoice.ts`), and it
is simply the voice — it starts downloading when a film does. It was an opt-in toggle; that went
because "the one that always works" is what a *fallback* is for, and there is one at every level
(the platform voice narrates the whole download, a browser that cannot run the model never leaves
it, and a failed sentence is handed back mid-beat), so the preference only ever offered somebody
the worse narrator. The 88-326MB is disclosed with a live percentage in the stage; that line is not
decoration, it is the only thing saying where the bytes went. Both are free — no key, no quota, no per-use
cost. A per-sentence failure on the natural voice (an error, or a device slower than
`SYNTHESIS_DEADLINE_MS`) hands *that same beat* to the platform voice mid-beat, so the caller gets
one `onEnd` either way and never learns it happened.

**The pacing is engine-independent, and it is the larger half of sounding like a story.** A
synthesiser pauses about the same 180ms at a comma as at a full stop, which is why one utterance per
beat is a recitation. There is no parameter for it — the Web Speech spec allows SSML and no browser
implements `<break>`. So `splitForSpeech` cuts each beat at *sentence* boundaries (never clauses:
that loses the intonation contour) and the beat is spoken as a queue with silence this module times
— 700ms after the first sentence, which names the place the camera is arriving on, 420ms between the
rest, and the final sentence a shade slower as a cadence fall. **The prompt and the player are one
design**: `buildStoryPrompt`'s "writing for the ear" rules exist because the model's full stops
*are* the narration's breaths. Change either and re-read the other, and bump
`STORY_PROMPT_VERSION` — it is in the cache key, and without it a prompt improvement is invisible on
every day that already has a script.

Five `speechSynthesis` realities are handled in `storyVoice.ts` and must not be "simplified" back:
`cancel()` immediately followed by `speak()` drops the utterance in Chromium (hence `LEAD_IN_MS`); a
cancelled utterance still fires `onend` in WebKit (hence the `done` latch, or Next would advance
twice); `onend` sometimes never arrives (hence the 2.5x watchdog); a platform can present a complete
API that **never speaks** — a headless browser, a desktop with no speech-dispatcher — so
`START_GUARD_MS` puts a 2s deadline on `onstart` and the controller latches `voiceBroken` and
replays that beat as a timed one; and macOS ships ~25 *novelty* voices that Chrome exposes as
ordinary English ones (`Bad News` sings the text to a funeral march), so `pickVoice` carries a deny
list — nothing in a voice's `lang`, `localService` or `default` distinguishes them.

Pause/resume **re-speaks the current beat from its start** rather than picking up mid-sentence.
`speechSynthesis.pause()`/`resume()` exist and are unreliable across engines in the way that matters
here — a pause that does not take leaves the voice talking over a stopped camera.

**Kokoro is loaded from a CDN at runtime and synthesises in a Blob worker, and both are structural.**
`kokoro-js` pulls in `onnxruntime-web`, which embeds a WASM runtime as bytes — the exact class of
dependency whose minified re-encoding once shipped this app with no globe at all (see the
`@spz-loader/core` note above). So it is never in `package.json` and never in a chunk: it is fetched
as a real ES module when the toggle is pressed, which also means people who never press it download
nothing. And the model runs in a worker built from a Blob, not a worker *file* — measured, one
sentence on the WASM backend blocked the main thread for **16.9s** (the map froze; a Next press took
18.4s), against **840ms** worst-case in the worker; and a `new URL("./x.worker.ts",
import.meta.url)` worker is the thing MapLibre's note above records Turbopack silently failing to
serve. **The quantisation follows the backend and the pairing is load-bearing**: on a Metal-3 Mac
`q8` on WebGPU read as fluent nonsense in no language and `fp16` came out distorted, so WebGPU gets
`fp32` (326MB, what kokoro-js's own WebGPU example ships) and WASM keeps `q8` (88MB). Only a
listener can settle which of those is speech — waveform distance cannot, since two correct
renderings differ by 0.7-0.8 relative purely from phase. Speed is the reason to spend the bytes:
measured per sentence in the worker, WASM runs at a real-time factor of ~1.5 (correct and
permanently behind, since the one-sentence prefetch cannot make that up), `fp32` on WebGPU at
0.18-0.25.

**Which one wins, and why the other still exists.** `/api/itinerary` is the incumbent and owns the traveller-facing path: `generate()` in `HomeView.tsx` posts to it with `?stream=1`, and a plan a visitor actually sees always came from there. The staged pipeline is the **intended direction** — it is where the skill/facts/ask separation lives, and it is the one to extend when generation logic changes. Treat `/api/itinerary` as legacy that has not been retired yet, not as the design.

What blocks the migration is a data contract, not missing work: the staged path emits **markdown** into `trip_artifacts`, while every rendering surface (`ItineraryCard`, the day panel, the export, `applyPatch`) reads a strict-JSON `Itinerary` off `trips.itinerary_json`. Switching the wizard needs either a markdown renderer or a converter, and until one exists both paths stay.

**The staged pipeline is not dead code, and it is easy to conclude that it is.** Its callers live under `src/components/backend/` and `src/app/backend/`, so a non-recursive grep over `src/app/*.tsx src/components/*.tsx` finds nothing and reports it unwired — that mistake has been made. What is actually true:

- `trip-fetch` runs on the **traveller path**. `HomeView.tsx` fires it unawaited when the traveller leaves the basics step, to warm the cache and fill `rawFetch` for the profile step's POI picker and the generation loader's facts. It is not optional.
- `trip-submit` / `trip-prepare` / `trip-generate` are driven by `StagedPipelineConsole`, rendered at `/backend/pipeline`, whose `page.tsx` calls `notFound()` unless `NODE_ENV === "development"` — the same check `devLabel` uses. It is already unreachable in production, so it needs no further flagging.
- `generateItinerary()` is shared by `/api/trip-generate` and `src/lib/bench/runBenchmark.ts`, deliberately, so the benchmark measures the same function the route calls.

So: don't flag these off, and keep `src/lib/stagedFlow.ts` in step when a route moves — the `/backend/pipeline` diagram is generated from it.

### Fail-soft is the house convention

External fetches degrade rather than throw. Two idioms to match:
- Clients return `null` for "the fetch failed" vs `[]`/`{}` for "fetched fine, nothing found" — the caller needs to tell those apart (see `src/lib/holidays.ts`, `poiDetails.ts`).
- Bundles carry per-field `available`/`estimated` flags rather than relying on empty arrays (`RawFetch`, `ReconciledTrip.notes`). `src/lib/reconcile.ts` centralizes every partial-failure rule — put new ones there, not scattered at call sites.

### Data sources (most free; three need keys)

Open-Meteo (geocoding, forecast, historical fallback beyond a 16-day horizon, sunrise/sunset, timezone), Nager.Date (public holidays), Overpass/OSM (highway geometry, city boundaries, POI opening hours, **and the map's place search**), GDELT (destination safety coverage via `src/lib/destinationSafety.ts`, no key needed), OpenTripMap (candidate POIs, needs `OPENTRIPMAP_API_KEY`; absent key degrades to no suggestions rather than erroring), Yelp Fusion (dietary-matched venue examples via `src/lib/dietaryVenues.ts`, needs `YELP_API_KEY`; absent key degrades to no venue examples rather than erroring), Brave Search (destination festivals/events via `src/lib/destinationFestivals.ts`, needs `BRAVE_API_KEY`; absent key degrades to no festival suggestions rather than erroring).

`src/lib/placeSearch.ts` is the one place with a **swappable** provider: Google Places when `GOOGLE_PLACES_API_KEY` is set, Overpass otherwise. It is also the only caller that fails across Overpass *mirrors* — a search box generates exactly the traffic a shared community instance rate-limits, and being turned away is the ordinary case rather than the exceptional one. It returns `available: false` for that, distinct from `[]` for "this neighbourhood has no cafés"; the UI says "search is busy" rather than lying about the neighbourhood.

### Chat memory is reconstructed, not held

The model holds no state between calls on either transport. What differs is where the transcript that gets replayed lives.

The CLI kept it in `~/.claude/projects/<slugified-cwd>/<session-id>.jsonl` and `--resume` replayed the whole file — which buys *continuity, not savings*: a six-word follow-up measured at 13,475 input tokens against 13,332 for the turn that established the context. The API path replays from the `llm_sessions` table instead, with a cache breakpoint on the last replayed message so the stable prefix bills at ~0.1x.

Three things carry chat state, and only the first is the model's:

1. **`llm_sessions` / the JSONL** — the conversation. Generation runs with `session: {persist: true}`, so the session is **seeded with the generate prompt and its response**. That is why chat inherits the planner's own reasoning (why the temple went before lunch, what it already rejected) rather than a summary of its output — and why `buildResumedChatPrompt` can send only the traveler's message.
2. **`trip_chat_turns`** — the traveler's transcript, for redisplay. Ordered by AUTOINCREMENT `id`, never `created_at`, which ties.
3. **`syncedHash`** — drift detection. `itineraryFingerprint()` catches the plan changing behind the session's back (element edits are a separate call, `applyPatch` can reject ops, the board reorders with no model involvement) and injects a `<plan_changed>` block. Transport-agnostic; don't touch it when working on transports.

**A resume with no stored conversation must throw, not proceed.** The resumed prompt is tiny by design and assumes the rules, context and plan are already in the conversation; running it against an empty history hands the model a bare question and it will answer anyway. `/api/trip-edit` already catches that and rebuilds the full prompt — the API path throws into that same recovery rather than duplicating it. This fires for real whenever a trip generated in one mode is chatted with in the other.

### Storage

SQLite via `better-sqlite3`, single file `tripmate.db` at repo root. `generations` holds one row per itinerary generation — the context payload, the full prompt and the full response, keyed by run id — written the moment the model answers and *before* the parse, so a response that fails `parseJsonResponse` is still on disk. It is deliberately **not** a `trips` row: it is keyed by run and holds unparsed text, so it can record a generation that never produced a renderable plan.

A `trips` row, by contrast, now exists from the moment a plan does. `trips.status` is `'draft'` until the traveller presses Keep and `'saved'` after — an itinerary used to live in React state until Save ran, so a Back press threw the whole generation away. Save **promotes the same row** (`promoteTripToSaved`) rather than inserting, which is what keeps the plan's `chat_session_id`, its `generations.trip_id` link and its pre-save edits attached to the trip they belong to. `POST /api/trips` back-fills `generations.trip_id` when the draft is created. **`listTrips()` defaults to `status = 'saved'`** — the memories wall, `/profile` and `/trip/latest` all mean "trips somebody kept" — and unkept drafts are swept after `DRAFT_TTL_DAYS` (`src/lib/drafts.ts`) on read from `/trips` and `GET /api/trips`, this app having no scheduler. `src/lib/db.ts` creates every table at import time with `CREATE TABLE IF NOT EXISTS`, and adds later columns through the `addColumnIfMissing()` PRAGMA guard — follow that pattern instead of writing migration files. Note the deliberate split: DB rows are `snake_case` (`TripRow.start_date`), API/type surfaces are `camelCase` (`TripSummary.startDate`), mapped by hand in each route.

## Gotchas

- **Calendar dates are parsed as UTC midnight.** `new Date("2026-09-19")` formatted with local accessors rolls back a day anywhere west of Greenwich. Use `getUTC*()` / `timeZone: "UTC"` for anything date-only — this has already caused a wrong day-of-week to reach generated output.
- **`AGENTS.md` is rewritten by `next dev`.** Deleting it from a diff just recreates the uncommitted change; commit it with your work.
- **Don't compare `created_at` against SQLite's `datetime()`.** Every timestamp in this DB is written
  as `new Date().toISOString()` — `2026-08-21T21:41:26.123Z`, with a `T` and a `Z`. SQLite's
  `datetime('now','-10 minutes')` returns `2026-08-21 21:26:50`, space-separated. Compared as
  strings, `T` (0x54) beats `' '` (0x20), so `created_at > datetime('now', …)` silently matches
  **every row whose date is today**, whatever its time — it looks like a working filter and returns
  far too much. Build the cutoff as an ISO string instead
  (`node -e "console.log(new Date(Date.now()-15*60000).toISOString())"`) so both sides share a
  format. `tagRunsCreatedBetween()` is safe because it compares ISO to ISO.
- Geocoding misses are **deliberately non-blocking** (an Open-Meteo outage shouldn't read as "the app is broken"). Don't convert them into hard validation errors — see the comments in `src/app/page.tsx` and `src/app/api/itinerary/route.ts`.

## Docs convention

`docs/` holds living trackers (`backend.md`, `frontend.md`, `llm.md`, `system-design.md`), indexed by `docs/project-crux.md`, which also defines the maintenance rules: each has **Features / Enhancements / Bugs** tables with a **Developer** column. New feature → new row with a `Since` date and your name; a tweak → edit the row in place; a replacement → collapse `Status` into an `Eliminated` `<details>` and add the successor as its own row. Contributors log under their own name (Aryan, Zaid, Claude). Some rows describe superseded UI — treat `DESIGN.md` (rewritten from the built app) as more current for visual/theme questions.
