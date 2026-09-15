# TripMate API contract, v1 (iOS client)

**Status: frozen.** This is the contract the native iOS client is built against. Two people work
from it in parallel — the iOS track builds against a mock server returning these shapes before the
backend work lands — so a change here is a change to someone else's in-flight work. Amend it by
agreement, in its own commit, never as a side effect of a route edit.

Every shape below was read off the route handlers, not inferred. `file:line` references point at
the source of truth; when they disagree with this document, **the code wins and this document is a
bug.**

Two markers appear throughout:

- **[today]** — implemented and verifiable against a running dev server right now.
- **[A2]** / **[A3]** / **[A4]** — agreed, not yet built. Named for the plan phase that lands it.
  The iOS client codes against these; the mock server implements them from day one.

## Scope

In: the traveler-facing surface. `itinerary` (+`?stream=1`), `trips`, `trips/:id`,
`trips/:id/export`, `trip-fetch`, `trip-chat`, `trip-edit`, `trip-story`, `destination-context`,
`place-detail`, `place-photo`, `place-search`, `nearby-pois`, `arrival-points`, `geocode`, `roads`,
`city-context`, `profile`.

Out, and deliberately: `/api/llm-traces/*`, `/api/bench`, `/api/llm-mode`, and the staged pipeline
(`trip-submit` / `trip-prepare` / `trip-generate`). All dev-console only —
`src/app/backend/pipeline/page.tsx` calls `notFound()` outside development. Also out:
`mode: "element"` on `/api/trip-edit`, which the route supports but **no client calls**; it is not
parity, so it must not be an iOS surface first.

## Transport

| | |
|---|---|
| Base URL | `TRIPMATE_API_BASE`, per build configuration. No trailing slash. |
| Content type | `application/json` both directions, except `trips/:id/export` (see below). |
| Casing | DB rows are `snake_case`; **every API surface is `camelCase`**. `src/lib/tripPayload.ts` centralizes the mapping for trips. |
| CORS | Not applicable. `URLSession` is not subject to it and `next.config.ts` configures none. |
| Auth **[A2]** | `Authorization: Bearer <identity token>`, verified server-side against Apple's public keys. |

**Identity today [today]** is a cookie, not auth. `src/proxy.ts` mints `tripmate_owner`
(httpOnly, sameSite lax); `src/lib/owner.ts:12-16` states plainly that it *"deliberately is NOT an
authorization boundary."* A native client that sends no cookie resolves to `LEGACY_OWNER` and sees
every legacy-bucket trip. Do not build on this — it is what **[A2]** replaces.

## Decoder rules

These are not style preferences. Each one comes from a real quirk in a real handler, and a strict
decoder breaks on every one of them.

**1. One lenient `JSONDecoder`. Never reject unknown keys.**
`toTripPayload`'s detail mapper spreads unvalidated stored JSON
(`src/lib/tripPayload.ts:36-38`): `itinerary: { ...stored, days: normalizeDays(stored.days) }`,
where `stored` is `JSON.parse(row.itinerary_json)` with no shape check. Only `days` is normalized;
every other key on that blob passes through verbatim.

**2. `Itinerary.tier` is optional.** Direct consequence of rule 1 — a row written before `tier`
existed has no `tier`, and nothing adds one. Model as `TierId?`.

**3. Two coordinate types, not one.** `lat`/`lng` and `lat`/`lon` both appear and are not
interchangeable:

| Spelling | Where |
|---|---|
| `lng` | `Stop` (`types.ts:12-13`), `/api/geocode` response, `/api/roads`, `/api/nearby-pois` query |
| `lon` | `CandidatePoi` (`pois.ts:3-4`), `ReconciledTrip.selectedPois`, `EnrichedPoi`, the SSE `day-coords` payload, **and `/api/arrival-points`' query param** |

`/api/geocode` renames `lon`→`lng` on the way out. `/api/arrival-points` is the only geo route
taking `lon` as a query param. Use per-site `CodingKeys`; a shared `Coordinate` will be wrong half
the time.

**4. `StopCategory` and `PlaceCategory` need unknown-value fallbacks.**
`StopCategory` is `food | entry | transit | other`, coerced by `normalizeCategory()` inside
`normalizeDays` — but **`normalizeDays` runs on trip *reads*, not on SSE `stop` frames.** A
streamed `stop.category` can be an arbitrary string and a streamed `stop.cost` can be a *string*,
while the same stop re-read from `GET /api/trips/:id` is clean. Decode unknown → `.other`, and
decode `cost` leniently on the streaming path specifically.
`PlaceCategory` separately carries a seventh value `"place"` that is not in `PLACE_CATEGORIES`.

