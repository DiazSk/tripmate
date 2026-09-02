# Streaming itinerary reveal

**Date:** 2026-09-01
**Status:** design approved, not yet implemented
**Branch:** `feat/streaming-itinerary-reveal`

## The problem

Generating a plan takes about five minutes and shows nothing of the plan while it
runs. `GenerationScreen` fills that wait with a destination photograph, a rotating
feed of facts and a four-step progress strip — real work, and better than the
spinning orb it replaced — but none of it is the thing the traveller asked for. A
strip that advances four times in five minutes reads as "possibly stuck" no matter
how honest it is.

The plan itself is the best possible progress indicator, and it exists incrementally:
the model writes day 1 before it writes day 5. Today that ordering is thrown away,
because `runGeneration` awaits one whole response before anyone sees a single stop.

## What this builds

The live MapLibre map becomes the wait. Stops appear in the itinerary card as the
model writes them, and their pins drop onto the map a few seconds later once that
day's coordinates resolve. `GenerationScreen` retires; the result view *is* the
loading state.

The wait also gets genuinely shorter, not just better-furnished: critique moves off
the critical path, so the plan becomes interactive after generate rather than after
generate *and* critique.

Measured medians from `llm_traces` (see `STAGE_SECONDS` in `generationStages.ts`):

| | today | after |
|---|---|---|
| First stop's text visible | ~310s | ~25-35s |
| First pin on the map | ~310s | ~60-90s |
| Plan interactive | ~310s | ~160s |
| Critique applied | ~310s | ~310s, but in the background |

Text at ~25-35s is geocode and context (~13s) plus the model's first day. The pin
trails it by that day's Overpass resolution (~25s), which is why §5 shows text before
pins rather than waiting to show both.

## Approach

**Incrementally parse the model's JSON token stream.** The prompt is unchanged, the
model's output format is unchanged, and the response stored in `generations.response`
is byte-identical. The only new thing is reading the text as it arrives instead of
only at the end.

The parse is deliberately small: buffer the text, strip a leading code fence, append
whatever brackets the buffer is currently missing, `JSON.parse` the result, and diff
against what has already been emitted. `JSON.parse` does the work; the module only
tracks how much has been reported.

### Alternatives considered and rejected

**Change the output format to NDJSON (one day per line).** Trivially parseable
incrementally, but the response shape is read by `parseJsonResponse`, `insertGeneration`,
the trace viewer, `perfAggregate.ts` and the benchmark. Changing it to make streaming
easier trades a large blast radius for a parser that is forty lines either way.

**Split generate into one call per day.** Loses the whole-trip budget reasoning that
makes the plan coherent — §12 of the planner skill balances spend across days, which
a per-day call cannot see. Also more expensive and, with per-call overhead, probably
slower overall.

## Design

### 1. Transport: `onText` on `runClaude`

`RunMeta` gains `onText?: (delta: string) => void`. Both transports call it; nothing
else about `runClaude`'s contract changes, including its return value.

**API path.** The stream already exists — `claude.ts` calls
`anthropic.messages.stream(…).finalMessage()`. Attach `.on("text", onText)` before
awaiting `finalMessage()`. `finalMessage()` returns the same assembled message it
returns today, so the trace row, `usage`, `stop_reason` and the computed cost are
unchanged.

**CLI path.** Add `--output-format stream-json` and parse stdout line by line rather
than accumulating it whole. `content_block_delta` events feed `onText`; the final
`result` event is the envelope the code already parses.

This is the riskiest change in the design. CLAUDE.md is explicit that
`llm_traces.raw_response` holds two envelope shapes side by side and that
`parseUsage()` in `runs.ts` and `perfAggregate.ts` branch on which one they are
reading. The final `result` event must land in `raw_response` in exactly the shape a
non-streamed CLI call writes today. Verification is a diff of a real trace row
before and after the change, on both transports — not a typecheck.

If the CLI's stream-json envelope turns out to differ from its one-shot envelope in
any field `parseUsage()` reads, the fallback is to keep accumulating full stdout for
the trace and use the line stream only for `onText`. That costs nothing and removes
the risk entirely.

### 2. Parser: `src/lib/streamingItinerary.ts`

A new module, pure and deterministic, with no imports beyond types.

```
feed(delta: string): {
  stops: { dayIndex: number; stopIndex: number; stop: Stop }[];
  closedDays: number[];
}
```

Rules:

- A stop is emitted only once every field required to render it is present. A
  half-written `name` must never reach the map.
- A stop is emitted at most once. The module holds the count already reported per day.
- A day is reported closed when its `stops` array closes, which is the signal to
  resolve that day's coordinates.
