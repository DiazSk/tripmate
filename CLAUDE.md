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
```

**`npm run build` fails the build if any emitted chunk cannot be parsed.** That second step is
not ceremony. `next build` reported success for months while shipping a Cesium chunk no browser
could parse: `@spz-loader/core` embeds its WASM decoder as a string of raw bytes, and SWC's
minifier re-encoded it as a template literal, where a NUL byte followed by a digit is an illegal
escape. Production served a 200 and rendered the whole interface **with no globe at all** — in
Chromium, Firefox and WebKit alike. `next dev` never showed it because dev does not minify, and
neither `tsc`, `eslint` nor `node --test` can see a bundler's output. `shims/spz-loader-core.ts`
is the fix (aliased in `next.config.ts`); `scripts/verify-build.mjs` is the guard.

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
2. **Staged pipeline** (newer, built step-by-step, not yet wired into the UI): `trip-submit` (validate) → `trip-fetch` (2a, preference-independent data) ∥ Q&A in `page.tsx` (2b) → `trip-prepare` (barrier/reconcile + POI enrichment) → `trip-generate` (digest facts into `trip-context.md`, then one LLM call combining skill + context + a fixed ask). Emits **markdown**, persisted to `trip_artifacts` keyed by `run_id`.

The pipeline's governing separation: the **skill** (`.claude/skills/itinerary-planner/SKILL.md`) holds planning *rules*, `trip-context.md` holds *facts only* (no instructions), and `src/lib/generationPrompt.ts` holds the *ask* with no trip data. Don't duplicate rules into the prompt or facts into the skill.

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
