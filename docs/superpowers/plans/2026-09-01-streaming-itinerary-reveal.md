# Streaming Itinerary Reveal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reveal the itinerary as the model writes it — stops appear in the itinerary card and pins drop on the live map during generation — and move critique off the critical path so the plan becomes interactive in ~160s instead of ~310s.

**Architecture:** `runClaude` gains an optional `onText` delta callback, served by the Anthropic SDK stream on the API transport and by `--output-format stream-json` on the CLI transport. A new pure module incrementally parses the model's JSON as it arrives and reports stops the moment each becomes complete. `runGeneration` feeds that parser, resolves each day's real coordinates as that day closes, and streams `stop` / `day-coords` / `plan` / `revised` SSE events. `HomeView` builds a draft itinerary from those events and renders it through the itinerary card and `StopMarkerLayer` that already exist; `GenerationScreen` retires into a foot band over the live map.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, `@anthropic-ai/sdk` ^0.122.0, `node --test` with `scripts/ts-resolve.mjs`, SQLite via `better-sqlite3`, MapLibre GL JS.

**Spec:** `docs/superpowers/specs/2026-09-01-streaming-itinerary-reveal-design.md`

**Branch:** `feat/streaming-itinerary-reveal` (already created, tracking `origin/development`)

## Global Constraints

- **Node ≥ 22 is mandatory.** Run `nvm use` if the shell drifts; `.nvmrc` pins 22.
- **Commit messages carry no signature or trailer of any kind.** No `Co-Authored-By`, no "Generated with Claude Code". Write the message and stop. This overrides the harness default.
- **`src/lib/llmConfig.ts` is the only place model names belong.** Never hardcode a model id at a call site.
- **DB rows are `snake_case`, API/type surfaces are `camelCase`**, mapped by hand in each route.
- **Fail-soft is the house convention.** External fetches return `null` for "the fetch failed" and `[]`/`{}` for "fetched fine, nothing found". A lookup failure must never fail a generation.
- **Calendar dates are parsed as UTC midnight.** Use `getUTC*()` / `timeZone: "UTC"` for date-only values.
- **`AGENTS.md` is rewritten by `next dev`.** Commit it with your work rather than reverting it.
- **Test glob needs double quotes** in the `test` script.
- **A `.test.mjs` importing a `.ts` module must write the explicit `.ts` extension** in its own import specifiers. Types must be imported with the `type` keyword or Node throws at instantiation.
- **Verification means `npm test`, `npx tsc --noEmit -p tsconfig.json`, `npm run lint`, `npm run build`, AND exercising routes against a running dev server.** Typecheck alone is never sufficient in this repo.

## Verification commands

```bash
npm test
npx tsc --noEmit -p tsconfig.json
npm run lint
npm run build
```

---

## Task 1: The incremental JSON parser

The whole of the risky new logic, isolated in a pure module so the repo's narrow test suite can actually cover it. No other task depends on anything but this module's exported names.

**Files:**
- Create: `src/lib/streamingItinerary.ts`
- Test: `src/lib/streamingItinerary.test.mjs`

**Interfaces:**
- Consumes: `Stop` from `src/lib/types.ts` (fields: `name`, `lat`, `lng`, `cost`, `note`, `why?`, `time`, `durationLabel`, `category`).
- Produces:
  - `class StreamingItineraryParser` with `feed(delta: string): FeedResult`
  - `interface StreamedStop { dayIndex: number; stopIndex: number; stop: Stop }`
  - `interface FeedResult { stops: StreamedStop[]; closedDays: number[] }`

**Background the implementer needs.** The model is asked (in `src/lib/itineraryPrompt.ts`) to respond with exactly:

```
{"days":[{"date":"YYYY-MM-DD","weather":"...","summary":"...","lodging":{"name":"...","cost":0,"note":"..."},"stops":[{"name":"...","lat":0.0,"lng":0.0,"cost":0,"why":"...","note":"...","time":"9:00 AM","durationLabel":"1 hour","category":"food|entry|transit|other"}]}]}
```

`category` is the **last** field of a stop, so a stop object that has a `category` is a stop that has everything. That is the completeness signal — not brace counting.

The technique: keep the accumulated text, scan only the newly-arrived characters (so the whole stream costs O(n), not O(n²)), remember the last offset that sits immediately after a *complete* value, then build a parse candidate by slicing to that offset and appending the closing brackets still open there. `JSON.parse` does the real work.

- [ ] **Step 1: Write the failing test**

Create `src/lib/streamingItinerary.test.mjs`:

```js
/* Run: node --test src/lib/streamingItinerary.test.mjs
 *
 * The parser reads a model's JSON while it is still being written, so it never sees a
 * whole document — it sees whatever arrived since the last token. The bug class that
 * matters is a chunk boundary landing inside a field, which every test written against
 * one big feed() will miss. The exhaustive-split test below is the one that catches it. */
import assert from "node:assert/strict";
import test from "node:test";
import { StreamingItineraryParser } from "./streamingItinerary.ts";

const STOP_A =
  '{"name":"Fushimi Inari","lat":34.96,"lng":135.77,"cost":0,"why":"w1","note":"n1",' +
  '"time":"9:00 AM","durationLabel":"2 hours","category":"other"}';
const STOP_B =
  '{"name":"Nishiki Market","lat":35.00,"lng":135.76,"cost":20,"why":"w2","note":"n2",' +
  '"time":"1:00 PM","durationLabel":"1 hour","category":"food"}';
const DAY_1 =
  '{"date":"2026-05-01","weather":"clear","summary":"s1",' +
  `"lodging":{"name":"Hotel","cost":100,"note":"ln"},"stops":[${STOP_A},${STOP_B}]}`;
const DAY_2 =
  '{"date":"2026-05-02","weather":"rain","summary":"s2","stops":[' + STOP_A + "]}";
const FULL = `{"days":[${DAY_1},${DAY_2}]}`;

/** Feeds `text` in chunks and returns every stop and closed-day report, in order. */
function drain(chunks) {
  const parser = new StreamingItineraryParser();
  const stops = [];
  const closedDays = [];
  for (const chunk of chunks) {
    const result = parser.feed(chunk);
    stops.push(...result.stops);
    closedDays.push(...result.closedDays);
  }
  return { stops, closedDays };
}

test("a complete response yields every stop once, in order", () => {
  const { stops, closedDays } = drain([FULL]);
  assert.deepEqual(
    stops.map((s) => [s.dayIndex, s.stopIndex, s.stop.name]),
    [
      [0, 0, "Fushimi Inari"],
      [0, 1, "Nishiki Market"],
      [1, 0, "Fushimi Inari"],
    ]
  );
  assert.deepEqual(closedDays, [0, 1]);
});

test("feeding one character at a time yields the identical sequence", () => {
  const whole = drain([FULL]);
  const perChar = drain([...FULL]);
  assert.deepEqual(perChar.stops, whole.stops);
  assert.deepEqual(perChar.closedDays, whole.closedDays);
});

test("every possible two-way split yields the identical sequence", () => {
  const whole = drain([FULL]);
  for (let i = 1; i < FULL.length; i++) {
    const split = drain([FULL.slice(0, i), FULL.slice(i)]);
    assert.deepEqual(split.stops, whole.stops, `split at ${i} changed the stops`);
    assert.deepEqual(split.closedDays, whole.closedDays, `split at ${i} changed the days`);
  }
});

test("a stop is withheld until its category arrives", () => {
  const partial = `{"days":[{"date":"2026-05-01","weather":"clear","stops":[` + STOP_A.slice(0, STOP_A.indexOf('"category"'));
  const { stops } = drain([partial]);
  assert.deepEqual(stops, []);
});

test("a day is reported closed only when its object closes", () => {
  const parser = new StreamingItineraryParser();
  const open = parser.feed(`{"days":[${DAY_1.slice(0, -1)}`);
  assert.deepEqual(open.closedDays, []);
  const closed = parser.feed("}");
  assert.deepEqual(closed.closedDays, [0]);
});

test("a leading markdown fence does not break the parse", () => {
  const { stops } = drain(["```json\n" + FULL + "\n```"]);
  assert.equal(stops.length, 3);
});

test("a stop is never emitted twice across feeds", () => {
  const parser = new StreamingItineraryParser();
  const seen = [];
  for (const ch of FULL) seen.push(...parser.feed(ch).stops);
  const keys = seen.map((s) => `${s.dayIndex}:${s.stopIndex}`);
  assert.deepEqual(keys, [...new Set(keys)]);
});

test("garbage in yields nothing rather than throwing", () => {
  const parser = new StreamingItineraryParser();
  assert.deepEqual(parser.feed("not json at all }}}").stops, []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/streamingItinerary.test.mjs`
Expected: FAIL — cannot find module `./streamingItinerary.ts`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/streamingItinerary.ts`:

```ts
import type { Stop } from "./types";

export interface StreamedStop {
  dayIndex: number;
  stopIndex: number;
  stop: Stop;
}

export interface FeedResult {
  /** Stops that became complete during this feed, in document order, each reported once. */
  stops: StreamedStop[];
  /** Day indices whose object closed during this feed — the signal to resolve that day's
   *  coordinates, since `stops` is the last field of a day in the requested shape. */
  closedDays: number[];
}

const CLOSER: Record<string, string> = { "{": "}", "[": "]" };

const EMPTY: FeedResult = { stops: [], closedDays: [] };

/**
 * Whether a parsed value carries everything needed to render a stop.
 *
 * `category` is deliberately part of the test and is the field that actually gates emission:
 * it is the LAST field of a stop in the shape `itineraryPrompt.ts` asks for, so an object
 * that has one is an object that has all of them. Checking the cheap final field beats
 * brace-counting the buffer, and it degrades correctly if the model ever reorders — a
 * reordered stop is simply held back until it is genuinely complete, never emitted half-written.
 */
function isRenderableStop(value: unknown): value is Stop {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.name === "string" &&
    s.name.length > 0 &&
    Number.isFinite(s.lat) &&
    Number.isFinite(s.lng) &&
    typeof s.time === "string" &&
    typeof s.category === "string" &&
    s.category.length > 0
  );
}

/**
 * Reads a `{"days":[…]}` itinerary out of a model's token stream while it is still being written.
 *
 * The approach is deliberately not a hand-written JSON state machine. It scans only for the
 * structural facts it needs — where the last complete value ended, and which brackets are still
 * open there — then hands a repaired slice to `JSON.parse`, which does the actual parsing. That
 * keeps the only novel logic here to "how much of this text is safe to parse", which is a much
 * smaller thing to get right than a parser.
 *
 * **The scan is incremental and must stay that way.** It resumes at the first byte that arrived
 * this feed rather than re-reading the buffer, so a 20KB response costs O(n) across the whole
 * stream instead of O(n²). Re-scanning from zero on each token is the obvious refactor and it is
 * the wrong one — deltas arrive thousands of times per generation.
 */
export class StreamingItineraryParser {
  /** Everything received so far. Needed whole, because a parse candidate is a slice of it. */
  private buf = "";
  /** Closing brackets owed, innermost last. */
  private stack: string[] = [];
  private inString = false;
  private escaped = false;
  /** Offset of the opening `{` of the root object, or -1 before it has been seen. Skipping to
   *  it is what tolerates a ```json fence the prompt asked the model not to emit but which it
   *  sometimes emits anyway — the same allowance `parseJsonResponse` makes. */
  private rootStart = -1;
  /** Offset immediately after the last *complete* value, at any depth. Slicing here is what
   *  guarantees the candidate never ends mid-token — the one thing appending brackets cannot fix. */
  private safeIndex = 0;
  /** The bracket stack as it stood at `safeIndex`, which is what the candidate must close. */
  private safeStack: string[] = [];
  /** Stops already reported, per day index. */
  private emitted: number[] = [];
  private daysClosed = 0;
  private daysReported = 0;

  feed(delta: string): FeedResult {
    const start = this.buf.length;
    this.buf += delta;
    let sawClose = false;

    for (let i = start; i < this.buf.length; i++) {
      const ch = this.buf[i];

      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (ch === "\\") this.escaped = true;
        else if (ch === '"') {
          this.inString = false;
          this.mark(i + 1);
        }
        continue;
      }

      if (ch === '"') {
        this.inString = true;
      } else if (ch === "{" || ch === "[") {
        if (this.rootStart < 0 && ch === "{") this.rootStart = i;
        this.stack.push(CLOSER[ch]);
      } else if (ch === "}" || ch === "]") {
        this.stack.pop();
        this.mark(i + 1);
        sawClose = true;
        // Back to [root object, days array] means the container that just closed was a day.
        // A lodging object pops back to depth 3 and a stop object to depth 4, so neither
        // can be mistaken for one.
        if (ch === "}" && this.stack.length === 2) this.daysClosed++;
      }
    }

    // Nothing closed, so nothing can have become complete. Skipping the parse here is what
    // keeps the per-token cost near zero for the ~90% of deltas that are mid-value text.
    if (!sawClose) return EMPTY;
    if (this.rootStart < 0 || this.safeIndex <= this.rootStart) return EMPTY;

    const candidate =
      this.buf.slice(this.rootStart, this.safeIndex) + [...this.safeStack].reverse().join("");

    let parsed: { days?: unknown };
    try {
      parsed = JSON.parse(candidate) as { days?: unknown };
    } catch {
      // Expected and routine, not an error: a safe point can land after a *key*'s closing
      // quote, which repairs to `{"days"}`. Wait for more input.
      return EMPTY;
    }

    const days = Array.isArray(parsed?.days) ? (parsed.days as Record<string, unknown>[]) : [];
    const stops: StreamedStop[] = [];
    for (let d = 0; d < days.length; d++) {
      const dayStops = Array.isArray(days[d]?.stops) ? (days[d].stops as unknown[]) : [];
      let next = this.emitted[d] ?? 0;
      for (let s = next; s < dayStops.length; s++) {
        // `break`, never `continue`: stops must reach the map in the order the model wrote
        // them, and skipping past an incomplete one would both reorder the day and strand
        // that stop permanently, since `emitted` would have moved beyond it.
        if (!isRenderableStop(dayStops[s])) break;
        stops.push({ dayIndex: d, stopIndex: s, stop: dayStops[s] });
        next = s + 1;
      }
      this.emitted[d] = next;
    }

    const closedDays: number[] = [];
    while (this.daysReported < this.daysClosed) closedDays.push(this.daysReported++);

    return { stops, closedDays };
  }

  private mark(index: number): void {
    this.safeIndex = index;
    this.safeStack = [...this.stack];
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/streamingItinerary.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Run the full suite and typecheck**

```bash
npm test && npx tsc --noEmit -p tsconfig.json && npm run lint
```
Expected: all pass. The suite grows from 17 files to 18.

- [ ] **Step 6: Commit**

```bash
git add src/lib/streamingItinerary.ts src/lib/streamingItinerary.test.mjs
git commit -m "Read the itinerary out of the model's token stream as it is written

The plan is written day 1 first and revealed all at once, which throws that ordering
away. This reads it back: scan only the bytes that just arrived, remember where the
last complete value ended, and hand JSON.parse a slice with the still-open brackets
appended. A stop is reported once it has a category, which is the last field of the
shape the prompt asks for, so an object that has one has all of them.

The exhaustive-split test is the point of the file. A parser tested against one whole
feed passes while corrupting real traffic, which is the bug eventStream.ts documents
in its own comment."
```

---

## Task 2: `onText` on the API transport

The smaller of the two transport changes, and the one with no envelope risk — the SDK already streams here and `finalMessage()` returns the same assembled message either way.

**Files:**
- Modify: `src/lib/claude.ts` (the `meta` parameter type on `runClaudeViaApi`, `runClaudeViaCli` and `runClaude`; the `anthropic.messages.stream(...)` call around line 562)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `runClaude(prompt, type, timeoutMs, meta)` where `meta` gains `onText?: (delta: string) => void`. Task 4 passes it.

- [ ] **Step 1: Add `onText` to all three `meta` parameter types**

`claude.ts` declares the `meta` shape inline three times — on `runClaudeViaCli`, on `runClaudeViaApi`, and on the `runClaude` dispatcher. Add the same field to each:

```ts
    session?: SessionOption;
    /** Called with each text delta as the model produces it. Optional and additive: a caller
     *  that omits it gets byte-identical behaviour, including the trace row. Only the
     *  streaming generate path supplies one. */
    onText?: (delta: string) => void;
```

- [ ] **Step 2: Attach the listener to the existing stream**

In `runClaudeViaApi`, the call currently chains `.stream({...}, { signal }).finalMessage()`. Split it so the listener can attach between:

```ts
      const pending = anthropic.messages.stream(
        {
          model,
          max_tokens: maxTokensFor(type),
          messages,
          ...(supportsAdaptiveThinking(model)
            ? { thinking: { type: "adaptive" as const } }
            : { thinking: thinkingFor(type, meta?.effort) }),
          ...(() => {
            const effort = meta?.effort ?? apiEffortFor(type);
            return effort && supportsEffort(model) ? { output_config: { effort } } : {};
          })(),
        },
        { signal: controller.signal }
      );
      // Attached before the await, which is the whole requirement — a listener added after
      // `finalMessage()` resolves would see nothing. `finalMessage()` still returns the same
      // assembled message, so `stop_reason`, `usage`, the trace row and the computed cost are
      // all unchanged by this.
      if (meta?.onText) pending.on("text", meta.onText);
      const response = await pending.finalMessage();
```

Leave the existing comment block above the call in place — it explains why this path streams at all.

- [ ] **Step 3: Typecheck and lint**

```bash
npx tsc --noEmit -p tsconfig.json && npm run lint
```
Expected: pass.

- [ ] **Step 4: Prove the deltas actually arrive, and the trace row did not change**

Capture a pre-change trace row for comparison first:

```bash
sqlite3 tripmate.db "SELECT id, status, length(raw_response), cost_usd FROM llm_traces WHERE type='generate' ORDER BY created_at DESC LIMIT 1;"
```

Then start the dev server with the API transport and generate a trip:

```bash
LLM_TRANSPORT=api npm run dev
```

```bash
curl -sN -X POST 'http://localhost:3000/api/itinerary?stream=1' -H 'Content-Type: application/json' -d '{"destination":"Kyoto","startDate":"2026-05-01","endDate":"2026-05-03","budget":1500,"tier":"comfort"}' | head -40
```

Expected: the stream behaves exactly as before (this task adds no new SSE events). Then confirm the new trace row has the same shape as the one captured above:

```bash
sqlite3 tripmate.db "SELECT id, status, length(raw_response), cost_usd FROM llm_traces WHERE type='generate' ORDER BY created_at DESC LIMIT 1;"
```

Expected: `status='ok'`, a non-null `cost_usd`, and `raw_response` of comparable length. A null `cost_usd` or a much shorter `raw_response` means the envelope changed and this step failed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/claude.ts
git commit -m "Let a caller watch the API transport's text as it arrives

The API path already streams — it just discarded every intermediate event and kept
finalMessage(). An optional onText on meta hands those deltas to a caller that wants
them. Additive by construction: finalMessage() returns the same assembled message,
so the trace row, usage, stop_reason and cost are untouched for every existing caller."
```

---

## Task 3: `onText` on the CLI transport

The riskiest change in the plan, isolated so it can be rejected without losing Tasks 1-2. CLAUDE.md records that `llm_traces.raw_response` holds two envelope shapes and that `parseUsage()` in `runs.ts` and `perfAggregate.ts` branch on them. Changing the CLI's output format changes what lands in that column.

**Files:**
- Modify: `src/lib/claude.ts` (`runClaudeViaCli` — the `spawn` argument list and the stdout handling)

**Interfaces:**
- Consumes: the `onText` field added to `meta` in Task 2.
- Produces: no new exports. `runClaudeViaCli` returns the same `ClaudeResult` it returns today.

- [ ] **Step 1: Probe the installed CLI before writing any code**

Do not assume the flag names — they vary by CLI version, and this task's whole risk is the output shape. Find the binary the app uses and ask it directly:

```bash
which claude || ls -l ~/.local/bin/claude
```

```bash
claude --help 2>&1 | grep -iE "output-format|partial|verbose|stream"
```

Then capture a real one-shot envelope and a real streamed one, side by side:

```bash
claude -p 'Reply with only the JSON {"ok":true}' --output-format json --tools "" --setting-sources "" --no-session-persistence > /tmp/claude-oneshot.json
```

```bash
claude -p 'Reply with only the JSON {"ok":true}' --output-format stream-json --verbose --tools "" --setting-sources "" --no-session-persistence > /tmp/claude-stream.jsonl
```

```bash
cat /tmp/claude-oneshot.json | python3 -m json.tool | head -30
echo "--- stream event types ---"
python3 -c "import json,sys; [print(json.loads(l).get('type')) for l in open('/tmp/claude-stream.jsonl') if l.strip()]"
echo "--- final result line vs one-shot keys ---"
python3 -c "
import json
one=json.load(open('/tmp/claude-oneshot.json'))
last=[json.loads(l) for l in open('/tmp/claude-stream.jsonl') if l.strip()][-1]
print('one-shot keys :', sorted(one.keys()))
print('stream last   :', sorted(last.keys()))
print('MATCH' if sorted(one.keys())==sorted(last.keys()) else 'DIFFERS: ' + str(set(one)^set(last)))
"
```

**Decision point.** If the final `result` line's keys match the one-shot envelope's keys, continue to Step 2. If they differ in any field `parseUsage()` reads (check `src/lib/runs.ts` for which those are), **stop and report** — the spec's stated fallback is to abandon this task and let the CLI transport degrade to today's all-at-once behaviour, which costs nothing but a dev-only convenience.

If `--verbose` is required alongside `--output-format stream-json` (the CLI rejects the combination without it in `-p` mode on some versions), note that; it is needed in Step 2. If token-level deltas require an additional flag such as `--include-partial-messages`, confirm its exact name from `--help` output and use that name in Step 2 rather than the one written here.

- [ ] **Step 2: Switch the spawn to stream-json only when a caller wants deltas**

In `runClaudeViaCli`, the argument list currently hardcodes `"--output-format", "json"`. Make it conditional, so every existing caller keeps the exact envelope it has today and only a delta-wanting caller opts into the new format:

```ts
    // Only the caller that actually wants deltas pays for the format change. Every other call
    // keeps the one-shot `json` envelope byte for byte, which is what keeps parseUsage() and the
    // trace viewer reading exactly what they read before — see CLAUDE.md on the two envelope
    // shapes living in raw_response side by side.
    const streaming = Boolean(meta?.onText);
    const formatArgs = streaming
      ? ["--output-format", "stream-json", "--verbose", "--include-partial-messages"]
      : ["--output-format", "json"];
```

and substitute `...formatArgs` for the two hardcoded entries in the `spawn` array.

- [ ] **Step 3: Parse stdout line by line when streaming**

Replace the stdout accumulator. Keep accumulating the raw text regardless — the trace row needs it — and additionally split complete lines when streaming:

```ts
    let stdout = "";
    let stderr = "";
    /** The final `result` event, kept as raw text so it can be written to the trace row in
     *  exactly the shape a one-shot call writes. Only populated on the streaming path. */
    let resultLine = "";
    /** Bytes received but not yet terminated by a newline. A JSONL line splits across chunk
     *  boundaries exactly as an SSE frame does — see eventStream.ts, same bug, same fix. */
    let lineBuf = "";

    child.stdout.on("data", (d) => {
      const text = String(d);
      stdout += text;
      if (!streaming) return;
      lineBuf += text;
      let nl = lineBuf.indexOf("\n");
      while (nl !== -1) {
        const line = lineBuf.slice(0, nl).trim();
        lineBuf = lineBuf.slice(nl + 1);
        if (line) handleStreamLine(line);
        nl = lineBuf.indexOf("\n");
      }
    });

    /** One JSONL event. Never throws: a line this doesn't recognise is a line to ignore, and a
     *  malformed one must not take down a generation the traveller is waiting on. */
    const handleStreamLine = (line: string) => {
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return;
      }
      if (event.type === "result") {
        resultLine = line;
        return;
      }
      // The CLI wraps raw Anthropic stream events; a text delta is the only one this cares about.
      const inner = (event.event ?? event) as Record<string, unknown> | undefined;
      if (inner?.type === "content_block_delta") {
        const delta = inner.delta as { type?: string; text?: string } | undefined;
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          meta?.onText?.(delta.text);
        }
      }
    };
```

Declare `handleStreamLine` **before** the `child.stdout.on("data", …)` registration, or the `const` is in its temporal dead zone when the first chunk arrives.

- [ ] **Step 4: Feed the trace row the envelope it expects**

In the `child.on("exit", …)` handler, the code parses `JSON.parse(stdout)` and writes `rawResponse: stdout`. On the streaming path `stdout` is a JSONL document, not an envelope. Use the captured final line instead, so the column keeps its existing shape:

```ts
      // On the streaming path stdout is a JSONL document, so the envelope is the final `result`
      // line rather than the whole of it. Writing that line — and only that line — is what keeps
      // raw_response the same shape a one-shot call writes, which parseUsage() in runs.ts and
      // perfAggregate.ts both depend on.
      const envelopeText = streaming ? resultLine : stdout;
      if (streaming && !envelopeText) {
        updateTrace(traceId, {
          status: "error",
          rawResponse: stdout,
          durationMs,
          errorMessage: "stream-json produced no result event",
        });
        reject(new Error("claude CLI stream ended without a result event"));
        return;
      }
```

Then replace the three subsequent uses of `stdout` in the success path (`JSON.parse(stdout)`, and both `rawResponse: stdout` occurrences in the `try` block) with `envelopeText`. Leave the `code !== 0` branch using `stderr || stdout` — a non-zero exit wants the whole output, not an envelope that may not exist.

- [ ] **Step 5: Typecheck, lint, and run the suite**

```bash
npx tsc --noEmit -p tsconfig.json && npm run lint && npm test
```
Expected: pass. `src/lib/claude.test.mjs` and `src/lib/claudeTimeout.test.mjs` exercise this file — if either fails, the envelope handling above is wrong.

- [ ] **Step 6: Prove both CLI paths still write the same trace shape**

Start the dev server on the default (CLI) transport:

```bash
npm run dev
```

Generate once — this exercises the **non**-streaming CLI path, since Task 4 has not wired `onText` yet:

```bash
curl -s -X POST http://localhost:3000/api/itinerary -H 'Content-Type: application/json' -d '{"destination":"Porto","startDate":"2026-05-01","endDate":"2026-05-03","budget":1200,"tier":"comfort"}' | head -c 300
```

```bash
sqlite3 tripmate.db "SELECT type, status, cost_usd, length(raw_response) FROM llm_traces ORDER BY created_at DESC LIMIT 4;"
```

Expected: `status='ok'` rows with populated `cost_usd`. Then open the LLM trace FAB in the browser and confirm the newest run renders its usage and cost — that view is the actual consumer of `parseUsage()`, and it is the check a query cannot make for you.

- [ ] **Step 7: Commit**

```bash
git add src/lib/claude.ts
git commit -m "Teach the CLI transport to stream, without changing what a trace row holds

--output-format stream-json turns stdout into JSONL, which would have put a whole
document into raw_response where an envelope belongs — the column parseUsage() and
the trace viewer both read, and which CLAUDE.md flags as holding two shapes already.
So the format switch is gated on a caller actually wanting deltas, and the final
result event is captured as raw text and written on its own. Every existing call
keeps the one-shot envelope byte for byte.

Lines are buffered across chunk boundaries for the same reason SSE frames are in
eventStream.ts: nothing guarantees one chunk is one line."
```

---

## Task 4: Stream stops out of the runner, and resolve each day's coordinates as it closes

**Files:**
- Modify: `src/lib/generationRunner.ts`
- Modify: `src/app/api/itinerary/route.ts`

**Interfaces:**
- Consumes: `StreamingItineraryParser`, `StreamedStop` (Task 1); `meta.onText` on `runClaude` (Tasks 2-3); `resolveNamedPlaceCoords(names: string[], near: {lat,lon}, radiusM?) => Promise<Record<string, {lat:number;lon:number}>>` from `src/lib/poiDetails.ts`.
- Produces:
  - `runGeneration(params, onStage, live?)` where `live` is `LiveSink | undefined`
  - `export interface LiveSink { onStop(stop: StreamedStop): void; onDayCoords(dayIndex: number, coords: Record<string, { lat: number; lon: number }>): void }`
  - Two new SSE event names on `/api/itinerary?stream=1`: `stop` and `day-coords`. Task 6 consumes both.

- [ ] **Step 1: Add the `LiveSink` type and the third parameter**

In `src/lib/generationRunner.ts`, add the import and the interface above `runGeneration`:

```ts
import { StreamingItineraryParser, type StreamedStop } from "./streamingItinerary";
```

```ts
/**
 * Where a streaming caller receives the plan as it is written. Absent for the plain-JSON
 * caller, and its absence is the switch: `runGeneration` streams stops, resolves coordinates
 * per day and moves critique off the critical path only when a sink is supplied. The JSON
 * route has no channel to deliver anything after its single response, so it keeps the
 * blocking order it has always had.
 */
export interface LiveSink {
  onStop(stop: StreamedStop): void;
  onDayCoords(dayIndex: number, coords: Record<string, { lat: number; lon: number }>): void;
}
```

and extend the signature:

```ts
export async function runGeneration(
  params: GenerationParams,
  onStage: (event: StageEvent) => void,
  live?: LiveSink
): Promise<{ itinerary: Itinerary; traceId: string; runId: string; sessionId?: string }> {
```

- [ ] **Step 2: Feed the parser from the generate call, and fire per-day lookups**

Immediately **before** the `onStage({ stage: "generate", status: "start" })` line, add:

```ts
  const parser = new StreamingItineraryParser();
  /** Stop names per day index, accumulated as they stream, so a day's coordinate lookup can be
   *  fired the moment that day closes. */
  const namesByDay = new Map<number, string[]>();
  /** Coordinates already resolved during the stream, merged across days and keyed by the
   *  trimmed stop name — the same key `resolveNamedPlaceCoords` returns. The `placing` sweep
   *  below skips anything already in here, which is what shrinks it from the whole trip to
   *  whatever the stream missed. */
  const streamedCoords: Record<string, { lat: number; lon: number }> = {};
  const pendingCoordLookups: Promise<unknown>[] = [];

  const onText = live
    ? (delta: string) => {
        const { stops, closedDays } = parser.feed(delta);
        for (const streamed of stops) {
          const names = namesByDay.get(streamed.dayIndex) ?? [];
          names.push(streamed.stop.name);
          namesByDay.set(streamed.dayIndex, names);
          live.onStop(streamed);
        }
        for (const dayIndex of closedDays) {
          const names = namesByDay.get(dayIndex) ?? [];
          // Nothing to place, or nowhere to place it from — a failed geocode leaves geoPoint
          // unset and the whole correction is skipped, exactly as the batched version already does.
          if (names.length === 0 || !geoPoint) continue;
          // Deliberately NOT awaited. This is a ~25s Overpass call and the parse it would block
          // is the feature; the whole set is awaited once, after generate, before the sweep.
          pendingCoordLookups.push(
            resolveNamedPlaceCoords(names, geoPoint)
              .then((coords) => {
                Object.assign(streamedCoords, coords);
                live.onDayCoords(dayIndex, coords);
              })
              // Fail-soft, per the house convention: a day whose lookup fails keeps the model's
              // coordinates and says nothing, which is what the batched call already did.
              .catch((err) => console.error("[itinerary] day coords lookup failed", err))
          );
        }
      }
    : undefined;
```

Then add `onText` to the existing `runClaude` meta on the generate call:

```ts
    { runId, session: { persist: true }, onText }
```

- [ ] **Step 3: Let the parsed stream satisfy the placing stage**

Find the `if (geoPoint) { onStage({ stage: "placing", status: "start" }); … }` block near the end of `runGeneration` and replace its body so it awaits the in-flight lookups and then only resolves what the stream did not:

```ts
  if (geoPoint) {
    onStage({ stage: "placing", status: "start" });
    try {
      // Settle whatever the stream started. `allSettled`, not `all`: each lookup already
      // swallows its own failure, and one that somehow rejects must not skip the sweep.
      await Promise.allSettled(pendingCoordLookups);
      const allStops = itinerary.days.flatMap((d) => d.stops);
      // Only the names the stream never resolved. On a streaming run this is usually empty or
      // near it, so the stage that used to be a ~25s whole-trip Overpass call becomes a sweep
      // for the leftovers. On a plain-JSON run nothing streamed, so this is the whole trip and
      // the behaviour is exactly what it was before.
      const unresolved = allStops
        .map((s) => s.name.trim())
        .filter((name) => !(name in streamedCoords));
      const resolved = unresolved.length
        ? await resolveNamedPlaceCoords(unresolved, geoPoint)
        : {};
      const all = { ...streamedCoords, ...resolved };
      for (const stop of allStops) {
        const fixed = all[stop.name.trim()];
        if (fixed) {
          stop.lat = fixed.lat;
          stop.lng = fixed.lon;
        }
      }
    } catch {
      // Keep the model's coordinates.
    }
    onStage({ stage: "placing", status: "done" });
  } else {
    onStage({ stage: "placing", status: "skipped" });
  }
```

- [ ] **Step 4: Emit the two new events from the route**

In `src/app/api/itinerary/route.ts`, inside the `ReadableStream`'s `start`, after `const onStage = …`, add the sink and pass it through:

```ts
      const onStage = (event: StageEvent) => safeEnqueue("stage", event);
      const live = {
        onStop: (stop: StreamedStop) => safeEnqueue("stop", stop),
        onDayCoords: (dayIndex: number, coords: Record<string, { lat: number; lon: number }>) =>
          safeEnqueue("day-coords", { dayIndex, coords }),
      };
      try {
        const result = await runGeneration(params, onStage, live);
```

and add the import:

```ts
import type { StreamedStop } from "@/lib/streamingItinerary";
```

Leave the non-streaming branch's `runGeneration(params, () => {})` call untouched — omitting the sink is what keeps it blocking.

- [ ] **Step 5: Typecheck, lint, suite**

```bash
npx tsc --noEmit -p tsconfig.json && npm run lint && npm test
```
Expected: pass.

- [ ] **Step 6: See the stops on the wire**

```bash
LLM_TRANSPORT=api npm run dev
```

```bash
curl -sN -X POST 'http://localhost:3000/api/itinerary?stream=1' -H 'Content-Type: application/json' -d '{"destination":"Kyoto","startDate":"2026-05-01","endDate":"2026-05-03","budget":1500,"tier":"comfort"}' | grep -E '^event: (stop|day-coords)' | head -20
```

Expected: `event: stop` lines beginning well before the generation completes, followed by `event: day-coords` lines. If no `stop` lines appear at all, `onText` is not reaching the transport — check Task 2's listener attachment. If they all arrive at the end in one burst, the deltas are being buffered rather than streamed.

Repeat the same curl against the default CLI transport (`npm run dev`, no env override) and confirm `stop` lines appear there too.

- [ ] **Step 7: Commit**

```bash
git add src/lib/generationRunner.ts src/app/api/itinerary/route.ts
git commit -m "Stream stops as the model writes them, and place each day as it closes

The runner now feeds every text delta to the streaming parser and emits each stop the
moment it completes. When a day's object closes it fires that day's Overpass lookup
without awaiting it, so coordinates arrive a few seconds behind the text rather than
in one ~25s block at the very end.

Per-day unions are smaller than the whole-trip one they replace, which is the shape
resolveNamedPlaceCoords already documents as the safe one — granularity was the thing
that used to 504 it, not batching. The placing stage stays, shrunk to a sweep over
whatever the stream missed, and is unchanged for the plain-JSON caller that streams
nothing."
```

---

## Task 5: Move critique off the critical path

**Files:**
- Modify: `src/lib/generationRunner.ts`
- Modify: `src/app/api/itinerary/route.ts`

**Interfaces:**
- Consumes: `LiveSink` (Task 4).
- Produces:
  - `LiveSink` gains `onPlan(result: { itinerary: Itinerary; traceId: string; runId: string; sessionId?: string }): void` and `onRevised(revision: { days: DayPlan[]; issues: string[] }): void`
  - Two new SSE events: `plan` and `revised`. Task 6 consumes both.

- [ ] **Step 1: Extract the annotation block into one local helper**

`runGeneration` currently annotates once, after critique. Both the pre-critique plan and the post-critique revision need the same treatment, and two copies of these rules would drift. Inside `runGeneration`, after `placeConflicts` and `dietaryByStop` are built, define:

```ts
  /**
   * Everything that turns a raw day set into a renderable one: conflict detection against the
   * place facts, admission costs, book-ahead notes, verified dietary notes and the real forecast.
   *
   * One function rather than two call sites, because it now runs twice on a streaming run —
   * once on the plan the traveller starts reading and again on whatever critique returns. Two
   * copies of these rules is how the second one silently stops matching the first.
   */
  const finalizeDays = (target: Itinerary["days"]): void => {
    const conflicts = detectConflicts(target, placeFacts, { stepFreeRequired, crowdBias });
    annotateConflicts(target, conflicts);
    pinAdmissionCosts(target, placeFacts);
    annotateBookAhead(target, placeFacts);
    for (const day of target) {
      for (const stop of day.stops ?? []) {
        const note = dietaryNote(dietaryByStop.get(normalizeStopName(stop.name)) ?? null);
        if (note && !stop.note?.includes(note)) {
          stop.note = stop.note ? `${stop.note} ${note}` : note;
        }
      }
      const detail = weatherByDate.get(day.date);
      if (detail) day.weatherDetail = detail;
    }
  };
```

Move the `const weatherByDate = new Map(weather.map((w) => [w.date, w]));` line **above** this helper so it is in scope, and delete the now-duplicated annotation/weather block that ran after critique.

- [ ] **Step 2: Split the tail of `runGeneration` on whether a sink exists**

Replace the region from the critique block through the end of the function with:

```ts
  const runCritique = async (): Promise<{ days: Itinerary["days"]; issues: string[] } | null> => {
    onStage({ stage: "critique", status: "start" });
    try {
      const critiquePrompt = buildCritiquePrompt({
        itinerary,
        budget,
        contextInsight,
        interestTags: preferences?.tags,
        resolvedFlags,
        dietary,
        placeConflicts,
        travelFindings,
      });
      const { result: critiqueRaw } = await runClaude(critiquePrompt, "critique", CRITIQUE_TIMEOUT_MS, {
        runId,
      });
      const critique = parseJsonResponse<CritiqueResult>(critiqueRaw);
      onStage({ stage: "critique", status: "done" });
      return critique.revisedDays
        ? { days: critique.revisedDays, issues: critique.issues ?? [] }
        : null;
    } catch {
      // `failed`, not `done` and not `skipped` — the pass really did consume its budget, and
      // critique is alone in its display group, so a skip would collapse to "Checking it over —
      // done" about a review that never ran. See generationStages.ts.
      onStage({ stage: "critique", status: "failed" });
      return null;
    }
  };

  if (!live) {
    // Plain-JSON caller: one response, so critique has to land before it. Unchanged order.
    const revision = await runCritique();
    if (revision) itinerary.days = revision.days;
    finalizeDays(itinerary.days);
    await placeStops();
    return { itinerary, traceId, runId, sessionId };
  }

  // Streaming caller: finish the plan the traveller is watching, hand it over, and only then
  // spend the ~150s critique costs. This is the halving — interactive at ~160s rather than ~310s.
  finalizeDays(itinerary.days);
  await placeStops();
  live.onPlan({ itinerary, traceId, runId, sessionId });

  const revision = await runCritique();
  if (revision) {
    finalizeDays(revision.days);
    live.onRevised({ days: revision.days, issues: revision.issues });
    itinerary.days = revision.days;
  }
  return { itinerary, traceId, runId, sessionId };
```

Wrap the placing block from Task 4 Step 3 in `const placeStops = async (): Promise<void> => { … }` so both branches call it, and declare it above this region.

- [ ] **Step 3: Extend `LiveSink` and emit the events**

Add to the interface:

```ts
export interface LiveSink {
  onStop(stop: StreamedStop): void;
  onDayCoords(dayIndex: number, coords: Record<string, { lat: number; lon: number }>): void;
  /** The plan is complete and interactive. Everything after this is a background improvement. */
  onPlan(result: { itinerary: Itinerary; traceId: string; runId: string; sessionId?: string }): void;
  /** Critique returned a corrected day set. The client decides whether to take it. */
  onRevised(revision: { days: Itinerary["days"]; issues: string[] }): void;
}
```

In `route.ts`, add to the `live` object:

```ts
        onPlan: (result: Awaited<ReturnType<typeof runGeneration>>) => safeEnqueue("plan", result),
        onRevised: (revision: { days: DayPlan[]; issues: string[] }) =>
          safeEnqueue("revised", revision),
```

`DayPlan` is already imported in `route.ts`. Leave the existing `safeEnqueue("done", result)` after the await — `done` still closes the stream and is what the client waits for before considering the run over.

- [ ] **Step 4: Typecheck, lint, suite**

```bash
npx tsc --noEmit -p tsconfig.json && npm run lint && npm test
```
Expected: pass.

- [ ] **Step 5: Confirm the event order on the wire**

```bash
LLM_TRANSPORT=api npm run dev
```

```bash
curl -sN -X POST 'http://localhost:3000/api/itinerary?stream=1' -H 'Content-Type: application/json' -d '{"destination":"Kyoto","startDate":"2026-05-01","endDate":"2026-05-03","budget":1500,"tier":"comfort"}' | grep -E '^event:' | uniq -c
```

Expected order: `stage` and `stop` interleaved, then `day-coords`, then exactly one `plan`, then a `stage` (critique), then at most one `revised`, then exactly one `done`. Time the gap between `plan` and `done` — it should be roughly the critique duration, and `plan` should arrive at roughly half the total.

Also confirm the non-streaming path still returns a fully critiqued plan in one response:

```bash
curl -s -X POST http://localhost:3000/api/itinerary -H 'Content-Type: application/json' -d '{"destination":"Kyoto","startDate":"2026-05-01","endDate":"2026-05-03","budget":1500,"tier":"comfort"}' | python3 -c "import json,sys; d=json.load(sys.stdin); print('days:', len(d['itinerary']['days']))"
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/generationRunner.ts src/app/api/itinerary/route.ts
git commit -m "Hand the traveller the plan before spending the critique on it

Critique is a ~150s pass that runs after generate and can replace the whole day set,
so half the wait landed after there was anything to look at. On the streaming path the
plan is now finalized, placed and emitted first, and critique runs behind it — the plan
is interactive at ~160s rather than ~310s.

The plain-JSON caller keeps the blocking order: it has one response and no channel to
deliver a revision later, and inventing one for a fallback nobody normally hits is not
worth it. Both branches share finalizeDays(), because the annotation rules now run
twice on a streaming run and two copies is how the second stops matching the first."
```

---

## Task 6: Build the plan on the client as it streams

**Files:**
- Modify: `src/app/HomeView.tsx` (`runStreamed`, and the state it writes)

**Interfaces:**
- Consumes: the `stop`, `day-coords`, `plan` and `revised` SSE events (Tasks 4-5); `StreamedStop` from `src/lib/streamingItinerary.ts`.
- Produces: `draftItinerary` state, rendered by the existing itinerary card and `StopMarkerLayer`. Task 7 renders against it.

- [ ] **Step 1: Add the draft state**

Near the existing `stages` state in `HomeView`:

```tsx
  /** The plan as it is being written, assembled from `stop` and `day-coords` frames. Null
   *  outside a generation. This is what the map and the itinerary card render during the wait —
   *  there is no separate loading view to keep in sync with it. */
  const [draftItinerary, setDraftItinerary] = useState<Itinerary | null>(null);
  /** Set by any local mutation between `plan` and `revised`. Critique replaces the whole day
   *  set, so a revision that lands on top of an edit the traveller just made would silently
   *  discard it. */
  const editedSincePlanRef = useRef(false);
```

- [ ] **Step 2: Handle the four new events in `runStreamed`**

Extend the `readEventStream` callback:

```tsx
    await readEventStream(res.body, (event, data) => {
      if (event === "stage") {
        const parsed = JSON.parse(data) as StageEvent;
        setStages((prev) =>
          prev.map((s) => (s.stage === parsed.stage ? { ...s, status: parsed.status } : s))
        );
      } else if (event === "stop") {
        const { dayIndex, stopIndex, stop } = JSON.parse(data) as StreamedStop;
        setDraftItinerary((prev) => {
          const days = [...(prev?.days ?? [])];
          // Days arrive in order but a frame could in principle outrun its day, so grow the
          // array rather than assuming the slot exists.
          while (days.length <= dayIndex) {
            days.push({ date: "", weather: "", stops: [] });
          }
          const stops = [...days[dayIndex].stops];
          stops[stopIndex] = stop;
          days[dayIndex] = { ...days[dayIndex], stops };
          // `tier` is guaranteed set by the time generate() runs (validate() rejects otherwise),
          // but it is not narrowed here, and Itinerary["tier"] is required.
          return { tier: (prev?.tier ?? tier) as Itinerary["tier"], days };
        });
      } else if (event === "day-coords") {
        const { dayIndex, coords } = JSON.parse(data) as {
          dayIndex: number;
          coords: Record<string, { lat: number; lon: number }>;
        };
        setDraftItinerary((prev) => {
          if (!prev?.days[dayIndex]) return prev;
          const days = [...prev.days];
          days[dayIndex] = {
            ...days[dayIndex],
            stops: days[dayIndex].stops.map((s) => {
              const fixed = coords[s.name.trim()];
              // `lon` on the wire, `lng` on a Stop — the two names differ and always have.
              return fixed ? { ...s, lat: fixed.lat, lng: fixed.lon } : s;
            }),
          };
          return { ...prev, days };
        });
      } else if (event === "plan") {
        // Bound to a local first: `result` is `T | null`, and TypeScript does not narrow a
        // closed-over `let` across the assignment, so passing it straight to `planned` is an error.
        const plan = JSON.parse(data) as T;
        result = plan;
        editedSincePlanRef.current = false;
        planned?.(plan);
      } else if (event === "revised") {
        const revision = JSON.parse(data) as { days: DayPlan[]; issues: string[] };
        // Critique replaces the whole day set. If the traveller has touched the plan since it
        // opened, their edit is the more recent intent and the replacement is dropped — the
        // issues list is still worth having either way.
        if (!editedSincePlanRef.current) revised?.(revision.days);
      } else if (event === "done") {
        result = JSON.parse(data) as T;
      } else if (event === "error") {
        failure = (JSON.parse(data) as { error: string }).error;
      }
    });
```

Add `planned` and `revised` as optional callback parameters on `runStreamed` so `generate()` supplies them:

```tsx
  async function runStreamed<T>(
    body: Record<string, unknown>,
    hooks?: { planned?: (result: T) => void; revised?: (days: DayPlan[]) => void }
  ): Promise<T> {
```

and read them as `const { planned, revised } = hooks ?? {};` at the top.

- [ ] **Step 3: Open the plan on `plan` rather than on `done`**

In `generate()`, pass hooks that end the generating state as soon as the plan lands, and apply a later revision in place:

```tsx
      const data = await runStreamed<{
        itinerary: Itinerary;
        runId?: string | null;
        sessionId?: string | null;
      }>(
        { destination, startDate, endDate, budget, tier,
          preferences: { tags: interests, vibe: null },
          userAnswers: currentAnswers(), dietary },
        {
          planned: (plan) => {
            setDraftItinerary(null);
            setItinerary(plan.itinerary);
            setGenerating(false);
          },
          revised: (days) =>
            setItinerary((prev) => (prev ? { ...prev, days } : prev)),
        }
      );
```

Keep the existing post-await handling — `done` still carries the final result and is what persists the draft trip.

- [ ] **Step 4: Reset the draft when a run starts, and flag local edits**

In `generate()`, alongside the existing `setStages(...)` reset, add `setDraftItinerary(null); editedSincePlanRef.current = false;`.

Then find every place that mutates `itinerary` locally — the drag-drop reorder, the element-edit apply, and the chat patch apply — and set `editedSincePlanRef.current = true` in each. Locate them with:

```bash
grep -n "setItinerary(" src/app/HomeView.tsx
```

- [ ] **Step 5: Typecheck, lint, suite**

```bash
npx tsc --noEmit -p tsconfig.json && npm run lint && npm test
```
Expected: pass.

- [ ] **Step 6: Watch it in the browser**

Start the dev server, open the app, and generate a 3-day trip. Confirm with the browser tools: stops appear in the itinerary card progressively, pins follow a few seconds behind per day, the plan becomes interactive well before the run ends, and no console errors. Check `read_console_messages` for React key or state warnings — the draft array grows during render and that is where such a warning would show.

- [ ] **Step 7: Commit**

```bash
git add src/app/HomeView.tsx
git commit -m "Assemble the plan on the client as it arrives

A draft itinerary is built from the stop and day-coords frames and rendered through the
same card and marker layer the finished plan uses, so there is no second loading view to
keep in sync. The plan opens on the plan event rather than on done, which is what makes
the wait end at ~160s.

A revision that lands after the traveller has edited the plan is dropped. Critique
replaces the whole day set, so applying it on top of an edit would silently discard the
edit — and a boolean is enough here, since both events reach one client that performed
any intervening change itself."
```

---

## Task 7: Retire `GenerationScreen` into a foot band over the live map

**Files:**
- Modify: `src/components/GenerationScreen.tsx`
- Modify: `src/app/HomeView.tsx` (the render around line 1445, and the `SceneBackdrop` gate above it)

**Interfaces:**
- Consumes: `draftItinerary` (Task 6); the existing `GenerationScreen` props (`mode`, `stages`, `facts`, `destination`, `dateRange`, `tripDays`, `tierName`, `budget`, `rawFetch`, `onCancel`).
- Produces: no new exports. `GenerationScreen` keeps its name and prop list and becomes a non-opaque band.

**Three things must survive or this task is a net regression.** The component's own doc comment records why each exists: **cancel**, the **four-group progress strip**, and the **rotating destination facts** (the facts feed was the entire point of the screen's last rewrite — dropping it silently would be a regression wearing a feature's clothes).

- [ ] **Step 0: Read the component in full before changing it**

```bash
cat src/components/GenerationScreen.tsx
```

This is the one task in the plan whose steps describe changes rather than quote them, because
the exact class strings and element structure live in a 360-line file that has to be read to be
edited correctly. Its 40-line opening doc comment is the argument this task reverses — read that
first, and keep its reasoning in view rather than discarding it.

- [ ] **Step 1: Make the screen a band rather than a full-bleed layer**

In `GenerationScreen.tsx`, remove the full-bleed opaque backdrop — the destination `<Image>`, the `FALLBACK` scenic pair and the `usePlacePhoto` call that feeds them — and keep the darkened foot band that already holds the machinery. Change the root element from a full-viewport fixed layer to a bottom-anchored one:

- root becomes `fixed inset-x-0 bottom-0 z-40` rather than `fixed inset-0`
- keep the band's existing dark treatment; it was designed for legibility over busy ground, which is exactly the problem the live map re-introduces
- the facts feed moves into the band beside the progress strip

Update the component's doc comment to record the reversal and why, in the file's existing voice: the screen covered the globe because the globe had nothing to say, and it now has the traveller's own plan on it.

- [ ] **Step 2: Render the draft plan behind the band**

In `HomeView.tsx`, the `SceneBackdrop` is currently gated `step === "plan" && !generating && !refining` with a comment explaining that `GenerationScreen` paints the same image itself. That is no longer true — update the gate and the comment.

Render the itinerary card and `StopMarkerLayer` against `draftItinerary ?? itinerary` during a generation, so the same components serve both states. Find the existing render sites:

```bash
grep -n "StopMarkerLayer\|<ItineraryCard\|itinerary={" src/app/HomeView.tsx
```

- [ ] **Step 3: Typecheck, lint, suite, build**

```bash
npx tsc --noEmit -p tsconfig.json && npm run lint && npm test && npm run build
```
Expected: all pass. `npm run build` matters here — it is the only step that sees bundler output, and this task removes an `Image` import and a dynamic boundary.

- [ ] **Step 4: Verify in the browser**

Generate a trip and confirm: the map is live from the first frame; stops and pins appear over it; the band shows the four step groups, the rotating facts and a working Cancel; text in the band is legible against a moving map (check a light-terrain area, which is the worst case). Take a screenshot mid-generation.

Press Cancel mid-run and confirm the request actually aborts and the UI returns to the form.

- [ ] **Step 5: Commit**

```bash
git add src/components/GenerationScreen.tsx src/app/HomeView.tsx
git commit -m "Put the map back under the wait, and keep what covered it

GenerationScreen went opaque because the globe was the busiest possible ground for
small text and had nothing to say underneath it. It has something to say now — the
traveller's own plan, drawing itself — so the screen collapses into the darkened foot
band it already had, which was designed for legibility over exactly this.

Cancel, the four-group progress strip and the rotating facts all move into the band
rather than going away with the layer. The facts feed was the point of this screen's
last rewrite; losing it here would have been a regression dressed as a feature."
```

---

## Task 8: Choose the camera behaviour against a real generation

The spec deliberately left this open: framing the growing bounds and following the newest pin are both defensible, and the difference is felt rather than reasoned.

**Files:**
- Modify: `src/lib/useTripCamera.ts` (or the camera call site the probe identifies)

**Interfaces:**
- Consumes: `draftItinerary` (Task 6); `MapRenderer` from `src/lib/mapRenderer.ts` — the contract is **metres, degrees and CSS pixels**, camera aim is a target point plus a *range* (not a zoom), and **pitch is Cesium's convention everywhere: negative is down**. MapLibre's complement is converted inside `maplibreRenderer.ts`.
- Produces: no new exports.

- [ ] **Step 1: Read the existing camera contract**

```bash
sed -n '1,80p' src/lib/useTripCamera.ts
grep -n "flyTo\|cameraState\|restoreCamera\|range" src/lib/mapRenderer.ts
```

Nothing above `MapRenderer` may import either engine — route any change through the contract, not through MapLibre directly.

- [ ] **Step 2: Implement "frame the growing bounds"**

Recompute the bounds over `draftItinerary`'s stops as they arrive and ease the camera to hold them, debounced so it moves once per day rather than once per stop.

- [ ] **Step 3: Try it against a real 5-day generation**

Generate and watch. Judge: does the camera settle, or does it churn? Do early pins get lost as the frame widens?

- [ ] **Step 4: Implement "follow the newest pin" behind the same call site**

Fly to each newly-placed day's centroid instead, holding a fixed range.

- [ ] **Step 5: Try that against a real 5-day generation, then keep one**

Keep whichever reads better on both engines — check the Map/Satellite toggle, since both share the camera contract. Delete the other outright rather than leaving it behind a flag; an unchosen option behind a flag is the speculative config the house style rejects.

- [ ] **Step 6: Commit**

```bash
git add src/lib/useTripCamera.ts
git commit -m "Move the camera with the plan as it is written

<Record which behaviour was kept, what the other one did wrong when watched against a
real generation, and that it was deleted rather than left behind a flag.>"
```

---

## Final verification

- [ ] **Full gate on both transports**

```bash
npm test && npx tsc --noEmit -p tsconfig.json && npm run lint && npm run build
```

- [ ] **A real generation end to end on the CLI transport**

```bash
npm run dev
```
Generate a 5-day trip in the browser. Confirm: stops stream, pins follow, plan opens early, critique lands behind it, the trace FAB shows correct usage and cost for every call in the run.

- [ ] **A real generation end to end on the API transport**

```bash
LLM_TRANSPORT=api npm run dev
```
Same checks. Then compare a trace row from each transport:

```bash
sqlite3 tripmate.db "SELECT type, status, cost_usd, length(raw_response) FROM llm_traces ORDER BY created_at DESC LIMIT 10;"
```
Expected: both transports write `status='ok'` rows with populated `cost_usd`. This is the check Task 3's risk hangs on.

- [ ] **Cross-engine boot check**

```bash
node scripts/browser-matrix.mjs
```

- [ ] **Update the docs trackers**

`docs/frontend.md` and `docs/backend.md` each carry Features / Enhancements / Bugs tables with a **Developer** column. Add a row for this feature with a `Since` date of the merge day, under the contributor's own name. `docs/project-crux.md` indexes them and defines the rules. If the streaming reveal supersedes a row describing the old `GenerationScreen` wait, collapse that row's `Status` into an `Eliminated` `<details>` and add this as its successor rather than editing it in place.