**5. Nullable means explicitly `null`, not absent** — everywhere except `runGeneration`'s
`sessionId`, which is genuinely absent when unknown.

**6. `/api/trip-chat` turns are an open shape.** The handler builds `{role, content, createdAt}`
then spreads `JSON.parse(meta_json)` on top. In practice meta carries `changes`, `warnings`,
`daysModified`, `knockOn`, `rejected` — but nothing constrains it, and the spread **can overwrite
`role` or `content`**. Decode the three known fields as required, the five as optional, and never
strictly.

**7. `PatchOp` never crosses the wire.** `/api/trip-edit` consumes ops from the model internally
and returns only the applied `itinerary` plus `rejected: [String]`. The six-case discriminated
union needs no Swift decoder.

## Streaming: `POST /api/itinerary?stream=1`

The intricate one. Verified against `src/app/api/itinerary/route.ts:145-217` and the web client's
own parser, `src/lib/eventStream.ts`.

Response headers: `text/event-stream`, `Cache-Control: no-store`,
`X-Content-Type-Options: nosniff`, `X-Accel-Buffering: no`.

**Two frames that are not events and must be skipped:**

1. **A padding frame arrives first**: `:` followed by **2048 spaces**, then `\n\n`
   (`route.ts:21`). WebKit buffers a streamed response until 1024 bytes have arrived, so without
   this the first real events sit invisible and then flush at once.
2. **A keepalive `:\n\n` every 20 s** (`route.ts:168`). The generate wait is 60–150 s and is
   otherwise silent; nginx and ALB idle timeouts are ~60 s, Cloudflare ~100 s.

**Parser rules the Swift reader must replicate** (all from `eventStream.ts`):

- Frames are separated by `\n\n`. **A chunk boundary can split a frame mid-way** — buffer raw text
  across reads. This is the one thing a one-chunk-equals-one-frame parser gets wrong under real
  network conditions.
- Skip any line starting with `:`.
- `event:` and `data:` prefixes, values trimmed. Absent `event:` defaults to `message`.
- **A frame whose `data` is empty is dropped, not dispatched.**
- **An unterminated trailing frame is dropped deliberately.** Detect "the stream ended with nothing
  usable" by whether you ever received `done` or `error` — not by an error from the reader.

**Events:**

| Event | Data | Notes |
|---|---|---|
| `stage` | `{stage, status}` | `stage` ∈ `geocode, context, generate, critique, placing`; `status` ∈ `start, done, skipped, failed`. Progress is **not** a wire percentage — the web client interpolates locally from `STAGE_SECONDS`. |
| `stop` | `{dayIndex, stopIndex, date, stop}` | One stop parsed out of the model's streaming text. `date` is `""` when the model omitted it. Subject to decoder rule 4. |
| `day-coords` | `{dayIndex, coords: {[name]: {lat, lon}}}` | Geocode fix-ups, keyed by stop name. Note `lon`. |
| `plan` | `{itinerary, traceId, runId, sessionId?}` | The plan is interactive **now**; the run is not over. |
| `revised` | `{days, issues}` | Background critique replaced the day set. The web client **drops this if the user edited since `plan`**. |
| `done` | same shape as `plan` | Stream end. |
| `error` | `{error}` | See the two rules below. |

**Two rules that are easy to get wrong and both matter:**

- **The `error` frame arrives on an HTTP 200.** There is no status code to check. Surface it
  explicitly or a generation failure looks like a hang.
- **Ignore `error` once `plan` has arrived.** The web client logs and drops it
  (`HomeView.tsx`, "Ruling B") — a late failure must never tear down a plan already on screen.

**Throttle and cap fire before the stream opens**, so 429/503 are real JSON responses even with
`?stream=1`.

**Cancelling does not stop the work, and still bills.** `route.ts`'s `cancel()` records that
`runGeneration` has no cancellation token: an in-flight model call finishes and its result is
discarded. At ~$1.09 per generation this is a cost fact, not a detail — and it is a direct argument
for **[A3]**, where the job outlives the connection and the result is at least kept.

**Non-streaming fallback [today]:** `POST /api/itinerary` without `?stream=1` returns the whole
`{itinerary, traceId, runId, sessionId?}` as one JSON body. The web client falls back to it when
the streaming fetch throws before opening or returns non-200/no body, and **never retries an
`AbortError`**. Mirror that.

**[A3]** `POST /api/itinerary` enqueues and returns `{jobId, runId}`. `?stream=1` becomes a live
view onto the job rather than the job itself; `GET /api/generation-jobs/:jobId` polls; an APNs push
fires on completion. Foreground streams, background falls back to the job. **Both paths resolve to
the same job row** — this is the one place two code paths may produce one result.

