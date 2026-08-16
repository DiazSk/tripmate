# Generation Progress Loader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the itinerary loader's fixed, disconnected captions with real per-stage progress streamed from the server.

**Architecture:** The generate/refine body of `POST /api/itinerary` already performs five distinct pieces of work in order (geocode, context, generate, critique, placing) — it just never reports them. That body is extracted into `runGeneration(params, onStage)` in a new module, called identically by both a plain-JSON response (unchanged, `onStage` is a no-op) and a new `?stream=1` SSE response (real `onStage` writes frames). A small client-side parser reads those frames and drives the existing `GenerationLoader` component, now rendering five real stages instead of five fake captions.

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript, `node:test` (no framework), Web Streams API (`ReadableStream`, `TextEncoder`/`TextDecoder`) on both server and client.

**Spec:** [`docs/superpowers/specs/2026-08-16-generation-progress-stream-design.md`](../specs/2026-08-16-generation-progress-stream-design.md)

## Global Constraints

- **Node ≥ 22 is mandatory.** `better-sqlite3`'s native binding kills the dev server on Node 20 the moment a DB route is hit.
- **Add no new dependencies.** `ReadableStream`, `TextEncoder`/`TextDecoder`, and `fetch` are all already-global Web APIs in Node 22 and every target browser.
- **No fake progress.** No interpolated percentages, no timed animation between stages, no invented ETAs — every stage report corresponds to real work the server is actually doing.
- **The pipeline has exactly one implementation.** `runGeneration` must not be duplicated behind a streaming flag; both transports call the same function.
- **`?stream=1` is opt-in.** Without it, `POST /api/itinerary` returns byte-identical JSON to what it returns today — every existing caller (`PipelineConsole`, raw `curl`, anything else) is unaffected.
- **Do not add `export const runtime = "edge"`.** The Edge runtime is deprecated in Next 16; the Node default is the only non-deprecated choice and it supports streaming.
- **The leading `:` padding frame is required, not decorative.** WebKit buffers a streamed response until 1024 bytes arrive; a few small SSE frames alone would sit invisible and flush all at once. The frame must carry a comment explaining why, or a future reader will delete it as dead code.
- **Failures are always in-band.** Once streaming begins, HTTP status and headers can't change — a mid-stream failure is an `event: error` frame, never a different status code.
- **No retry on a mid-stream failure.** A silent retry after generation has already failed spends another two minutes and a second pair of model calls with no visibility to the traveler.
- **Commit messages carry no Claude/AI attribution trailers.** Repository owner's explicit instruction.
- **`AGENTS.md` is rewritten by `next dev`.** If it shows as modified, commit it with the work rather than reverting it.
- **A `.test.mjs` can only import a `.ts` module whose own imports are all `import type` — or has no imports at all.** Node erases `import type` and resolves nothing at runtime; a bare value import (even to another local `.ts` file without an extension) fails with `ERR_MODULE_NOT_FOUND`. `src/lib/generationStages.ts` and `src/lib/eventStream.ts` are written to have zero problematic imports for exactly this reason — do not add one without checking it stays loadable.
- **Verification is never typecheck alone.** `npm test`, `npx tsc --noEmit -p tsconfig.json`, `npm run lint`, and a real `curl` (or browser check, where the task calls for it) against a running dev server.

---

### Task 1: Shared stage vocabulary

`src/lib/generationStages.ts` is the one module both the server (Task 2) and the client (Task 4) import, so the wire protocol and the UI cannot drift apart. It also fixes a real gap in the existing developer-facing pipeline diagram: `FLOWS` has no node for the OSM coordinate-correction step, so it currently under-describes what the generate route does.

**Files:**
- Create: `src/lib/generationStages.ts`
- Test: `src/lib/generationStages.test.mjs` (create)
- Modify: `src/lib/pipelineFlows.ts:43-93` (add a `placing` node to `FLOWS[kind="generate"].nodes`)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `StageId`, `StageStatus`, `StageEvent`, `STAGE_ORDER: StageId[]`, `stageMeta(mode: "generate" | "refine", stage: StageId): StageMeta` where `StageMeta = { label: string; captions: string[] }`. Tasks 2 and 4 import these.

- [ ] **Step 1: Write the failing test**

Create `src/lib/generationStages.test.mjs`:

```js
/* Run: node --test src/lib/generationStages.test.mjs
 *
 * A typo'd stage id here silently breaks the loader for exactly one stage — no crash, no
 * test failure elsewhere, just a step that never gets a caption. These asserts exist so
 * that class of typo fails here instead of showing up as a blank loader row. */
import assert from "node:assert/strict";
import test from "node:test";
import { STAGE_ORDER, stageMeta } from "./generationStages.ts";

test("STAGE_ORDER has exactly the five documented stages, no duplicates", () => {
  assert.deepEqual(STAGE_ORDER, ["geocode", "context", "generate", "critique", "placing"]);
  assert.equal(new Set(STAGE_ORDER).size, STAGE_ORDER.length);
});

test("every stage has a non-empty label and caption list in both modes", () => {
  for (const mode of ["generate", "refine"]) {
    for (const stage of STAGE_ORDER) {
      const meta = stageMeta(mode, stage);
      assert.ok(meta.label.length > 0, `${mode}/${stage} has no label`);
      assert.ok(meta.captions.length > 0, `${mode}/${stage} has no captions`);
    }
  }
});

test("refine's generate stage uses the Reworking label, not Planning", () => {
  assert.equal(stageMeta("refine", "generate").label, "Reworking");
  assert.equal(stageMeta("generate", "generate").label, "Planning");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/lib/generationStages.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` — `./generationStages.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/lib/generationStages.ts`. It has zero imports, so it is trivially loadable by a `.test.mjs` regardless of the `import type` rule:

