# Backend — Feature Tracker

Covers `src/app/api/**`, `src/lib/db.ts`, `src/lib/weather.ts`. See
[`project-crux.md`](./project-crux.md) for how these tables are maintained
(short version: tweak in place; if something is fully replaced, mark it
`Eliminated` with a date instead of deleting the row).

## Features

| Feature | Status | Since | Developer | Notes |
|---|---|---|---|---|
| `POST /api/itinerary` (generate) | Active | 2026-08-04 | Aryan | Geocodes destination, pulls weather, builds prompt, calls Claude |
| `POST /api/itinerary` (refine) | Active | 2026-08-04 | Aryan | Same endpoint; branches on `previousItinerary` + `feedback` being present |
| `GET/POST /api/trips` | Active | 2026-08-04 | Aryan | List saved trips / save a generated itinerary |
| `GET /api/trips/[id]` | Active | 2026-08-04 | Aryan | Fetch one saved trip |
| `DELETE /api/trips/[id]` | Active | 2026-08-17 | Claude | Completes CRUD — the app could create/read/update an itinerary but never remove one. Same 404 guard and copy as the route's GET/PATCH, checked before deleting so "already gone" is a 404 rather than a success. Deletes the `trips` row only: `llm_runs.trip_id` and `trip_artifacts` are left behind deliberately (see the `deleteTrip` note in `db.ts`) — `trip_id` is written but never read or joined, and those rows record that a generation happened rather than holding trip content |
| SQLite `trips` table (`db.ts`) | Active | 2026-08-04 | Aryan | Via `better-sqlite3`, file at `tripmate.db` in project root |
| Weather lookup (`weather.ts`) | Active | 2026-08-04 | Aryan | Geocode + forecast, folded into the generate prompt |
| `preferences` field on `/api/itinerary` | Active | 2026-08-05 | Aryan | Passed through from client, only used on generate (not refine) |
| `GET /api/llm-traces` | Active | 2026-08-05 | Aryan | Paginated (last 100) list of logged Claude calls |
| `GET /api/llm-traces/[id]` | Active | 2026-08-05 | Aryan | Full prompt + raw response for one call |
| SQLite `llm_traces` table (`db.ts`) | Active | 2026-08-05 | Aryan | Standalone table, no FK to `trips` — a trace can exist for a generation never saved |
| `weatherDetail` merged onto each itinerary day | Active | 2026-08-05 | Aryan | `/api/itinerary` attaches the real fetched forecast (by matching date), not the model's free-text guess — powers the frontend's weather icon/popover |
| `GET /api/geocode` | Active | 2026-08-05 | Claude | Thin wrapper around the existing `geocodeDestination()` (`weather.ts`); lets the home page resolve destination → lat/lng fast so the Cesium camera flight can start without waiting on the full `/api/itinerary` (LLM) call |
| `fetchRawTrip()` — Step 2a extracted out of `/api/trip-fetch` | Active | 2026-08-17 | Claude | Route is now the HTTP shell; the benchmark's custom-trip builder calls the same function, so there is one fetch implementation rather than two that drift |
| `GET /api/container-theme` | Active | 2026-08-05 | Aryan | Fetched concurrently with `/api/geocode` on search submit; validates the LLM's JSON shape and falls back to `DEFAULT_CONTAINER_THEME` on empty destination, malformed response, or any error — never blocks or fails the search flow itself |
| `traveler_profile` table + `GET/PUT /api/profile` | Active | 2026-08-16 | Zaid | Durable answers only (group, style, energy, crowds, tier, priorities). `owner_id` carried from the first row so auth can be added without a data migration — see `FUTURE-INTEGRATION.md`. `PUT` refuses unknown enum values rather than storing them |
| `POST /api/itinerary?stream=1` — SSE progress stream | Active | 2026-08-16 | Zaid | Same `runGeneration()` pipeline as the plain JSON response (extracted to `src/lib/generationRunner.ts`), just with an `onStage` emitter instead of a no-op; opt-in via query param so every existing caller (`PipelineConsole`, raw `curl`) is unaffected |
| `dietary` on the traveler profile | Active | 2026-08-16 | Zaid | `{ tags, note }`. A profile stored before this field existed parses to the empty default rather than being rejected, so there is no migration |
| `GET/POST /api/bench` + `bench_results` / `bench_fixtures` tables | Active | 2026-08-17 | Claude | Dev-only. Every verb 404s outside `NODE_ENV === "development"`, matching the `/backend/pipeline` gate. Runs ONE (fixture × model) cell per request — a full sweep in one request would blow past any timeout — and persists each finished cell so a refresh mid-sweep loses nothing. Custom trips built from the form are stored whole in `bench_fixtures`, frozen at creation |

## Enhancements

| Enhancement | Since | Developer | Notes |
|---|---|---|---|
| `/api/itinerary` response now includes `traceId` | 2026-08-05 | Aryan | So the frontend can deep-link to the trace of the call that produced the itinerary |
| `DayWeather` (`weather.ts`) gained `weatherCode` and `humidity` | 2026-08-05 | Aryan | `weatherCode` (WMO code) added to the existing forecast `daily` request; `humidity` is a separate best-effort hourly fetch, averaged per day, merged in — see Bugs/constraints below |

## Deployment prerequisites

- **SSE idle-timeout gap (`POST /api/itinerary?stream=1`):** the stream goes quiet for
  60–150s between `generate: start`/`done` and again for 10–30s during critique.
  `X-Accel-Buffering: no` stops proxy buffering but does nothing for idle-connection
  timeouts — nginx `proxy_read_timeout` (60s default), an AWS ALB (60s idle timeout), and
  Cloudflare (~100s) would all kill the connection mid-wait, and the client would report
  "The planner didn't finish" after a full wait despite the server having succeeded.
  Not built now: the app only runs against a local `claude` subprocess and a local SQLite
  file, so there is no proxy or CDN in front of it yet, and a keepalive for a deployment
  that doesn't exist is exactly the speculative work this feature's spec ruled out. If a
  non-localhost deployment happens, add a `setInterval` in the stream's `start()` that
  enqueues a `:\n\n` comment frame every ~20s, cleared in `finally` and `cancel()` — the
  client parser (`eventStream.ts`) already skips lines starting with `:`, so no client
  change is needed.

## Bugs

| Bug | Found | Fixed | Developer | Notes |
|---|---|---|---|---|
| `better-sqlite3`'s native binding requires Node ≥ 22; dev server started fine on Node 20 but crashed silently the moment any DB-backed route was hit | 2026-08-04 | 2026-08-04 | Aryan | Installed Node 22 via `nvm`, reinstalled `node_modules` to rebuild the native binding |