## Routes

### Trips

| Route | Request | 200 | Errors |
|---|---|---|---|
| `GET /api/trips` | `?status=draft` (anything else ⇒ `saved`) | `{trips: [TripSummary]}` | none — a failed draft sweep is swallowed |
| `POST /api/trips` | `{destination, startDate, endDate, budget, itinerary, runId?, chatSessionId?, userAnswers?, status?}` | `{id}` — **only the id**, not the trip | 400 `Missing required fields`. Validation is presence-only; `itinerary` is never shape-checked |
| `GET /api/trips/:id` | — | `Trip` | 404 `That trip isn't saved here.` |
| `PATCH /api/trips/:id` | `{itinerary, status?: "saved", chatSessionId?}` | `{ok: true, endDate, days, status}` | 404 `That trip isn't saved here.` · 400 `Missing itinerary` |
| `DELETE /api/trips/:id` | — | `{ok: true}` | 404 — **two different strings**, see below |
| `GET /api/trips/:id/export` | — | **`text/html`**, `Content-Disposition: attachment` | 404 `{error}` as JSON |

`PATCH` specifics, all deliberate and all worth honouring client-side:
- **`endDate` is server-derived**, not echoed — the trip's length is a property of the itinerary
  being saved, so an edit that added a day cannot leave the column disagreeing with the plan.
- **`status` is write-once and one-way.** Only `"saved"` is honoured; absence leaves the column
  alone, so a draft autosave cannot promote a plan the traveler hasn't kept.
- `chatSessionId` is written only for a non-empty string; `null` means "not tracking a session",
  never "clear it".

`DELETE` returns `That trip isn't saved here.` when no such trip exists and `Trip not found` when
it exists but is not yours. **Match on status, never on text.**

`GET /api/trips/:id/export` returns HTML, not JSON — **branch on `Content-Type`.** Route it to a
share sheet.

**Authorization today [today]:** `GET` and `PATCH` are both unscoped; only `DELETE` checks
ownership. Anyone with a trip id can overwrite its itinerary and promote a draft. **[A2]** scopes
`PATCH`; `GET` may stay unscoped so shared links keep working, which is the documented intent.

### Generation and editing

| Route | Request | 200 |
|---|---|---|
| `POST /api/itinerary` | see Streaming above; also `{rebalance: true, destination, tier, remainingDays, remainingBudget, tripId}` → `{days, runId}` (bare `days`, **not** an `Itinerary`) | — |
| `POST /api/trip-fetch` | `{destination, startDate, endDate}` | `{ok: true, rawFetch}` |
| `GET /api/trip-chat?tripId=` | — | `{turns}` — decoder rule 6 |
| `POST /api/trip-edit` | `{mode: "chat", trip, itinerary, messages, dayIndex?, tripId?, userAnswers?, sessionId?, syncedHash?}` | `{ok, runId, sessionId, syncedHash, itinerary, reply, options, changes, warnings, daysModified, why, knockOn, rejected}` |
| `POST /api/trip-story` | `{destination, day, dayIndex, dayCount, tripId}` | `{script: {beats: [{kind, text, stopIndex?}]}, cached?, runId}` |
| `POST /api/place-detail` | `{name, destination, lat, lng, tripId?}` | `{detail, runId}` |

`syncedHash` **must be carried and replayed.** It is `itineraryFingerprint(updated)`, and **`null`
when any op was rejected**; a mismatch on the next turn is how the server detects the plan changing
behind the session's back and re-sends full state. Dropping it silently degrades every later turn.

`rawFetch` is six sibling keys each with **its own inline `available` flag** —
`dateContext`, `destination`, `weather`, `holidays`, `transportModes`, `bikeshare`,
`candidatePois`. There is no shared generic wrapper; each needs its own nested Swift struct.
`transportModes.modes` is `[String]`, not the `TransportMode` enum — do not decode it as one.

### Auth **[A2]** — proposed, needs backend agreement

This is the one shape in this document that was **not** read off an existing handler, because
there is no handler yet. The iOS client is built against it and the mock implements it; **A2 must
either adopt it or amend this section before building something else.**

`POST /api/auth/apple` — unauthenticated by nature, since it is the call that establishes a
session.

```
→ { identityToken, authorizationCode?, fullName?, email? }
← { token, userId, expiresAt? }
```

Three notes, and the first is the one that bites:

- **`fullName` and `email` arrive from Apple only on the very first authorization** for a given
  Apple ID. Every later sign-in returns them nil, by design — Apple treats them as one-time
  information the relying party is expected to have kept. The server must persist them on that
  first exchange or they are gone permanently, and the only recovery is the traveler revoking the
  app in Settings. This is the most common Sign in with Apple defect and it is invisible in
  testing, because the developer's own first sign-in already happened.
- **`identityToken` is exchanged, not used as a bearer.** It is a short-lived JWT verified against
  Apple's public keys; it cannot be refreshed without re-authorizing, so a server-issued session
  token is what the client actually carries.
- `expiresAt` is optional. When absent the client learns of expiry from a 401 rather than
  pre-empting it, which is why the 401 row above is a hard sign-out.

### Lookups

| Route | Request | 200 | Notes |
|---|---|---|---|
| `GET /api/geocode` | `?destination=` | `{lat, lng, name}` | 400 / 404 / 500. **Prefer this over Open-Meteo direct** — the web client calls `geocoding-api.open-meteo.com` from the browser (`src/lib/weather.ts:44,66`); iOS should not. |
| `GET /api/place-search` | `?lat=&lng=&q=&category=&radius=&area=` | `{provider, places, available}` | `category` comma-separated, unknown names silently dropped. `radius` clamped 200–8000, default 1800. `area` is `lat,lng;…`, ≤32 vertices. **Failure is `available: false`, not an error status.** |
| `GET /api/place-photo` | `?name=` | `{thumbnailUrl?, imageUrl?, extract?}` | All three `null` on a miss, deliberately a **200 so the client caches it**. 503 `Lookup failed` is the retryable case — honour that split in the image cache. |
| `GET /api/nearby-pois` | `?lat=&lng=` | `{pois: [CandidatePoi]}` | Always 200. A missing API key is indistinguishable from "nothing here". Fixed 250 m radius, max 8. |
| `GET /api/arrival-points` | `?lat=&lon=` | `{points: [ArrivalPoint]}` | Note **`lon`**. Overpass failure degrades to `{points: []}`. |
| `GET /api/roads` | `?lat=&lng=` | `{segments: [{points: [{lat, lng}]}]}` | 502 on failure. Fixed 30 km radius. |
| `GET /api/profile` | — | `{profile: TravelerProfile \| null}` | Always 200; `null` for no row **or** an unparseable one. |
| `PUT /api/profile` | `{profile}` | `{ok: true}` | 400 `The profile sent wasn't a valid shape.` |

**`/api/profile` is globally single-row today [today]** — the handler calls `readProfile()` /
`writeProfile()` with no owner argument, so both fall to `LOCAL_OWNER` and every device on a
deployment shares one profile. This is the hard multi-user blocker and is **[A2]** work. The
contract shape does not change; the scoping does.

## Error states

All errors are `{error: String}`, with two exceptions that carry a second key — model them
leniently or the extra field is silently dropped:

- `POST /api/trip-submit` → 400 `{error, field}`
- `POST /api/trip-prepare` → 400 `{error, notes}`

Two shared states on every LLM-backed route (`itinerary`, `trip-edit`, `place-detail`,
`trip-story`) and both are first-class UI states, not failures:

| Status | Body | Meaning |
|---|---|---|
| 401 **[A2]** | — | The bearer token was rejected: expired, revoked, or minted by another deployment. **The client signs out; it does not retry.** Nothing it can do makes a rejected token acceptable, and retrying turns one failure into a loop. |
| 429 | `Too many requests — slow down and try again shortly.` | IP throttle. **Buckets on `x-forwarded-for` today**, so carrier NAT puts unrelated users together. **[A2]** re-keys it onto the user id. |
| 503 | `Demo budget for today has been used up — try again tomorrow.` | Rolling-24h spend cap, **global across all users** today. |
| 402 **[A4]** | — | No active entitlement. Free tier reads and views; paid generates and refines. |

**Two routes leak raw internal error text** — `/api/trip-edit` and `/api/place-detail` return
`{error: err.message}` on 500, unlike `/api/itinerary` which deliberately substitutes a safe
string. Never surface these verbatim in the UI; a pre-launch fix matches them to `/api/itinerary`.

## Known ceilings this contract freezes around

Both are in the plan as pre-launch fixes; both are visible to a client and neither is a decoder
concern.

- **21k output-token ceiling.** `API_MAX_TOKENS = 21_000` (`src/lib/claude.ts`), hard-bounded by
  the SDK. `MAX_TRIP_DAYS` is 30. A long trip can truncate, and the client cannot tell truncation
  from a short plan.
- **Strong-tier effort is `"medium"` and its quality was never measured** — 285–330 s at `high`
  against 154.3 s at `medium`.