```ts
export type StageId = "geocode" | "context" | "generate" | "critique" | "placing";
export type StageStatus = "start" | "done" | "skipped";

export interface StageEvent {
  stage: StageId;
  status: StageStatus;
}

/** The five stages a generate/refine call reports, in the order they occur. Stage ids
 *  deliberately match the node ids in `FLOWS` for `kind: "generate"` in pipelineFlows.ts, so
 *  the developer-facing pipeline diagram and this traveler-facing loader name the same
 *  steps — but the text below is written for someone waiting on a holiday, not a developer
 *  reading a trace, so it is not shared with FLOWS' own descriptions. */
export const STAGE_ORDER: StageId[] = ["geocode", "context", "generate", "critique", "placing"];

export interface StageMeta {
  /** Short label for the stage's row in the loader — not the rotating caption. */
  label: string;
  /** Rotates every 2.5s while this stage is the active one. Never empty. */
  captions: string[];
}

const GENERATE_META: Record<StageId, StageMeta> = {
  geocode: {
    label: "Locating",
    captions: ["Finding your destination…", "Pulling the real forecast…"],
  },
  context: {
    label: "Context",
    captions: ["Checking festivals and events…", "Reading local safety notes…"],
  },
  generate: {
    label: "Planning",
    captions: [
      "Charting the route…",
      "Scouting places to stay…",
      "Plotting the best stops…",
      "Balancing the budget…",
      "Writing the day-by-day plan…",
    ],
  },
  critique: {
    label: "Reviewing",
    captions: ["Double-checking the budget…", "Reviewing stop timing…"],
  },
  placing: {
    label: "Placing",
    captions: ["Correcting map coordinates…"],
  },
};

/** Refine reuses most of the same stage set — geocode and placing are always skipped (the
 *  previous itinerary's coordinates are reused, not refetched), and generate/context/critique
 *  get refine-flavored captions to match the "Rethinking" word GenerationLoader already shows
 *  for this mode. */
const REFINE_META: Record<StageId, StageMeta> = {
  ...GENERATE_META,
  context: {
    label: "Context",
    captions: ["Re-checking festivals and events…"],
  },
  generate: {
    label: "Reworking",
    captions: [
      "Reading your notes…",
      "Reworking the days…",
      "Rebalancing the budget…",
      "Finalizing the changes…",
    ],
  },
  critique: {
    label: "Reviewing",
    captions: ["Re-checking the budget…", "Re-checking stop timing…"],
  },
};

export function stageMeta(mode: "generate" | "refine", stage: StageId): StageMeta {
  return (mode === "refine" ? REFINE_META : GENERATE_META)[stage];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/lib/generationStages.test.mjs`
Expected: PASS, 3 tests.

- [ ] **Step 5: Add the `placing` node to the pipeline diagram**

In `src/lib/pipelineFlows.ts`, inside `FLOWS[0]` (the `kind: "generate"` entry), add a new node to the `nodes` array immediately after the existing `critique` node (it runs last in the real route, after critique has potentially revised the days):

```ts
      {
        id: "placing",
        label: "Coordinate Correction",
        variant: "external",
        description:
          "Corrects each stop's lat/lng against OSM/Overpass — the model's own coordinates are often badly wrong (measured: Fushimi Inari 11km off). Names it resolves get real positions; anything unmatched keeps the model's guess. Skipped entirely if the initial geocode failed, since there's no reference point to correct against.",
        input: "generated stop names + destination coordinates",
        output: "corrected lat/lng per matched stop",
      },
```

- [ ] **Step 6: Run the full suite, typecheck, and lint**

Run: `npm test && npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: 32 tests pass (29 existing + 3 new); no type errors; no new lint errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/generationStages.ts src/lib/generationStages.test.mjs src/lib/pipelineFlows.ts
git commit -m "Add the shared generation-stage vocabulary

One module both the route and the loader import, so the wire protocol
and the UI cannot drift. Stage ids deliberately match FLOWS' generate
node ids, but the caption text is written for someone waiting on a
holiday, not a developer reading a trace, so it isn't shared.

Also adds a placing node to FLOWS itself -- the pipeline diagram had no
node for the OSM coordinate-correction step, so it under-described
what the generate route actually does."
```

---

### Task 2: Extract `runGeneration`, add the SSE endpoint

This is the load-bearing task. The generate/refine body of `route.ts` moves into `runGeneration(params, onStage)` in a new module, instrumented at all five real stage boundaries. The existing JSON response calls it with a no-op; a new `?stream=1` branch calls it with a real emitter that writes SSE frames. Both live proof and the instrumentation's correctness are demonstrated together via `curl -N`, since a stage list that only *looks* right in code review but never fires in the right order would be a much worse defect than a slow one.

**Files:**
- Create: `src/lib/generationRunner.ts`
- Modify: `src/app/api/itinerary/route.ts` (full rewrite of the generate/refine path; the `rebalance` branch is untouched)

**Interfaces:**
- Consumes: `StageEvent` from Task 1.
- Produces: `runGeneration(params: GenerationParams, onStage: (event: StageEvent) => void): Promise<{ itinerary: Itinerary; traceId: string; runId: string }>` and the `GenerationParams` interface, both exported from `src/lib/generationRunner.ts`. The live `?stream=1` HTTP contract (SSE frames: `stage`/`done`/`error`) is consumed by Task 4's client code, via Task 3's parser.

- [ ] **Step 1: Create `generationRunner.ts`**

This is the *exact* existing generate/refine logic from `route.ts`, moved verbatim, with `onStage(...)` calls added at each real boundary and the skip logic for refine (no geocode, no placing) and a failed geocode (no placing) made explicit. Two small type-narrowing fixes were needed that the original `any`-typed request body silently avoided — noted inline.

Create `src/lib/generationRunner.ts`:

```ts
import { randomUUID } from "crypto";
import { DEFAULT_TIMEOUT_MS, itineraryTimeoutMs, parseJsonResponse, runClaude } from "./claude";
import { geocodeDestination, getWeatherForDates, DayWeather } from "./weather";
import { resolveNamedPlaceCoords } from "./poiDetails";
import { getDestinationContextInsight } from "./destinationContext";
import { insertRun } from "./db";
import { buildCritiquePrompt, buildGeneratePrompt, buildRefinePrompt } from "./itineraryPrompt";
import { normalizeDays } from "./itinerary";
import { tripDays, TierId } from "./tiers";
import { deriveFlags } from "./userAnswers";
import { CritiqueResult, Itinerary, ItineraryPreferences, ResolvedFlags, UserAnswers } from "./types";
import { StageEvent } from "./generationStages";

export interface GenerationParams {
  destination: string;
  startDate: string;
  endDate: string;
  budget: number;
  tier?: TierId;
  previousItinerary?: Itinerary;
  feedback?: string;
  preferences?: ItineraryPreferences | null;
  tripId?: string | null;
  userAnswers?: unknown;
}

/**
 * The generate/refine body of `POST /api/itinerary`, extracted so both the plain-JSON
 * response and the SSE-streamed response (route.ts) run this exact same logic — the one
 * genuine structural requirement of the streaming design: a second copy behind a flag
 * would drift the moment either was edited. `onStage` fires at each of the five real steps
 * (see generationStages.ts); the JSON caller passes a no-op, the streaming caller writes
 * real frames.
 */
export async function runGeneration(
  params: GenerationParams,
  onStage: (event: StageEvent) => void
): Promise<{ itinerary: Itinerary; traceId: string; runId: string }> {
  const {
    destination,
    startDate,
    endDate,
    budget,
    tier,
    previousItinerary,
    feedback,
    preferences,
    tripId,
    userAnswers,
  } = params;

  let prompt: string;
  let effectiveTier: TierId;
  let dayCount: number;
  let weather: DayWeather[] = [];
  let geoPoint: { lat: number; lon: number } | null = null;
  const isRefine = Boolean(previousItinerary && feedback);

  // The wizard has always sent these; the route simply never read them, so six
  // screens of answers were collected and discarded. Malformed input is treated
  // as absent rather than fatal — a bad shape must not fail a generation that is
  // otherwise fine, and the prompt is unchanged when this is null.
  let resolvedFlags: ResolvedFlags | null = null;
  if (userAnswers) {
    try {
      resolvedFlags = deriveFlags(userAnswers as UserAnswers);
    } catch (err) {
      console.error("[itinerary] ignoring malformed userAnswers", err);
    }
  }

  const runId = randomUUID();
  insertRun({
    id: runId,
    kind: isRefine ? "refine" : "generate",
    destination,
    tripId: tripId ?? null,
  });

  // Kicked off before the geocode/weather work below so it runs concurrently
  // with it rather than adding its latency on top.
  onStage({ stage: "context", status: "start" });
  const contextInsightPromise = getDestinationContextInsight(destination, startDate, endDate, runId);
  let contextInsight: string;

  if (isRefine) {
    // Refine reuses the previous itinerary's coordinates and tier — there is nothing to
    // geocode or re-place, so both stages are reported skipped rather than left pending.
    onStage({ stage: "geocode", status: "skipped" });
    if (!previousItinerary || !feedback) {
      // isRefine's own Boolean(...) check already guarantees this at runtime; the guard
      // exists only so TypeScript can narrow these from optional to required below.
      throw new Error("Refine requires both a previous itinerary and feedback.");
    }
    effectiveTier = previousItinerary.tier;
    dayCount = previousItinerary.days.length;
    contextInsight = await contextInsightPromise;
    onStage({ stage: "context", status: "done" });
    prompt = buildRefinePrompt({
      destination,
      startDate,
      endDate,
      budget,
      previousItinerary,
      feedback,
      contextInsight,
      resolvedFlags,
    });
  } else {
    if (!tier) {
      // route.ts already validated tier is present whenever isRefine is false; this
      // exists purely so TypeScript can narrow tier from optional to required below.
      throw new Error("Missing tier for a non-refine generation.");
    }
    effectiveTier = tier;
    dayCount = tripDays(startDate, endDate);
    onStage({ stage: "geocode", status: "start" });
    try {
      const geo = await geocodeDestination(destination);
      if (geo) {
        geoPoint = { lat: geo.lat, lon: geo.lon };
        weather = await getWeatherForDates(geo.lat, geo.lon, startDate, endDate);
      }
    } catch {
      weather = [];
    }
    onStage({ stage: "geocode", status: "done" });
    contextInsight = await contextInsightPromise;
    onStage({ stage: "context", status: "done" });
    prompt = buildGeneratePrompt({
      destination,
      startDate,
      endDate,
      budget,
      tier,
      weather,
      preferences,
      contextInsight,
      resolvedFlags,
    });
  }

  onStage({ stage: "generate", status: "start" });
  const { result: raw, traceId } = await runClaude(
    prompt,
    isRefine ? "refine" : "generate",
    itineraryTimeoutMs(dayCount),
    { runId }
  );
  onStage({ stage: "generate", status: "done" });
  // The model returns just { days: [...] } — tier is known server-side, not part of its output.
  const { days } = parseJsonResponse<{ days: Itinerary["days"] }>(raw);
  const itinerary: Itinerary = { tier: effectiveTier, days: normalizeDays(days) };

  // Best-effort QA pass: checks budget/timing/context usage and swaps in a
  // corrected day set if it finds issues. Never fails the request — a
  // broken critique call just leaves the original itinerary in place.
  onStage({ stage: "critique", status: "start" });
  try {
    const critiquePrompt = buildCritiquePrompt({
      itinerary,
      budget,
      contextInsight,
      interestTags: preferences?.tags,
      resolvedFlags,
    });
    const { result: critiqueRaw } = await runClaude(critiquePrompt, "critique", DEFAULT_TIMEOUT_MS, {
      runId,
    });
    const critique = parseJsonResponse<CritiqueResult>(critiqueRaw);
    if (critique.revisedDays) {
      itinerary.days = critique.revisedDays;
    }
  } catch {
    // Keep the uncritiqued itinerary.
  }
  onStage({ stage: "critique", status: "done" });

  // Attach the real forecast (not the model's free-text guess) to each day
  // by date, so the UI can render structured icon/temp/humidity data.
  const weatherByDate = new Map(weather.map((w) => [w.date, w]));
  for (const day of itinerary.days) {
    const detail = weatherByDate.get(day.date);
    if (detail) day.weatherDetail = detail;
  }

  // Correct the model's coordinates against OSM. It writes lat/lng from memory and is often
  // badly wrong (measured: Fushimi Inari 11km off, Nishiki Market 3km), which lands map pins in
  // the wrong part of the city. Names it resolves get real positions; anything unmatched keeps
  // the model's guess, and the whole step is skipped if Overpass is unreachable.
  if (geoPoint) {
    onStage({ stage: "placing", status: "start" });
    try {
      const allStops = itinerary.days.flatMap((d) => d.stops);
      const resolved = await resolveNamedPlaceCoords(
        allStops.map((s) => s.name),
        geoPoint
      );
      for (const stop of allStops) {
        const fixed = resolved[stop.name.trim()];
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

  return { itinerary, traceId, runId };
}
```

- [ ] **Step 2: Rewrite `route.ts` to call it, plain-JSON path only**

Replace the full contents of `src/app/api/itinerary/route.ts` with:

```ts
import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { itineraryTimeoutMs, parseJsonResponse, runClaude } from "@/lib/claude";
import { insertRun } from "@/lib/db";
import { buildRebalancePrompt } from "@/lib/itineraryPrompt";
import { normalizeDays } from "@/lib/itinerary";
import { MAX_TRIP_DAYS, tripDays } from "@/lib/tiers";
import { DayPlan } from "@/lib/types";
import { GenerationParams, runGeneration } from "@/lib/generationRunner";

const GENERATION_ERROR = "The planner didn't finish. Try generating again.";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    destination,
    startDate,
    endDate,
    budget,
    tier,
    previousItinerary,
    feedback,
    preferences,
    rebalance,
    remainingDays,
    remainingBudget,
    tripId,
    userAnswers,
  } = body;

  // These are contract failures, not things a traveller can act on, so they read as one
  // sentence rather than as a field name: the client validates before it ever gets here,
  // and anything that reaches this point is a bug or a raw POST.
  if (!destination) {
    return NextResponse.json({ error: "No destination was sent with the request." }, { status: 400 });
  }

  if (rebalance) {
    try {
      if (!Array.isArray(remainingDays) || typeof remainingBudget !== "number" || !tier) {
        return NextResponse.json(
          { error: "The request was missing the days or budget to rebalance." },
          { status: 400 }
        );
      }
      // Its own run, never merged into the trip's original generation run:
      // rebalance fires on a separate later user action (possibly days after
      // generation) and produces/persists new days, unlike place-detail's
      // read-only enrichment of an already-generated pipeline — folding it
      // into the original run would make that run's total duration and step
      // sequence meaningless.
      const runId = randomUUID();
      insertRun({ id: runId, kind: "rebalance", destination, tripId: tripId ?? null });
      const prompt = buildRebalancePrompt({ destination, remainingDays, remainingBudget, tier });
      const { result: raw } = await runClaude(
        prompt,
        "rebalance",
        itineraryTimeoutMs(remainingDays.length),
        { runId }
      );
      const days = normalizeDays(parseJsonResponse<DayPlan[]>(raw));
      return NextResponse.json({ days, runId });
    } catch (err) {
      console.error("[itinerary]", err);
      return NextResponse.json({ error: GENERATION_ERROR }, { status: 500 });
    }
  }

  if (!startDate || !endDate || typeof budget !== "number") {
    return NextResponse.json(
      { error: "The request was missing a destination, dates, or a budget." },
      { status: 400 }
    );
  }

  // The client enforces this too, but the cap exists because the prompt grows with the
  // day count — so it belongs on the side that builds the prompt.
  if (tripDays(startDate, endDate) > MAX_TRIP_DAYS) {
    return NextResponse.json(
      { error: `Trips longer than ${MAX_TRIP_DAYS} days aren't supported yet.` },
      { status: 400 }
    );
  }

  const isRefine = Boolean(previousItinerary && feedback);
  if (!isRefine && !tier) {
    return NextResponse.json({ error: "No spending style was selected." }, { status: 400 });
  }

  const params: GenerationParams = {
    destination,
    startDate,
    endDate,
    budget,
    tier,
    previousItinerary,
    feedback,
    preferences,
    tripId,
    userAnswers,
  };

  try {
    const result = await runGeneration(params, () => {});
    return NextResponse.json(result);
  } catch (err) {
    // `runGeneration` throws CLI timeouts and JSON parse failures. Those messages are
    // written for a developer reading a trace, not for someone waiting on a plan, so the
    // real one goes to the server log and the client gets a recovery step.
    console.error("[itinerary]", err);
    return NextResponse.json({ error: GENERATION_ERROR }, { status: 500 });
  }
}
```

- [ ] **Step 3: Typecheck, lint, run the suite**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint && npm test`
Expected: no errors; 32 tests pass.

- [ ] **Step 4: Verify the refactor is behaviorally identical — real curl, real trace**

Start the dev server:

```bash
npm run dev
```

Send a generate request:

```bash
curl -s -X POST http://localhost:3000/api/itinerary \
  -H 'Content-Type: application/json' \
  -d '{"destination":"Kyoto, Japan","startDate":"2026-09-19","endDate":"2026-09-21","budget":1200,"tier":"midrange","preferences":{"tags":["Food"],"vibe":null}}' \
  | head -c 300
```

Expected: a normal `{"itinerary":{...},"traceId":"...","runId":"..."}` response, same shape as before this task. Then send a refine request against that result (substitute the returned itinerary):

```bash
curl -s -X POST http://localhost:3000/api/itinerary \
  -H 'Content-Type: application/json' \
  -d '{"destination":"Kyoto, Japan","startDate":"2026-09-19","endDate":"2026-09-21","budget":1200,"previousItinerary":<paste the itinerary from above>,"feedback":"Make day 2 cheaper"}' \
  | head -c 300
```

Expected: a normal revised itinerary, same shape. Also confirm a bad request still gets its specific error: `curl` the generate request with `"tier"` omitted and confirm `{"error":"No spending style was selected."}` at 400 — the validation moved but the behavior didn't.

- [ ] **Step 5: Add the streaming branch**

In `src/app/api/itinerary/route.ts`, add these two pieces. First, above `export async function POST`, add the padding frame and encoder helper:

```ts
import { StageEvent } from "@/lib/generationStages";

/** WebKit buffers a streamed response until 1024 bytes have arrived, so a few small SSE
 *  frames alone would sit invisible and then flush all at once — exactly the failure this
 *  feature exists to remove. This comment frame (ignored by the client parser, which skips
 *  any line starting with ":") exists purely to push past that threshold before the first
 *  real stage event is sent. */
const PADDING_FRAME = new TextEncoder().encode(`:${" ".repeat(2048)}\n\n`);

function sseFrame(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
```

Then, replace the final `try { const result = await runGeneration(params, () => {}); ... }` block (the last thing in `POST`, from Step 2) with:

```ts
  const isStreaming = req.nextUrl.searchParams.get("stream") === "1";

  if (!isStreaming) {
    try {
      const result = await runGeneration(params, () => {});
      return NextResponse.json(result);
    } catch (err) {
      // `runGeneration` throws CLI timeouts and JSON parse failures. Those messages are
      // written for a developer reading a trace, not for someone waiting on a plan, so the
      // real one goes to the server log and the client gets a recovery step.
      console.error("[itinerary]", err);
      return NextResponse.json({ error: GENERATION_ERROR }, { status: 500 });
    }
  }

  // Do not add `export const runtime = "edge"` — the Edge runtime is deprecated in Next 16;
  // the Node default is the only non-deprecated choice and it supports streaming.
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(PADDING_FRAME);
      const onStage = (event: StageEvent) => {
        // A stage callback throwing (e.g. the client already disconnected, so `enqueue`
        // rejects) must not abort generation — the model call keeps running either way,
        // so the failure is swallowed and logged rather than propagated.
        try {
          controller.enqueue(sseFrame("stage", event));
        } catch (err) {
          console.error("[itinerary] stage emit failed", err);
        }
      };
      try {
        const result = await runGeneration(params, onStage);
        controller.enqueue(sseFrame("done", result));
      } catch (err) {
        console.error("[itinerary]", err);
        controller.enqueue(sseFrame("error", { error: GENERATION_ERROR }));
      } finally {
        controller.close();
      }
    },
    cancel() {
      // The client navigated away or aborted the fetch; Next/undici already tears this
      // stream down for us. runGeneration has no cancellation token, so an in-flight Claude
      // call simply finishes and its result is discarded — nothing further to clean up here.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Accel-Buffering": "no",
    },
  });
}
```

- [ ] **Step 6: Typecheck, lint, run the suite**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint && npm test`
Expected: no errors; 32 tests pass.

- [ ] **Step 7: Verify streaming with `curl -N` — the real proof of the instrumentation**

With the dev server running:

```bash
curl -N -X POST 'http://localhost:3000/api/itinerary?stream=1' \
  -H 'Content-Type: application/json' \
  -d '{"destination":"Kyoto, Japan","startDate":"2026-09-19","endDate":"2026-09-21","budget":1200,"tier":"midrange","preferences":{"tags":["Food"],"vibe":null}}'
