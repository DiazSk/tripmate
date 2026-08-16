# Generation progress stream — design

**Date:** 2026-08-16
**Status:** Approved, not yet implemented
**Scope:** One of three deliverables. The others are `FUTURE-INTEGRATION.md`
(done) and the traveler profile (`2026-08-16-traveler-profile-design.md`).
**Depends on:** nothing. Independent of the traveler profile; they overlap only
in `route.ts`, in different functions.

## Problem

Generating an itinerary takes two to four minutes. For all of it the traveler
sees [`GenerationLoader`](../../../src/components/cesium/GenerationLoader.tsx)
cycling five fixed captions on a 2.5-second timer — "Charting the route…",
"Checking the weather…" — that are disconnected from anything the server is
doing. They restart from the top every 12.5 seconds. A wait that long with no
real signal reads as a hang.

The captions are also close enough to true to be misleading. The route really
does check the weather; the loader just has no idea when.

## What makes this honest

The generate path already performs five distinct pieces of work, in order, in
[`src/app/api/itinerary/route.ts`](../../../src/app/api/itinerary/route.ts):

| Stage | Real work | Notes |
|---|---|---|
| `geocode` | Open-Meteo geocode, then forecast for the dates | Fail-soft: a miss leaves weather empty |
| `context` | Destination context — festivals, safety, shopping, trends | 30-day cache hit, or a real Claude call |
| `generate` | The main model call | Roughly 60–70% of wall clock |
| `critique` | Second model call reviewing budget, timing, interest use | Failure leaves the itinerary untouched |
| `placing` | Overpass/OSM coordinate correction on every stop name | Skipped entirely when geocode failed |

`geocode` and `context` genuinely run **concurrently** — `contextInsightPromise`
is kicked off before the geocode block precisely so its latency overlaps.

So this feature reports work that is already happening. It is not a fake progress
bar, and the design should not acquire one later: no interpolated percentages, no
timed animation between stages.

## Goals

1. The loader reflects real server state.
2. Every existing caller of `/api/itinerary` keeps working unmodified.
3. The pipeline is not duplicated to gain a second transport.

## Non-goals

- `rebalance` and `place-detail`. Both are seconds, not minutes.
- The staged pipeline (`trip-*` routes). Separate architecture, separate spec if
  it ever wants this.
- Percentage progress or ETAs. Stage latency varies by trip length and cache
  state; a number would be invented.

## Architecture

### 1. Shared stage vocabulary — `src/lib/generationStages.ts`

One module both the route and the component import, so the wire protocol and the
UI cannot drift. This mirrors how
[`pipelineFlows.ts`](../../../src/lib/pipelineFlows.ts) and
[`stagedFlow.ts`](../../../src/lib/stagedFlow.ts) already centralize node specs.

```ts
export type StageId = "geocode" | "context" | "generate" | "critique" | "placing";
export type StageStatus = "start" | "done" | "skipped";

export interface StageEvent { stage: StageId; status: StageStatus }
```

Plus, per stage, a traveler-facing label and a small set of rotating captions.

**Stage ids deliberately match the node ids in `FLOWS` for `kind: "generate"`**
(`geocode`, `context`, `generate`, `critique`), so the developer-facing pipeline
diagram and the traveler-facing loader name the same steps. The *text* is not
shared — `FLOWS` descriptions are written for a developer reading a trace
("This is the slow one"), which is the wrong register for someone waiting on a
holiday.

**Targeted fix to existing code:** `FLOWS` has no node for the OSM coordinate
correction, so the pipeline diagram currently under-describes what the generate
route does. Add a `placing` node to it as part of this work.

### 2. One pipeline, two transports

The generate/refine body of `route.ts` moves into a function that takes an
`onStage` callback:

```ts
async function runGeneration(
  params: GenerationParams,
  onStage: (event: StageEvent) => void
): Promise<{ itinerary: Itinerary; traceId: string; runId: string }>
```

- The existing JSON response path passes a no-op and is otherwise unchanged.
- The streaming path passes an emitter that writes SSE frames.

This is the load-bearing structural decision: **the pipeline has one
implementation.** A second copy behind a streaming flag would drift the moment
either is edited.

### 3. Opt-in via `?stream=1`

`POST /api/itinerary?stream=1` returns `text/event-stream`. Without the
parameter, the response is byte-identical to today's.

Chosen over content negotiation on `Accept` because it is explicit, greppable,
and trivially reproducible with `curl`. It is what keeps
[`PipelineConsole`](../../../src/components/backend/PipelineConsole.tsx) — which
posts to this route and then fetches the run separately — working with no change
at all.

### 4. Wire protocol

Frames, in order:

```
: <~2KB of padding>

event: stage
data: {"stage":"geocode","status":"start"}

event: stage
data: {"stage":"geocode","status":"done"}

...

event: done
data: {"itinerary":{...},"traceId":"...","runId":"..."}
```

On failure, in place of `done`:

```
event: error
data: {"error":"The planner didn't finish. Try generating again."}
```

**`skipped` is a first-class status**, not an afterthought — it is how the
existing fail-soft degradations stay visible. A geocode miss skips `placing`; the
traveler sees a step that didn't need to run rather than one that appears stuck.

The error message stays exactly the traveler-facing string the route already
returns. The real error still goes to the server log, per the existing comment.

### 5. Response headers and the Safari padding frame

```
Content-Type: text/event-stream
Cache-Control: no-store
X-Content-Type-Options: nosniff
X-Accel-Buffering: no
```

