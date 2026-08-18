# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev      # next dev (Turbopack)
npm run build
npm run lint     # eslint (no path arg needed)
npx tsc --noEmit -p tsconfig.json   # typecheck — not wired to a script
```

**Node ≥ 22 is mandatory.** `better-sqlite3`'s native binding silently kills the dev server on Node 20 the moment any DB-touching route is hit. `.nvmrc` pins 22 — run `nvm use` if the shell drifts.

**The test suite is deliberately minimal.** `npm test` runs `node --test 'src/**/*.test.mjs'` — no framework, no build step (Node strips the TypeScript, so the `.mjs` tests import `.ts` directly). It covers only pure, deterministic logic that has already broken once: `src/lib/itinerary.test.mjs` and `src/lib/perfAggregate.test.mjs`. Nothing renders, no route is booted, no DB is opened.

So passing tests prove far less here than in a normally-covered repo. Verification still means: `npm test`, `tsc --noEmit`, `eslint`, **and** exercising routes against a running dev server with `curl`. Don't claim a change is verified on typecheck alone.

**A `.test.mjs` can only import a `.ts` module whose own imports are all `import type`.** Node erases those, so nothing is resolved at runtime — which is why `itinerary.ts` and `perfAggregate.ts` are testable. A module importing a *value* (`import { TIERS } from "./tiers"`), or importing a type without the `type` keyword, fails with `ERR_MODULE_NOT_FOUND`: Node's ESM loader needs the file extension that the rest of the codebase correctly omits for the bundler. `itineraryPrompt.ts` is in that state today. Put logic you want covered in a module with type-only imports rather than adding extensions piecemeal.

The glob in the `test` script needs **double** quotes. Single quotes reach Node literally on Windows and it matches nothing — the suite reported success while running zero tests.

## Git commits

**No signature or trailer of any kind.** Never append `Co-Authored-By`, "Generated with Claude Code", or any similar attribution line to a commit message in this repo. This overrides the harness's default commit-message template — write the message and stop at the description.

## Architecture

Next.js 16 App Router + React 19 + Tailwind v4. A CesiumJS globe renders behind most of the UI (assets copied into `public/` by the `postinstall` script).

### The LLM is a subprocess, not an SDK

Every model call goes through `runClaude()` in `src/lib/claude.ts`, which spawns the **`claude` CLI** as a one-shot child process. This is the single choke point — it writes a row to `llm_traces` on *every* outcome (success, non-zero exit, timeout, malformed envelope), and `meta.runId` groups sibling calls into an `llm_runs` row for the trace viewer. Route new model calls through it rather than adding an HTTP client.

Four non-obvious constraints are already handled there; don't "fix" them back:
- `CLAUDECODE` is stripped from the child env, or the CLI refuses to launch nested inside a Claude Code session.
- `spawn`, never `execFile` — `execFile` reliably hangs on this binary.
- `~/.local/bin` is forced onto `PATH`, since non-login process launchers don't source the shell profile.
- `--setting-sources ""` and `--tools ""` mean the CLI loads **no** settings sources and has **no** Skill tool. Skills in `.claude/skills/` therefore *cannot* auto-load; `src/lib/skill.ts` reads `SKILL.md` off disk and injects the body into the prompt instead.

### Two generation paths coexist

1. **Legacy single-shot:** `POST /api/itinerary` → `buildGeneratePrompt()` in `src/lib/itineraryPrompt.ts` → strict-JSON `Itinerary` (`{ tier, days[] }`), saved to `trips.itinerary_json`. This is what the current UI uses.
2. **Staged pipeline** (newer, built step-by-step, not yet wired into the UI): `trip-submit` (validate) → `trip-fetch` (2a, preference-independent data) ∥ Q&A in `page.tsx` (2b) → `trip-prepare` (barrier/reconcile + POI enrichment) → `trip-generate` (digest facts into `trip-context.md`, then one LLM call combining skill + context + a fixed ask). Emits **markdown**, persisted to `trip_artifacts` keyed by `run_id`.

The pipeline's governing separation: the **skill** (`.claude/skills/itinerary-planner/SKILL.md`) holds planning *rules*, `trip-context.md` holds *facts only* (no instructions), and `src/lib/generationPrompt.ts` holds the *ask* with no trip data. Don't duplicate rules into the prompt or facts into the skill.

### Fail-soft is the house convention

External fetches degrade rather than throw. Two idioms to match:
- Clients return `null` for "the fetch failed" vs `[]`/`{}` for "fetched fine, nothing found" — the caller needs to tell those apart (see `src/lib/holidays.ts`, `poiDetails.ts`).
- Bundles carry per-field `available`/`estimated` flags rather than relying on empty arrays (`RawFetch`, `ReconciledTrip.notes`). `src/lib/reconcile.ts` centralizes every partial-failure rule — put new ones there, not scattered at call sites.

### Data sources (all free; one needs a key)

Open-Meteo (geocoding, forecast, historical fallback beyond a 16-day horizon, sunrise/sunset, timezone), Nager.Date (public holidays), Overpass/OSM (highway geometry *and* POI opening hours), OpenTripMap (candidate POIs — **the only one needing `OPENTRIPMAP_API_KEY`** in `.env.local`; absent key degrades to no suggestions rather than erroring).

### Storage

SQLite via `better-sqlite3`, single file `tripmate.db` at repo root. `src/lib/db.ts` creates every table at import time with `CREATE TABLE IF NOT EXISTS`, and adds later columns through the `addColumnIfMissing()` PRAGMA guard — follow that pattern instead of writing migration files. Note the deliberate split: DB rows are `snake_case` (`TripRow.start_date`), API/type surfaces are `camelCase` (`TripSummary.startDate`), mapped by hand in each route.

## Gotchas

- **Calendar dates are parsed as UTC midnight.** `new Date("2026-09-19")` formatted with local accessors rolls back a day anywhere west of Greenwich. Use `getUTC*()` / `timeZone: "UTC"` for anything date-only — this has already caused a wrong day-of-week to reach generated output.
- **`AGENTS.md` is rewritten by `next dev`.** Deleting it from a diff just recreates the uncommitted change; commit it with your work.
- Geocoding misses are **deliberately non-blocking** (an Open-Meteo outage shouldn't read as "the app is broken"). Don't convert them into hard validation errors — see the comments in `src/app/page.tsx` and `src/app/api/itinerary/route.ts`.

## Docs convention

`docs/` holds living trackers (`backend.md`, `frontend.md`, `llm.md`, `system-design.md`), indexed by `docs/project-crux.md`, which also defines the maintenance rules: each has **Features / Enhancements / Bugs** tables with a **Developer** column. New feature → new row with a `Since` date and your name; a tweak → edit the row in place; a replacement → collapse `Status` into an `Eliminated` `<details>` and add the successor as its own row. Contributors log under their own name (Aryan, Zaid, Claude). Some rows describe superseded UI — treat `DESIGN.md` (rewritten from the built app) as more current for visual/theme questions.