- A leading ```` ```json ```` fence is stripped, matching `parseJsonResponse`.
- Malformed text is not an error. If the appended-brackets parse fails, the module
  reports nothing and waits for more input. This is the normal case mid-token.

The module is the whole of the risky logic and it is pure, which is exactly what this
repo's narrow test suite covers well.

### 3. Runner: two new events, and `placing` shrinks to a sweep

`runGeneration` gains two emissions alongside the existing `StageEvent`:

- `stop` — `{ dayIndex, stopIndex, stop }`, straight from the parser.
- `day-coords` — `{ dayIndex, coords: Record<name, {lat, lon}> }`.

When the parser reports a day closed, fire `resolveNamedPlaceCoords` for that day's
stop names and **do not await it**. Its `.then` emits `day-coords`. Awaiting would
stall the parse behind a ~25s Overpass call and defeat the whole feature.

Per-day unions are safer on Overpass than the current whole-trip one, not riskier:
`resolveNamedPlaceCoords`'s own comment records that granularity was the problem
(two clauses per name → 504), and a four-name union is smaller than a forty-name one.
They also spread across the 145s generate window instead of landing in one block.

The existing `placing` stage does not disappear from the stage vocabulary — it
shrinks to a sweep over whatever did not resolve during the stream. Days whose
lookup failed keep the model's coordinates, which is today's fail-soft behaviour
unchanged.

### 4. Critique moves off the critical path

The SSE stream stays open past the plan.

- New `plan` event carries what `done` carries today, and means "interactive now".
- `critique` stage events continue to report as they do.
- New `revised` event carries critique's output.
- `done` still closes the stream, after critique.

`plan` is therefore not terminal, and the client must not stop reading on it. This is
the one place the streaming and non-streaming paths genuinely diverge in behaviour
rather than only in presentation: **`POST /api/itinerary` without `?stream=1` keeps
today's blocking semantics**, returning a single fully-critiqued result. It has no
channel to deliver a later revision, and inventing one for a fallback nobody normally
hits is not worth it. `runGeneration` stays the single implementation for both, with
critique's placement determined by whether an `onStop` sink was supplied.

**Edit collision.** A traveller can drag a stop, or run an element edit, while
critique is still running — and critique replaces the whole day set
(`itinerary.days = critique.revisedDays`). The client holds an `editedSincePlan`
flag, set by any local mutation between the `plan` and `revised` events, and applies
`revisedDays` only when it is false. On a mismatch it takes critique's `issues` and
discards the day replacement.

A flag rather than the `itineraryFingerprint()` drift check `/api/trip-edit` uses,
for a reason that is decisive rather than stylistic: **`itineraryFingerprint` cannot
run on the client at all.** It lives in `editPrompt.ts`, which imports `createHash`
from `crypto`. Hashing would also be answering a harder question than this one —
`syncedHash` exists to detect drift a *server* session was never told about, across
process boundaries. Here both events land in one client that performed any edit
itself, so it already knows the answer without computing it.

**Abandonment is fail-soft.** If the traveller navigates away before `revised`
arrives, the critique is lost. Acceptable: the plan is already persisted as a draft
`trips` row by then, and critique already fails outright about 35% of the time with
the plan surviving.

### 5. UI: the result view is the loading state

`HomeView` holds a `draftItinerary` assembled from `stop` and `day-coords` events and
hands it to the itinerary card and `StopMarkerLayer` that already exist. No new
rendering components. The map is live from the first frame.

`GenerationScreen` retires, and it owns three things that must survive or this is a
net regression:

- **Cancel.** Non-negotiable; the abort path in `runStreamed` already exists.
- **The progress strip.** Still meaningful — it is what covers the gap before the
  first stop arrives, and what reports the background critique afterwards.
- **The rotating destination facts.** This feed was the entire point of the screen's
  last rewrite, and dropping it silently would be a regression disguised as a
  feature. It needs a real home.

All three move into the darkened foot band `GenerationScreen` already uses, now over
the live map. That band was designed for legibility over busy ground, which is the
problem being re-introduced, so it is the right piece to keep.

**Camera behaviour is deliberately unspecified here.** Framing the growing bounds and
following the newest pin are both defensible and the difference is a felt one. It
gets decided in the browser against a real generation, not on paper.

### 6. Testing

- `src/lib/streamingItinerary.test.mjs` — pure, deterministic, no framework. The case
  that will break the parser is a chunk boundary splitting a token mid-field, which
  is the same bug class `eventStream.ts` documents in its own comment. Test it
  explicitly by feeding one known payload at every possible split point.
- `tsc --noEmit`, `eslint`, `npm test`.
- Real generations against a running dev server on **both** transports, checking a
  trace row's `raw_response`, `cost_usd` and `parseUsage()` output against a
  pre-change row. Typecheck proves nothing about envelope integrity.
- `npm run build`, since `verify-build.mjs` is the only thing that sees bundler output.

### 7. Deliberately not built

No new marker component, no new panel component, no partial-JSON dependency, no
second HTTP endpoint for critique, no cancellation token threaded into `runClaude`.

## Risks

1. **The CLI `stream-json` envelope can silently corrupt traces.** The one change here
   that could break something unrelated to this feature. Mitigated by the fallback in
   §1 and by verifying against a real trace row rather than a typecheck.
2. **Retiring `GenerationScreen` can quietly drop the destination-facts feed.** §5
   gives it a home; if that home does not work visually, the facts stay and the
   screen's retirement is what gets reconsidered — not the other way round.
3. **A plan can change while someone is reading it.** The fingerprint guard in §4
   covers "they edited it", not "they were mid-sentence". Partly a copy problem: the
   background review needs to be visibly in progress so a change is expected rather
   than startling.