```

Expected, in order, arriving progressively over roughly 1-3 minutes (not all at once at the end):
1. `event: stage` / `data: {"stage":"context","status":"start"}`
2. `event: stage` / `data: {"stage":"geocode","status":"start"}`
3. `event: stage` / `data: {"stage":"geocode","status":"done"}`
4. `event: stage` / `data: {"stage":"context","status":"done"}`
5. `event: stage` / `data: {"stage":"generate","status":"start"}`
6. `event: stage` / `data: {"stage":"generate","status":"done"}`
7. `event: stage` / `data: {"stage":"critique","status":"start"}`
8. `event: stage` / `data: {"stage":"critique","status":"done"}`
9. `event: stage` / `data: {"stage":"placing","status":"start"}`
10. `event: stage` / `data: {"stage":"placing","status":"done"}`
11. `event: done` / `data: {"itinerary":{...},"traceId":"...","runId":"..."}`

Frames 2 and 3 may arrive before or after frame 1 finishes depending on which of geocode/context resolves first — both genuinely run concurrently, so either order is correct; what must hold is that frame 1 (context start) and frame 2 (geocode start) both arrive very close together near the top, before either "done" event.

Then run the same request WITHOUT the geocode succeeding — a nonsense destination like `"Nowhereplace1234, Nonexistent"` — and confirm `placing` reports `"status":"skipped"` instead of `start`/`done`.

Then run a refine request with `?stream=1` and confirm `geocode` and `placing` both report `"status":"skipped"` immediately, with no `start` for either.

- [ ] **Step 8: Confirm the non-streaming path is still byte-identical**

```bash
curl -s -X POST http://localhost:3000/api/itinerary \
  -H 'Content-Type: application/json' \
  -d '{"destination":"Kyoto, Japan","startDate":"2026-09-19","endDate":"2026-09-21","budget":1200,"tier":"midrange","preferences":{"tags":["Food"],"vibe":null}}' \
  | head -c 300
```

Expected: the same `{"itinerary":{...},"traceId":"...","runId":"..."}` shape as Step 4 — `?stream=1`'s absence means this request never touches the `ReadableStream` branch at all.

- [ ] **Step 9: Commit**

```bash
git add src/lib/generationRunner.ts src/app/api/itinerary/route.ts
git commit -m "Stream real per-stage progress from POST /api/itinerary

The generate/refine body already did five distinct pieces of work in
order and never reported any of them. Extracted to runGeneration() so
the existing plain-JSON response and a new ?stream=1 SSE response run
the identical pipeline -- a no-op onStage for the first, a real
emitter writing SSE frames for the second.

skipped is a first-class status, not an afterthought: refine never
geocodes or re-places, and a failed geocode skips placing too -- both
now reported instead of leaving those steps looking stuck.

The leading padding frame exists because WebKit buffers a streamed
response until 1024 bytes arrive; without it the loader this feature
builds would sit blank and then flush every stage at once.

?stream=1 is opt-in and the non-streaming path is untouched in shape,
so every existing caller (PipelineConsole, raw curl) is unaffected."
```

---

### Task 3: Client SSE frame parser

`EventSource` is GET-only, so reading a POST-initiated SSE stream means `fetch` + `response.body.getReader()` + `TextDecoder` by hand. The one real risk here is a frame split across a chunk boundary — a parser that assumes one chunk equals one frame passes every test written against a single `enqueue()` call and then corrupts real network traffic. This task is fully independent of Task 2; it can be done before, after, or interleaved with it.

**Files:**
- Create: `src/lib/eventStream.ts`
- Test: `src/lib/eventStream.test.mjs` (create)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `readEventStream(body: ReadableStream<Uint8Array>, onEvent: (event: string, data: string) => void): Promise<void>`. Task 4 imports this.

- [ ] **Step 1: Write the failing test**

Create `src/lib/eventStream.test.mjs`:

```js
/* Run: node --test src/lib/eventStream.test.mjs
 *
 * SSE frames arrive as raw bytes over a real network connection, which never guarantees
 * one chunk equals one frame. A parser that assumes it will pass every test written
 * against a single enqueue() call and then corrupt real traffic — these asserts
 * specifically split and combine frames across chunk boundaries to catch that class of
 * bug before it ships. */
import assert from "node:assert/strict";
import test from "node:test";
import { readEventStream } from "./eventStream.ts";