`no-store` follows the SSE example in the bundled Next docs (Pages Router API
routes; the App Router streaming doc sets no cache header at all).
`X-Accel-Buffering: no` is the documented fix for nginx and similar reverse
proxies, which buffer by default. `nosniff` matches the App Router streaming
example.

**The leading `:` comment frame is required, not decorative.** The bundled
`streaming.md` records that WebKit buffers streaming responses until 1024 bytes
have arrived, and explicitly names "tiny Route Handler responses" as the affected
case. SSE progress frames are a few dozen bytes each. Without padding the loader
would stay blank and then flush every stage at once — the exact failure this
feature exists to remove. The frame must carry a comment explaining why, or it
will read as dead code and be deleted.

**Do not add `export const runtime = 'edge'`.** The Edge runtime is deprecated in
Next 16; the Node default is the only non-deprecated choice and supports
streaming.

### 6. Client — `src/lib/eventStream.ts`

`EventSource` is GET-only, so this is `fetch` plus `response.body.getReader()`
plus `TextDecoder`, per the reader pattern in the bundled docs.

A small pure module, no React:

```ts
export async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: string) => void
): Promise<void>
```

It must buffer until `\n\n`. **A chunk boundary can split a frame mid-way**, and
a parser that assumes one chunk equals one frame works in testing and corrupts
under real network conditions. This is the single most likely defect in the
feature and it is what the unit test targets.

### 7. `page.tsx` and `GenerationLoader`

`generate()` and `refine()` post with `?stream=1`, feed the body to
`readEventStream`, and track stage state. `done` supplies the itinerary exactly
as the JSON path does today.

`GenerationLoader` takes the stage state and renders the five steps with their
status. Its existing 10-letter word animation and the dev-mode assertion guarding
it are unchanged.

**Captions.** `generate` is most of the wait, so one caption per stage would
freeze for ninety seconds. Each stage carries its own small caption set that
rotates within that stage on the existing 2.5s interval — live, and still true.

**Accessibility.** The component's current comment explains a deliberate choice:
`role="status"` on the wrapper, captions `aria-hidden` because five of them cycle
past saying nothing the label doesn't. Real stages change that calculus in one
direction only. Stage transitions become worth announcing — there are five, they
are meaningful, and they are the answer to "is this stuck". The rotating
sub-captions stay hidden for the original reason. Update the comment to record
the new reasoning rather than silently inverting it.

**Reduced motion** needs no new work: the global rule at
[`globals.css:141`](../../../src/app/globals.css) already flattens every
transition and keyframe animation to near-zero.

## Failure handling

| Failure | Behaviour |
|---|---|
| Stream never opens (network error, non-200) | Fall back to the plain JSON POST |
| Stream dies mid-generation | Show the error. **No retry** |
| `error` event received | Show its message, same copy as today's 500 |
| Stream ends with no `done` and no `error` | Treated as a failure |
| A stage callback throws | Must not abort generation — the emitter swallows and logs |
| User navigates away | Cancel the reader; the route's `ReadableStream` cancel handler aborts |

The no-retry rule matters: a silent retry after a mid-generation failure spends
another two minutes and a second pair of model calls, and the traveler has no
idea it is happening.

## Verification

Per `CLAUDE.md`, typecheck alone does not count as verified here.

1. **`npm test`** — new `src/lib/eventStream.test.mjs` using `node:test`,
   matching the no-framework style of the existing suites:
   - a frame split across two chunks parses as one event
   - multiple frames in a single chunk parse as several events
   - the leading `:` comment frame is ignored
   - a trailing partial frame does not emit
2. **`npx tsc --noEmit -p tsconfig.json`** and **`npm run lint`**
3. **`curl -N 'http://localhost:3000/api/itinerary?stream=1' -d @body.json`** —
   frames must arrive progressively, not in one burst at the end. The bundled
   docs note `curl -N` still relies on newlines to flush, which SSE's `\n\n`
   terminator satisfies.
4. **Without `?stream=1`**, the same request returns the identical JSON it
   returns today.
5. **Browser check in both Chrome and Safari** — see the open risk below.

## Open risk: compression buffering

The bundled docs prescribe `Accept-Encoding: identity` to stop the compression
layer buffering chunks — but they demonstrate it from a Node script, and
`Accept-Encoding` is a **forbidden header name** in the browser Fetch API. The
documented mitigation cannot be applied from `page.tsx`.

Next.js gzips by default. Whether it compresses `text/event-stream`, and whether
that buffers frames in practice, has to be **measured, not assumed**.

Order of remedies if stages do not arrive incrementally in a real browser:

1. Confirm the padding frame is present and large enough — it primes a
   compression buffer as well as Safari's.
2. Check whether Next compresses this content type at all; it may be a non-issue.
3. If it is a problem, exclude the route via a `headers()` entry in
   `next.config`, in preference to disabling `compress` globally.

This must be checked in Chrome **and** Safari before the feature is called done.
Safari is the one with the documented 1024-byte buffer, so a Chrome-only check
proves nothing about the case the padding frame exists to solve.

## Documentation to update

- `docs/frontend.md` and `docs/backend.md` — one Features row each,
  `Since 2026-08-16`, Developer `Zaid`, per `docs/project-crux.md`.
- `docs/project-crux.md` — a timeline row.
- The comment in `PipelineConsole.tsx` stating that per-sub-step progress "would
  need the route itself to stream (SSE)… that's a bigger change than this console
  makes" becomes out of date once the route streams. Update it to point at the
  streaming path rather than leaving it describing a limitation that no longer
  holds.
- `AGENTS.md` is rewritten by `next dev` — commit it with the work.