function streamFromChunks(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

test("a frame split across two chunks parses as one event", async () => {
  const events = [];
  await readEventStream(
    streamFromChunks(['event: stage\ndata: {"stage":"geo', 'code","status":"start"}\n\n']),
    (event, data) => events.push({ event, data })
  );
  assert.deepEqual(events, [{ event: "stage", data: '{"stage":"geocode","status":"start"}' }]);
});

test("multiple frames in a single chunk parse as several events", async () => {
  const events = [];
  await readEventStream(
    streamFromChunks([
      'event: stage\ndata: {"stage":"geocode","status":"start"}\n\n' +
        'event: stage\ndata: {"stage":"geocode","status":"done"}\n\n',
    ]),
    (event, data) => events.push({ event, data })
  );
  assert.equal(events.length, 2);
  assert.equal(events[0].data, '{"stage":"geocode","status":"start"}');
  assert.equal(events[1].data, '{"stage":"geocode","status":"done"}');
});

test("the leading comment frame is ignored", async () => {
  const events = [];
  await readEventStream(
    streamFromChunks([
      `:${" ".repeat(2048)}\n\n`,
      'event: stage\ndata: {"stage":"geocode","status":"start"}\n\n',
    ]),
    (event, data) => events.push({ event, data })
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "stage");
});

test("a trailing partial frame does not emit", async () => {
  const events = [];
  await readEventStream(
    streamFromChunks([
      'event: stage\ndata: {"stage":"geocode","status":"start"}\n\n',
      'event: stage\ndata: {"stage":"conte',
    ]),
    (event, data) => events.push({ event, data })
  );
  assert.equal(events.length, 1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/lib/eventStream.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` — `./eventStream.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/lib/eventStream.ts`. Zero imports — `ReadableStream`, `TextDecoder`, and everything else used here are Web APIs global in both Node 22 and every target browser, so this module is trivially loadable by a `.test.mjs`:

```ts
/**
 * Parses a Server-Sent Events response body into individual events. `EventSource` is
 * GET-only, so a POST-initiated SSE stream (this app's `/api/itinerary?stream=1`) has to be
 * read by hand: `fetch`, `response.body.getReader()`, `TextDecoder`. A chunk boundary can
 * split a frame mid-way — this is the one thing a parser that assumes one chunk equals one
 * frame gets wrong under real network conditions, so `buffer` persists raw text across reads
 * until a complete `\n\n`-terminated frame is available.
 */
export async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: string) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let separatorIndex = buffer.indexOf("\n\n");
    while (separatorIndex !== -1) {
      const rawFrame = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      dispatchFrame(rawFrame, onEvent);
      separatorIndex = buffer.indexOf("\n\n");
    }
  }
  // Any text left in `buffer` here is an unterminated trailing frame — the stream ended
  // before its closing "\n\n" arrived. Dropped deliberately: a partial frame has no
  // reliable event/data split, and the caller detects "the stream ended with nothing
  // usable" by checking whether it ever received a done/error event, not by this function
  // throwing.
}

function dispatchFrame(rawFrame: string, onEvent: (event: string, data: string) => void): void {
  let event = "message";
  let data = "";
  for (const line of rawFrame.split("\n")) {
    if (line.startsWith(":")) continue; // the leading padding/comment frame, or any other comment
    if (line.startsWith("event:")) event = line.slice("event:".length).trim();
    else if (line.startsWith("data:")) data = line.slice("data:".length).trim();
  }
  if (data) onEvent(event, data);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/lib/eventStream.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: 36 tests pass (32 from Task 1 + 4 new); no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/eventStream.ts src/lib/eventStream.test.mjs
git commit -m "Add readEventStream, a chunk-safe SSE parser for POST responses

EventSource is GET-only, so a POST-initiated stream has to be read by
hand: fetch, response.body.getReader(), TextDecoder. A chunk boundary
can split a frame mid-way, and a parser that assumes one chunk equals
one frame passes every test written against a single enqueue() call
and then corrupts real network traffic -- these tests specifically
split and recombine frames across chunk boundaries.

Zero imports, so it loads under Node's type-stripping test runner
without any import-shape constraint to maintain."
```

---

### Task 4: Wire the loader to real stages

`GenerationLoader` currently cycles five fixed captions on a timer, disconnected from the server. It now renders the five real stages from Task 1, driven by real events read via Task 3's parser from Task 2's stream. `page.tsx`'s `generate()`/`refine()` post with `?stream=1`, falling back to the plain JSON POST if the stream never opens at all.

**Files:**
- Modify: `src/components/cesium/GenerationLoader.tsx` (full rewrite)
- Modify: `src/app/page.tsx` (add a `runStreamed` helper; rewrite `generate()`/`refine()`; add `stages` state; pass `stages` to `GenerationLoader`)

**Interfaces:**
- Consumes: `STAGE_ORDER`, `stageMeta`, `StageId`, `StageStatus`, `StageEvent` from Task 1; `readEventStream` from Task 3.
- Produces: `StageProgress` type (exported from `GenerationLoader.tsx`) — `{ stage: StageId; status: "pending" | StageStatus }`. Nothing outside this task consumes it.

- [ ] **Step 1: Rewrite `GenerationLoader.tsx`**

Replace the full contents of `src/components/cesium/GenerationLoader.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { STAGE_ORDER, stageMeta, StageId, StageStatus } from "@/lib/generationStages";

/** Each word is split into individual <span>s so every letter can carry its own
 *  staggered animation-delay — see the `.loader-letter:nth-child(n)` rules in
 *  globals.css, which cover exactly 10 letters. **Every word here must be 10
 *  characters long**, or those rules need extending to match. The assertion below
 *  is what turns that from a comment into something that fails loudly. */
const WORD = {
  generate: { word: "Generating", baseLabel: "Generating your itinerary" },
  refine: { word: "Rethinking", baseLabel: "Reworking your itinerary" },
} as const;

if (process.env.NODE_ENV !== "production") {
  for (const [mode, { word }] of Object.entries(WORD)) {
    if (word.length !== 10) {
      console.error(
        `GenerationLoader: "${word}" (${mode}) is ${word.length} letters. globals.css only staggers 10.`
      );
    }
  }
}

const CAPTION_INTERVAL_MS = 2500;

export interface StageProgress {
  stage: StageId;
  status: "pending" | StageStatus;
}

function activeStageId(stages: StageProgress[]): StageId {
  const inProgress = stages.find((s) => s.status === "start");
  if (inProgress) return inProgress.stage;
  // Nothing has started yet (the stream just opened) or every stage already finished —
  // fall back to the first stage so there is always a caption to show.
  return stages[0]?.stage ?? STAGE_ORDER[0];
}

/** The wait indicator for any long model call — shows only while `active`, rendering the
 *  five real generation stages (generationStages.ts) with their live status, plus a caption
 *  that rotates within whichever stage is currently running. Floats centered over the globe. */
export default function GenerationLoader({
  active,
  mode = "generate",
  stages,
}: {
  active: boolean;
  mode?: keyof typeof WORD;
  stages: StageProgress[];
}) {
  const { word, baseLabel } = WORD[mode];
  const activeId = activeStageId(stages);
  const [index, setIndex] = useState(0);

  // Resets to the top of the new stage's caption list whenever the active stage changes,
  // so switching stages never shows a caption mid-rotation that belonged to the last one.
  useEffect(() => {
    setIndex(0);
  }, [activeId]);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setIndex((i) => i + 1), CAPTION_INTERVAL_MS);
    return () => clearInterval(id);
  }, [active]);

  if (!active) return null;

  const activeMeta = stageMeta(mode, activeId);
  const caption = activeMeta.captions[index % activeMeta.captions.length];
  const activeEntry = stages.find((s) => s.stage === activeId);
  const activeLabel = activeEntry?.status === "start" ? activeMeta.label : null;

  return (
    // The live region is the outer box; its announced content is one real string that now
    // changes on a genuine stage transition (five of them, each meaningful — a stage change
    // is exactly the answer to "is this stuck") rather than only once at mount. The rotating
    // captions below stay aria-hidden, same reasoning as before: several cycle past within
    // one stage saying nothing the stage label doesn't.
    <div
      role="status"
      className="pointer-events-none fixed left-1/2 top-1/2 z-30 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3"
    >
      <span className="sr-only">{activeLabel ? `${baseLabel} — ${activeLabel}` : baseLabel}</span>
      <div className="loader-wrapper" aria-hidden="true">
        {word.split("").map((letter, i) => (
          <span key={i} className="loader-letter">
            {letter}
          </span>
        ))}
        <div className="loader" />
      </div>

      <div className="flex items-center gap-3" aria-hidden="true">
        {stages.map(({ stage, status }) => {
          const meta = stageMeta(mode, stage);
          return (
            <div key={stage} className="flex flex-col items-center gap-1">
              <span
                className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${
                  status === "done"
                    ? "bg-accent"
                    : status === "start"
                      ? "animate-pulse bg-accent/60"
                      : status === "skipped"
                        ? "bg-white/20"
                        : "bg-white/10"
                }`}
              />
              <span className="text-[10px] font-medium text-foreground/70">{meta.label}</span>
            </div>
          );
        })}
      </div>

      {/* Caption pill carries the same frosted treatment as the itinerary card
          and every other panel over the map — see .glass-itinerary in
          globals.css, which also sets --foreground, so text-foreground
          resolves to white here. */}
      <AnimatePresence mode="wait">
        <motion.div
          aria-hidden="true"
          key={caption}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2 }}
          className="glass-itinerary rounded-full px-3 py-1 text-xs font-medium text-foreground"
        >
          {caption}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
```

Reduced motion needs no new work here: the global rule at `src/app/globals.css:141` already flattens every transition and keyframe animation (including the new dot color transitions and the pulse) to near-zero.

- [ ] **Step 2: Typecheck the component in isolation**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: errors in `src/app/page.tsx` (it still calls `<GenerationLoader active={...} mode={...} />` without the now-required `stages` prop) — this is expected at this point; Step 3 fixes it. Confirm the error is specifically the missing `stages` prop, not something else.

- [ ] **Step 3: Wire `page.tsx`**

In `src/app/page.tsx`, add these imports alongside the existing ones:

```ts
import { readEventStream } from "@/lib/eventStream";
import { STAGE_ORDER, StageEvent } from "@/lib/generationStages";
import type { StageProgress } from "@/components/cesium/GenerationLoader";
```

Add a `stages` state declaration near the existing `generating`/`refining` state (around line 235):

```ts
  const [stages, setStages] = useState<StageProgress[]>(
    STAGE_ORDER.map((stage) => ({ stage, status: "pending" as const }))
  );
```

Add this helper function above `generate()` (it is shared by both `generate()` and `refine()` — the reason it lives here rather than in a separate module is that its only two callers are both in this file, and it needs direct access to `setStages`):

```ts
  /**
   * Posts to /api/itinerary with `?stream=1` and updates `stages` as real progress frames
   * arrive via readEventStream. Falls back to the plain (non-streaming) POST if the stream
   * never opens at all — a network error or non-200 status before any bytes arrive. Once
   * streaming has genuinely started, a mid-generation failure is never retried: it would
   * spend another two minutes and a second pair of model calls with no visibility to the
   * traveler that it's happening again.
   */
  async function runStreamed<T>(body: Record<string, unknown>): Promise<T> {
    const plainFallback = async (): Promise<T> => {
      const res = await fetch("/api/itinerary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate itinerary");
      return data as T;
    };

    let res: Response;
    try {
      res = await fetch("/api/itinerary?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      return plainFallback();
    }

    if (!res.ok || !res.body) {
      return plainFallback();
    }

    let result: T | null = null;
    let failure: string | null = null;
    await readEventStream(res.body, (event, data) => {
      if (event === "stage") {
        const parsed = JSON.parse(data) as StageEvent;
        setStages((prev) =>
          prev.map((s) => (s.stage === parsed.stage ? { ...s, status: parsed.status } : s))
        );
      } else if (event === "done") {
        result = JSON.parse(data) as T;
      } else if (event === "error") {
        failure = (JSON.parse(data) as { error: string }).error;
      }
    });

    if (failure) throw new Error(failure);
    if (!result) throw new Error("The planner didn't finish. Try generating again.");
    return result;
  }
```

Replace the body of `generate()` (currently around line 388-444):

```ts
  async function generate() {
    const invalid = validate();
    if (invalid) {
      setError(invalid);
      return;
    }

    setGenerating(true);
    setError(null);
    setStages(STAGE_ORDER.map((stage) => ({ stage, status: "pending" as const })));
    try {
      const data = await runStreamed<{ itinerary: Itinerary; runId?: string | null }>({
        destination,
        startDate,
        endDate,
        budget,
        tier,
        preferences: { tags: interests, vibe: null },
        userAnswers: currentAnswers(),
      });
      setItinerary(data.itinerary);
      setLastRunId(data.runId ?? null);
      setRevealAnimation(true);
      setStep("result");

      // After success only, never on each screen advance: a wizard the traveler
      // abandoned halfway is not a statement about how they travel. Failures are
      // swallowed — this must never surface an error on a trip they just waited
      // two minutes for.
      fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: {
            group,
            explorerStyle,
            energy,
            crowds,
            tier,
            priorities: interests,
            topPriorities: starredInterests,
          },
        }),
      }).catch(() => {});
    } catch (e) {
      setError(errorMessage(e, "We couldn't build your itinerary. Try generating again."));
    } finally {
      setGenerating(false);
    }
  }
```

Replace the body of `refine()` (currently around line 446-472):

```ts
  async function refine(feedback: string) {
    setRefining(true);
    setError(null);
    setStages(STAGE_ORDER.map((stage) => ({ stage, status: "pending" as const })));
    try {
      const data = await runStreamed<{ itinerary: Itinerary; runId?: string | null }>({
        destination,
        startDate,
        endDate,
        budget,
        previousItinerary: itinerary,
        feedback,
        userAnswers: currentAnswers(),
      });
      setItinerary(data.itinerary);
      setLastRunId(data.runId ?? null);
    } catch (e) {
      setError(errorMessage(e, "We couldn't apply that change. Your current plan is unchanged."));
    } finally {
      setRefining(false);
    }
  }
```

Update the `<GenerationLoader>` call site (around line 525):

```tsx
      <GenerationLoader active={generating || refining} mode={refining ? "refine" : "generate"} stages={stages} />
```

**Deliberately out of scope:** true unmount-cancellation (aborting the fetch when the component unmounts mid-stream). This page never actually unmounts during a generation — `step` changes within the same component rather than a route navigation — so the scenario the design's failure table describes ("user navigates away") has no real trigger in this app today. A hard tab close or reload is handled for free by the browser tearing down the connection, which the route's `cancel()` handler (Task 2) already accounts for. Do not add an `AbortController` for a path that can't currently be exercised.

- [ ] **Step 4: Typecheck, lint, run the suite**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint && npm test`
Expected: no errors; 36 tests pass (no new tests this task — this is UI wiring verified live, not new pure logic).

- [ ] **Step 5: Browser verification — this step cannot be done by a subagent**

If executing this plan via subagent-driven-development: no dispatched implementer has browser access. This step must be performed by whoever is driving the browser tooling directly (the controller, or you).

With `npm run dev` running, open the app and walk the wizard through to a real generate:

1. Confirm the five stage dots appear below the animated word, each with a short label (Locating / Context / Planning / Reviewing / Placing).
2. Confirm dots visibly progress one at a time — dim → pulsing → filled — rather than all filling at once at the end. This is the direct visual proof that the padding frame is working and that the stream is not being buffered into one flush; it is also the check for the design's open risk (Next's gzip compression potentially buffering the stream in a real browser, which cannot be assumed away and must be observed).
3. Confirm the caption pill's text changes and stays thematically matched to whichever dot is currently pulsing (e.g. a weather/destination-flavored caption while "Locating" pulses, not a budget-flavored one).
4. Read the accessibility tree (or inspect the `role="status"` element's text content directly) and confirm the `sr-only` text changes as stages transition — it should read something like "Generating your itinerary — Locating" while geocode is active, then update as later stages start.
5. Force a failure (e.g. temporarily stop the dev server partway through, or use a destination string designed to make `runClaude` time out if you have a way to induce that) and confirm the error copy appears with no automatic retry — the request must not silently fire again.
6. Repeat steps 1-3 for a refine call and confirm the Locating and Placing dots go straight to their "skipped" (dim, no pulse) appearance rather than ever pulsing.

**Chrome and Safari both.** The compression-buffering open risk is specifically a WebKit/Safari concern (the 1024-byte buffering threshold that motivated the padding frame is documented for WebKit, not Chromium) — a Chrome-only check proves nothing about the failure this feature exists to prevent. If Safari is genuinely unavailable in the execution environment, this must be stated explicitly as an unverified risk in whatever report closes out this task — do not silently skip it without saying so.

If stages do not arrive incrementally in either browser, the spec's prescribed order of remedies is: confirm the padding frame is actually present and large enough; check whether Next is compressing `text/event-stream` responses at all; and only if it is a real problem, exclude the route from compression via a `headers()` entry in `next.config.ts` rather than disabling `compress` globally.

- [ ] **Step 6: Commit**

```bash
git add src/components/cesium/GenerationLoader.tsx src/app/page.tsx
git commit -m "Drive the loader from real per-stage SSE progress

GenerationLoader now renders the five real stages with live status
(pending/start/done/skipped) instead of cycling five fixed captions
disconnected from the server. Captions still rotate on the same 2.5s
timer, now scoped to whichever stage is actually running, and reset
to the top of the new stage's list on every transition.

generate()/refine() post with ?stream=1 and fall back to the plain
JSON POST if the stream never opens. A mid-stream failure is never
retried -- it would spend another two minutes and a second pair of
model calls with no visibility that it's happening again.

The sr-only live region now announces stage transitions instead of a
single static label -- there are five of them, each meaningful, and a
stage change is exactly the answer to \"is this stuck\". The rotating
captions stay aria-hidden for the reason they always were."
```

---

### Task 5: Update the stale comment and the tracker docs

**Files:**
- Modify: `src/components/backend/PipelineConsole.tsx` (two comments, currently describing SSE as a hypothetical bigger change — it now exists)
- Modify: `docs/frontend.md`, `docs/backend.md`, `docs/project-crux.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Update the component-level comment**

In `src/components/backend/PipelineConsole.tsx`, the doc comment above `export default function PipelineConsole()` currently reads (around line 77-85):

```
/**
 * The LLM agent architecture, drawn as a clean system-design flow diagram (boxes + arrows, one
 * per real step) rather than prose — and it's also the console that invokes it. Idle, every node
 * just states its input/output shape. Hit Run and every node for that flow lights up "running"
 * together (the four routes here are single synchronous requests server-side, so there's no
 * signal for genuine sub-step progress without adding SSE — see the comment on `run()` below);
 * once the response lands, each node settles to its own real status and — click it — its real
 * prompt and response for that exact invocation.
 */
```

Replace it with:

```
/**
 * The LLM agent architecture, drawn as a clean system-design flow diagram (boxes + arrows, one
 * per real step) rather than prose — and it's also the console that invokes it. Idle, every node
 * just states its input/output shape. Hit Run and every node for that flow lights up "running"
 * together — this console still posts once and fetches the run afterward rather than consuming
 * the itinerary route's own SSE stream (page.tsx does that now; see generationStages.ts), so
 * there's no live signal here for genuine sub-step progress on generate/refine, and rebalance/
 * place-detail were never streamed in the first place; once the response lands, each node
 * settles to its own real status and — click it — its real prompt and response for that exact
 * invocation.
 */
```

- [ ] **Step 2: Update the `run()` comment**

Further down the same file, the comment above the network round-trip inside `run()` currently reads (around line 191-195):

```
      \ A second round-trip, not part of the invocation itself: the itinerary/place-detail
      // routes only ever return `runId`, not the per-step trace rows they just wrote — fetching
      // the run is what turns that id into the real per-node status/prompt/response this diagram
      // shows. Real per-*sub-step* progress while the first request is still in flight would need
      // the route itself to stream (SSE) rather than respond once at the end; that's a bigger
      // change than this console makes, hence the "everything lights up together" running state.
```

Replace it with:

```
      // A second round-trip, not part of the invocation itself: the itinerary/place-detail
      // routes only ever return `runId`, not the per-step trace rows they just wrote — fetching
      // the run is what turns that id into the real per-node status/prompt/response this diagram
      // shows. The itinerary route's generate/refine calls now stream real per-stage progress
      // over SSE (?stream=1 — see src/lib/generationRunner.ts, consumed by page.tsx, not by this
      // console), but this stays a developer tool that wants the final trace rows rather than a
      // live progress bar, so it keeps posting once and fetching the run afterward — hence the
      // "everything lights up together" running state.
```

(Note: the original comment's first line has a stray `\` instead of `//` — a pre-existing typo. Fix it to `//` while you're editing this block, since you're already touching this exact line.)

- [ ] **Step 3: Add the tracker doc rows**

All three trackers share the columns `| Feature | Status | Since | Developer | Notes |`. Append to each Features table:

`docs/backend.md`:

```md
| `POST /api/itinerary?stream=1` — SSE progress stream | Active | 2026-08-16 | Zaid | Same `runGeneration()` pipeline as the plain JSON response (extracted to `src/lib/generationRunner.ts`), just with an `onStage` emitter instead of a no-op; opt-in via query param so every existing caller (`PipelineConsole`, raw `curl`) is unaffected |
```

`docs/frontend.md`:

```md
| `GenerationLoader` streams real per-stage progress | Active | 2026-08-16 | Zaid | Five real stages (geocode/context/generate/critique/placing) replace the old fixed 5-caption loop; captions rotate per-stage from `generationStages.ts`, sr-only text announces stage transitions |
```

Add one row to the timeline table in `docs/project-crux.md`:

| Date | Area | Developer | What happened |
|---|---|---|---|
| 2026-08-16 | Frontend, Backend | Zaid | Generation progress stream: the fixed-caption loader is replaced with real per-stage progress over SSE. `runGeneration()` extracted from the itinerary route into its own module so the plain-JSON and streamed responses share one implementation; opt-in via `?stream=1` keeps every existing caller unmodified |

- [ ] **Step 4: Commit**

```bash
git add src/components/backend/PipelineConsole.tsx docs/backend.md docs/frontend.md docs/project-crux.md
git commit -m "Log the generation progress stream in the tracker docs

Also corrects PipelineConsole's own comments, which described SSE as
a hypothetical bigger change this console might someday need -- it
now exists, just not consumed by this particular developer tool."
```

---

## Done criteria

- [ ] `npm test` passes with 36 tests.
- [ ] `npx tsc --noEmit -p tsconfig.json` is clean.
- [ ] `npm run lint` introduces no new errors.
- [ ] `curl -N 'http://localhost:3000/api/itinerary?stream=1'` shows frames arriving progressively over the real duration of a generation, in the documented order, with `skipped` reported correctly for refine and for a failed geocode.
- [ ] The same request without `?stream=1` returns the identical response shape it returned before this plan.
- [ ] In an actual browser (Chrome **and** Safari), the five stage dots visibly progress one at a time rather than flushing at once, captions stay thematically matched to the active stage, and the sr-only live region announces stage transitions.
- [ ] A forced mid-generation failure shows the error with no automatic retry.
