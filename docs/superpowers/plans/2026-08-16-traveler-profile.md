# Traveler Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the seven screens of wizard answers actually reach the model, and remember the durable ones between trips.

**Architecture:** `deriveFlags()` already converts the traveler's answers into planning constraints and the result is discarded. Tasks 1–4 route it into the generate, refine, and critique prompts — that is the whole defect fix and it ships on its own. Tasks 5–7 add a `traveler_profile` table that seeds the wizard's defaults on a later visit. Task 8 updates the docs.

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript, `better-sqlite3`, `node:test` (no framework).

**Spec:** [`docs/superpowers/specs/2026-08-16-traveler-profile-design.md`](../specs/2026-08-16-traveler-profile-design.md)

## Global Constraints

- **Node ≥ 22 is mandatory.** `better-sqlite3`'s native binding kills the dev server on Node 20 the moment a DB route is hit.
- **Add no new dependencies.** Everything here uses what is already installed.
- **DB rows are `snake_case`, API and type surfaces are `camelCase`**, mapped by hand in each route.
- **Fail-soft is the house convention.** External and optional data degrades; it does not throw.
- **No migration files.** Tables are created at import time in `src/lib/db.ts` with `CREATE TABLE IF NOT EXISTS`; later columns use the `addColumnIfMissing()` PRAGMA guard.
- **A `.test.mjs` can only import a `.ts` module whose own imports are all `import type`.** Node erases those and resolves nothing at runtime. A value import, or a type imported without the `type` keyword, fails with `ERR_MODULE_NOT_FOUND`.
- **Calendar dates are parsed as UTC midnight.** Use `getUTC*()` / `timeZone: "UTC"` for anything date-only. Not directly exercised by this plan, but do not introduce a violation.
- **Commit messages carry no Claude/AI attribution trailers.** Repository owner's explicit instruction.
- **`AGENTS.md` is rewritten by `next dev`.** If it shows as modified, commit it with the work rather than reverting it.
- **Verification is never typecheck alone.** `npm test`, `npx tsc --noEmit -p tsconfig.json`, `npm run lint`, and a real `curl` against a running dev server.

---

### Task 1: Make `deriveFlags` testable and lock its weights

`src/lib/userAnswers.ts` holds the pace/mobility/crowd weights everyone will want to tune, with no test. Its imports are all types but are written without the `type` keyword, so Node cannot load it. One keyword unlocks coverage.

**Files:**
- Modify: `src/lib/userAnswers.ts:1-12`
- Test: `src/lib/userAnswers.test.mjs` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `deriveFlags(answers: UserAnswers): ResolvedFlags`, already exported and unchanged in behaviour. Task 2 and Task 4 depend on its output shape.

- [ ] **Step 1: Add the `type` keyword to the import**

Change line 1 of `src/lib/userAnswers.ts` from `import {` to `import type {`. Every name in that block (`CrowdBias`, `CrowdPreference`, `EnergyLevel`, `ExplorerStyle`, `FamilyRules`, `GroupType`, `MobilityProfile`, `Pace`, `ResolvedFlags`, `UserAnswers`) is a type, so nothing else changes:

```ts
import type {
  CrowdBias,
  CrowdPreference,
  EnergyLevel,
  ExplorerStyle,
  FamilyRules,
  GroupType,
  MobilityProfile,
  Pace,
  ResolvedFlags,
  UserAnswers,
} from "./types";
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/userAnswers.test.mjs`:

```js
/* Run: node --test src/lib/userAnswers.test.mjs
 *
 * These weights decide how full a day feels, and they are the first thing anyone
 * will adjust after reading a few real itineraries. The asserts pin the two ends
 * of the range and the floor, so a tuning change that accidentally collapses the
 * scale fails here instead of in a generated trip. */
import assert from "node:assert/strict";
import test from "node:test";
import { deriveFlags, derivePaceSpotsPerDay, labelPace, PACE_FLOOR } from "./userAnswers.ts";

const answers = (over) => ({
  purpose: "leisure",
  explorerStyle: "mixed",
  group: "solo",
  energy: "moderate",
  crowds: "mixed",
  budget: 1000,
  priorities: [],
  topPriorities: [],
  selectedPois: [],
  customPois: [],
  ...over,
});

test("a packed, high-energy solo traveler gets the top of the range", () => {
  assert.equal(derivePaceSpotsPerDay("packed", "solo", "high"), 5);
  assert.equal(labelPace(5), "fast");
});

test("energy and kids step the pace down, and the floor holds", () => {
  // relaxed ceiling 3, low energy -2, family -1 = 0, floored to PACE_FLOOR.
  assert.equal(derivePaceSpotsPerDay("relaxed", "family_with_kids", "low"), PACE_FLOOR);
  assert.equal(labelPace(PACE_FLOOR), "slow");
});

test("a low-energy traveler gets every mobility constraint set", () => {
  const flags = deriveFlags(answers({ energy: "low" }));
  assert.deepEqual(flags.mobilityProfile, {
    walkLegCap: "tight",
    minimizeStairs: true,
    restBreaks: true,
    preferTransitOverLongWalks: true,
  });
});

test("familyRules is null for anyone not travelling with kids", () => {
  assert.equal(deriveFlags(answers({ group: "solo" })).familyRules, null);
  assert.ok(deriveFlags(answers({ group: "family_with_kids" })).familyRules);
});

test("starred priorities become primary, the rest tiebreakers", () => {
  const flags = deriveFlags(
    answers({ priorities: ["Food", "Nightlife", "Shopping"], topPriorities: ["Food"] })
  );
  assert.deepEqual(flags.prioritiesRanked, {
    primary: ["Food"],
    tiebreakers: ["Nightlife", "Shopping"],
  });
});
```

- [ ] **Step 3: Run the test**

Run: `node --test src/lib/userAnswers.test.mjs`
Expected: PASS, 5 tests. These characterize existing behaviour, so they pass immediately — that is the point. If any fails, `deriveFlags` does not do what the spec claims and that must be resolved before continuing.

- [ ] **Step 4: Confirm the whole suite still discovers everything**

Run: `npm test`
Expected: 16 tests, 16 pass (11 existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/userAnswers.ts src/lib/userAnswers.test.mjs
git commit -m "Cover deriveFlags with tests

Its imports were all types written without the type keyword, so Node
could not load the module and the pace/mobility/crowd weights had no
coverage. One keyword fixes that.

The asserts pin both ends of the pace range and the floor, so a tuning
change that collapses the scale fails here rather than in a generated
trip."
```

---

### Task 2: The `formatTravelerProfile` prompt block

The formatter gets its own module rather than living in `itineraryPrompt.ts`, because that file imports `TIERS` as a value and therefore cannot be loaded by a `.test.mjs`. A separate module with type-only imports is testable and has one job.

**Files:**
- Create: `src/lib/travelerProfilePrompt.ts`
- Test: `src/lib/travelerProfilePrompt.test.mjs` (create)

**Interfaces:**
- Consumes: `ResolvedFlags` from `src/lib/types.ts` (type only), as produced by `deriveFlags` in Task 1.
- Produces: `formatTravelerProfile(flags: ResolvedFlags | null): string` — returns `""` for `null`. Tasks 3 and 4 import this.

- [ ] **Step 1: Write the failing test**

Create `src/lib/travelerProfilePrompt.test.mjs`:

```js
/* Run: node --test src/lib/travelerProfilePrompt.test.mjs
 *
 * This block is the only path the traveler's answers take into the prompt, so
 * "says nothing when there is nothing to say" matters as much as what it emits:
 * a caller with no answers must leave the prompt byte-identical to before. */
import assert from "node:assert/strict";
import test from "node:test";
import { formatTravelerProfile } from "./travelerProfilePrompt.ts";

const flags = (over) => ({
  paceSpotsPerDay: 4,
  paceResolved: "fast",
  mobilityProfile: {
    walkLegCap: "normal",
    minimizeStairs: false,
    restBreaks: false,
    preferTransitOverLongWalks: false,
  },
  crowdBias: {
    preferOffpeakTiming: false,
    boostOffbeatPois: false,
    scheduleIconsAtOffpeak: false,
    marketsAndLivelyOk: false,
    peakTimingOk: false,
  },
  prioritiesRanked: { primary: [], tiebreakers: [] },
  familyRules: null,
  ...over,
});

test("returns an empty string when there are no flags", () => {
  assert.equal(formatTravelerProfile(null), "");
});

test("always states the pace target", () => {
  const out = formatTravelerProfile(flags({ paceSpotsPerDay: 2, paceResolved: "slow" }));
  assert.match(out, /about 2 stops per day/);
  assert.match(out, /"slow"/);
});

test("a low-energy family traveler gets mobility and kid lines", () => {
  const out = formatTravelerProfile(
    flags({
      mobilityProfile: {
        walkLegCap: "tight",
        minimizeStairs: true,
        restBreaks: true,
        preferTransitOverLongWalks: true,
      },
      familyRules: { kidFriendlyBias: true, noLateNight: true, shortTravelLegs: true },
    })
  );
  assert.match(out, /walking legs between stops short/);
  assert.match(out, /avoid stairs/);
  assert.match(out, /rest breaks/);
  assert.match(out, /kid-friendly/);
  assert.match(out, /no late-night/);
});

test("an unconstrained traveler gets neither the mobility nor the kid line", () => {
  const out = formatTravelerProfile(flags());
  assert.doesNotMatch(out, /Mobility:/);
  assert.doesNotMatch(out, /kid-friendly/);
});

test("crowd avoidance and crowd enjoyment are different lines", () => {
  const avoids = formatTravelerProfile(
    flags({
      crowdBias: {
        preferOffpeakTiming: true,
        boostOffbeatPois: true,
        scheduleIconsAtOffpeak: true,
        marketsAndLivelyOk: false,
        peakTimingOk: false,
      },
    })
  );
  assert.match(avoids, /off-peak/);
  assert.doesNotMatch(avoids, /lively areas are welcome/);

  const loves = formatTravelerProfile(
    flags({
      crowdBias: {
        preferOffpeakTiming: false,
        boostOffbeatPois: false,
        scheduleIconsAtOffpeak: false,
        marketsAndLivelyOk: true,
        peakTimingOk: true,
      },
    })
  );
  assert.match(loves, /lively areas are welcome/);
});

test("starred priorities are separated from tiebreakers", () => {
  const out = formatTravelerProfile(
    flags({ prioritiesRanked: { primary: ["Food"], tiebreakers: ["Shopping", "Nightlife"] } })
  );
  assert.match(out, /Top priorities[^\n]*Food/);
  assert.match(out, /Shopping, Nightlife/);
});

test("omits the priorities line entirely when nothing is starred", () => {
  const out = formatTravelerProfile(flags({ prioritiesRanked: { primary: [], tiebreakers: [] } }));
  assert.doesNotMatch(out, /Top priorities/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/lib/travelerProfilePrompt.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` — `./travelerProfilePrompt.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/lib/travelerProfilePrompt.ts`:

```ts
import type { ResolvedFlags } from "./types";

/**
 * The traveler's answers, rendered as prompt lines. Kept in its own module rather
 * than beside the other `format*` helpers in `itineraryPrompt.ts` for one concrete
 * reason: that file imports `TIERS` as a value, which makes it unloadable from a
 * `.test.mjs` under Node's type-stripping. This is the block that decides whether
 * six screens of questions had any effect, so it gets to be tested.
 *
 * Returns "" for null so an absent `userAnswers` leaves the prompt byte-identical
 * to what it was before this existed — that is what keeps every older caller
 * (PipelineConsole, raw curl) working unchanged.
 *
 * Interests are deliberately NOT repeated here. `formatPreferences` already owns
 * the tag list and its per-tag guidance; this adds only the starred/unstarred
 * ranking, which that helper has no notion of.
 */
export function formatTravelerProfile(flags: ResolvedFlags | null): string {
  if (!flags) return "";

  const lines: string[] = [
    `Plan about ${flags.paceSpotsPerDay} stops per day — the traveler's resolved pace is "${flags.paceResolved}". Treat it as a target, not a minimum: fewer, better-chosen stops beat a day they cannot finish.`,
  ];

  const mobility = flags.mobilityProfile;
  if (mobility.walkLegCap === "tight") {
    const rules = ["keep walking legs between stops short"];
    if (mobility.minimizeStairs) rules.push("avoid stairs and steep climbs where an alternative exists");
    if (mobility.restBreaks) rules.push("build in sit-down rest breaks");
    if (mobility.preferTransitOverLongWalks) rules.push("prefer transit over any long walk");
    lines.push(`Mobility: ${rules.join("; ")}.`);
  }

  const crowds = flags.crowdBias;
  if (crowds.preferOffpeakTiming || crowds.scheduleIconsAtOffpeak || crowds.boostOffbeatPois) {
    lines.push(
      `Crowds: this traveler avoids them — schedule well-known sights at off-peak hours and favor lesser-known alternatives over headline attractions.`
    );
  } else if (crowds.marketsAndLivelyOk || crowds.peakTimingOk) {
    lines.push(
      `Crowds: this traveler enjoys them — busy markets and lively areas are welcome, and peak-hour timing is fine.`
    );
  }

  if (flags.familyRules) {
    lines.push(
      `Travelling with kids: choose kid-friendly stops, schedule no late-night activities, and keep travel legs between stops short.`
    );
  }

  const { primary, tiebreakers } = flags.prioritiesRanked;
  if (primary.length > 0) {
    let line = `Top priorities — these drive which stops are chosen, not just the notes: ${primary.join(", ")}.`;
    if (tiebreakers.length > 0) {
      line += ` Secondary interests, for tie-breaks only: ${tiebreakers.join(", ")}.`;
    }
    lines.push(line);
  }

  return `\nTraveler profile:\n${lines.map((line) => `- ${line}`).join("\n")}\n`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/lib/travelerProfilePrompt.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit -p tsconfig.json`
Expected: 23 tests pass; no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/travelerProfilePrompt.ts src/lib/travelerProfilePrompt.test.mjs
git commit -m "Add formatTravelerProfile, the traveler's answers as prompt lines

Own module rather than a sibling of the other format* helpers in
itineraryPrompt.ts, because that file imports TIERS as a value and so
cannot be loaded from a .test.mjs. This block decides whether six screens
of questions had any effect, so it gets to be tested.

Returns an empty string for null flags, which is what keeps callers that
send no userAnswers producing a byte-identical prompt.

Interests are not repeated here -- formatPreferences already owns the tag
list and its per-tag guidance. This adds only the starred ranking."
```

---

### Task 3: Accept the block in the three prompt builders

**Files:**
- Modify: `src/lib/itineraryPrompt.ts` — imports, `buildGeneratePrompt`, `buildRefinePrompt`, `buildCritiquePrompt`

**Interfaces:**
- Consumes: `formatTravelerProfile` from Task 2.
- Produces: an optional `resolvedFlags?: ResolvedFlags | null` parameter on `buildGeneratePrompt`, `buildRefinePrompt`, and `buildCritiquePrompt`. Task 4 passes it.

- [ ] **Step 1: Add the imports**

At the top of `src/lib/itineraryPrompt.ts`, add `ResolvedFlags` to the existing `./types` import and import the formatter:

```ts
import { DayWeather } from "./weather";
import { DestinationContext, Itinerary, ItineraryPreferences, ResolvedFlags } from "./types";
import { TierId, TIERS } from "./tiers";
import { formatTravelerProfile } from "./travelerProfilePrompt";
```

- [ ] **Step 2: Thread it through `buildGeneratePrompt`**

Add to the params type:

```ts
  resolvedFlags?: ResolvedFlags | null;
```

Then in the template literal, insert the block between the preferences and the destination context. The line currently reads:

```
${formatPreferences(params.preferences)}${formatContextBlock(params.contextInsight)}
```

Change it to:

```
${formatPreferences(params.preferences)}${formatTravelerProfile(params.resolvedFlags ?? null)}${formatContextBlock(params.contextInsight)}
```

- [ ] **Step 3: Thread it through `buildRefinePrompt`**

Add the same `resolvedFlags?: ResolvedFlags | null;` to its params type. In its template, the line currently reads:

```
${formatContextBlock(params.contextInsight)}
```

Change it to:

```
${formatTravelerProfile(params.resolvedFlags ?? null)}${formatContextBlock(params.contextInsight)}
```

Without this, refining a trip silently discards the profile that generated it and the plan drifts back toward a generic itinerary on the first edit.

- [ ] **Step 4: Add pace and mobility to the critique criteria**

Add `resolvedFlags?: ResolvedFlags | null;` to `buildCritiquePrompt`'s params. Insert the block after the existing `interestLine` interpolation, and extend the review list with a fifth criterion:

```ts
  return `Here is a generated trip itinerary with a total budget of $${params.budget}:

${JSON.stringify(params.itinerary)}
${formatContextBlock(params.contextInsight)}${interestLine}${formatTravelerProfile(params.resolvedFlags ?? null)}
Review it for: (1) total cost (lodging + stops) landing within 85-100% of the budget, (2) stop times being sequential, non-overlapping, and realistically spaced (no implausibly tight back-to-back stops), (3) reasonable use of the destination context above, if any was given, (4) whether the itinerary genuinely reflects the traveler's stated interests above, if any were given — not just generic sightseeing, (5) whether each day respects the traveler profile above, if one was given — the stops-per-day target and any mobility or family constraints.
```

Leave the rest of that function's template exactly as it is.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: no errors. Every new parameter is optional, so no existing call site breaks.

- [ ] **Step 6: Commit**

```bash
git add src/lib/itineraryPrompt.ts
git commit -m "Accept a traveler-profile block in the three prompt builders

Generate, refine and critique all take an optional resolvedFlags. Refine
needs it as much as generate: without it, editing a trip silently drops
the profile that produced it and the plan drifts back toward a generic
itinerary on the first change.

Critique gains a fifth review criterion for the stops-per-day target and
any mobility or family constraints -- it is the pass that already catches
budget and timing violations, and a stated pace is the same kind of
checkable constraint.

Every parameter is optional, so no existing call site changes."
```

---

### Task 4: Read `userAnswers` in the route — the defect fix lands here

**Files:**
- Modify: `src/app/api/itinerary/route.ts`
- Modify: `src/app/page.tsx` — the `refine()` body only

**Interfaces:**
- Consumes: `deriveFlags` (Task 1), the builders' `resolvedFlags` parameter (Task 3).
- Produces: no new exports. This is the wiring that makes Tasks 1–3 observable.

- [ ] **Step 1: Import `deriveFlags` and the type**

In `src/app/api/itinerary/route.ts`, add to the existing imports:

```ts
import { deriveFlags } from "@/lib/userAnswers";
import { CritiqueResult, DayPlan, Itinerary, ResolvedFlags, UserAnswers } from "@/lib/types";
```

(`CritiqueResult`, `DayPlan` and `Itinerary` are already imported from that path — add `ResolvedFlags` and `UserAnswers` to the same statement.)

- [ ] **Step 2: Destructure `userAnswers` and derive the flags**

Add `userAnswers` to the existing destructuring of `body` (the block starting `const { destination,`). Then, immediately after the `const isRefine = ...` line, add:

```ts
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
```

- [ ] **Step 3: Pass the flags to all three builders**

In the same file, add `resolvedFlags,` to the object literal passed to `buildRefinePrompt(...)`, to `buildGeneratePrompt(...)`, and to `buildCritiquePrompt(...)`.

- [ ] **Step 4: Send `userAnswers` on the refine request**

In `src/app/page.tsx`, the `refine()` function posts to `/api/itinerary` without the answers. Add the field to its `JSON.stringify` body, after `feedback`:

```ts
          previousItinerary: itinerary,
          feedback,
          userAnswers: currentAnswers(),
```

- [ ] **Step 5: Typecheck, lint, and run the suite**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint && npm test`
Expected: no errors; 23 tests pass.

- [ ] **Step 6: Verify against a running server — the part that actually proves it**

Start the dev server in one terminal:

```bash
npm run dev
```

In another, send a generate with a constrained traveler:

```bash
curl -s -X POST http://localhost:3000/api/itinerary \
  -H 'Content-Type: application/json' \
  -d '{"destination":"Kyoto, Japan","startDate":"2026-09-19","endDate":"2026-09-21","budget":1200,"tier":"midrange","preferences":{"tags":["Food"],"vibe":null},"userAnswers":{"purpose":"leisure","explorerStyle":"relaxed","group":"family_with_kids","energy":"low","crowds":"avoid","budget":1200,"priorities":["Food","Shopping"],"topPriorities":["Food"],"selectedPois":[],"customPois":[]}}' \
  | head -c 400
```

Then open the LLM trace FAB in the browser (bottom-right) and read the prompt on the newest `generate` trace. Confirm it contains a `Traveler profile:` block with `about 2 stops per day`, the mobility line, and the kid-friendly line.

- [ ] **Step 7: Verify the no-answers path is untouched**

```bash
curl -s -X POST http://localhost:3000/api/itinerary \
  -H 'Content-Type: application/json' \
  -d '{"destination":"Kyoto, Japan","startDate":"2026-09-19","endDate":"2026-09-21","budget":1200,"tier":"midrange","preferences":{"tags":["Food"],"vibe":null}}' \
  | head -c 200
```

Expected: a normal itinerary response, and the newest `generate` trace's prompt contains **no** `Traveler profile:` block. This is what confirms `PipelineConsole` and any other existing caller still behave exactly as before.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/itinerary/route.ts src/app/page.tsx
git commit -m "Read userAnswers in the itinerary route

The wizard has always sent them and the route never destructured them, so
the app asked how much walking suits you and then planned the trip without
it. deriveFlags already turned those answers into pace, mobility, crowd
bias, ranked priorities and family rules; the result was computed and
dropped.

Refine now sends the answers too, so editing a trip cannot silently strip
the profile that generated it.

Malformed answers are treated as absent rather than fatal, and a request
without them produces a byte-identical prompt to before."
```

---

### Task 5: The profile shape and its validation

Split from persistence deliberately. `parseProfile` is the only branching logic in this half of the feature, and a module that imports `db` (a value import) cannot be loaded by a `.test.mjs`. Keeping the type and its validator free of value imports is what makes them testable; the read/write pair lives in `db.ts`, which already owns every other row helper.

**Files:**
- Create: `src/lib/travelerProfile.ts`
- Test: `src/lib/travelerProfile.test.mjs` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `LOCAL_OWNER: string` (`"local"`)
  - `TravelerProfile` interface with fields `group`, `explorerStyle`, `energy`, `crowds`, `tier`, `priorities`, `topPriorities`
  - `parseProfile(value: unknown): TravelerProfile | null`
  - Task 5b and Task 6 import these.

- [ ] **Step 1: Write the failing test**

Create `src/lib/travelerProfile.test.mjs`:

```js
/* Run: node --test src/lib/travelerProfile.test.mjs
 *
 * parseProfile is the trust boundary for this feature. A bad enum stored here
 * propagates silently into every future trip's prompt, so it is refused on the
 * way in — and these asserts are what fail if that guard is loosened. */
import assert from "node:assert/strict";
import test from "node:test";
import { parseProfile } from "./travelerProfile.ts";

const valid = {
  group: "family_with_kids",
  explorerStyle: "relaxed",
  energy: "low",
  crowds: "avoid",
  tier: "budget",
  priorities: ["Food", "Shopping"],
  topPriorities: ["Food"],
};

test("accepts a fully valid profile", () => {
  assert.deepEqual(parseProfile(valid), valid);
});

test("rejects a non-object", () => {
  for (const bad of [null, undefined, "profile", 42, []]) {
    assert.equal(parseProfile(bad), null);
  }
});

test("rejects an unknown value in any enum field", () => {
  assert.equal(parseProfile({ ...valid, group: "aliens" }), null);
  assert.equal(parseProfile({ ...valid, explorerStyle: "frantic" }), null);
  assert.equal(parseProfile({ ...valid, energy: "boundless" }), null);
  assert.equal(parseProfile({ ...valid, crowds: "tolerate" }), null);
  assert.equal(parseProfile({ ...valid, tier: "platinum" }), null);
});

test("rejects priorities that are not arrays of strings", () => {
  assert.equal(parseProfile({ ...valid, priorities: "Food" }), null);
  assert.equal(parseProfile({ ...valid, priorities: [1, 2] }), null);
  assert.equal(parseProfile({ ...valid, topPriorities: null }), null);
});

test("drops unknown fields rather than storing them", () => {
  const parsed = parseProfile({ ...valid, homeCity: "Boston", ssn: "oops" });
  assert.deepEqual(Object.keys(parsed).sort(), Object.keys(valid).sort());
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/lib/travelerProfile.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` — `./travelerProfile.ts` does not exist yet.

- [ ] **Step 3: Write the module**

Create `src/lib/travelerProfile.ts`. **Every import must be `import type`** — a value import makes this untestable, which is the whole reason it is a separate module from the persistence half:

```ts
import type { CrowdPreference, EnergyLevel, ExplorerStyle, GroupType } from "./types";
import type { TierId } from "./tiers";

/** The single implicit local user. Replaced by a real auth subject id if and when
 *  authentication lands — see FUTURE-INTEGRATION.md. */
export const LOCAL_OWNER = "local";

/**
 * What stays true between trips. Purpose, dates, budget amount and POIs are
 * deliberately absent: a business trip and an anniversary are the same person,
 * and the budget is a function of the trip, not of the traveler. `tier` is kept
 * because the spending *style* is a preference even though the amount is not.
 */
export interface TravelerProfile {
  group: GroupType;
  explorerStyle: ExplorerStyle;
  energy: EnergyLevel;
  crowds: CrowdPreference;
  tier: TierId;
  priorities: string[];
  topPriorities: string[];
}

const GROUPS: GroupType[] = ["solo", "couple", "family_with_kids"];
const STYLES: ExplorerStyle[] = ["packed", "relaxed", "offbeat", "mixed"];
const ENERGIES: EnergyLevel[] = ["high", "moderate", "low"];
const CROWDS: CrowdPreference[] = ["love", "mixed", "avoid"];
const TIER_IDS: TierId[] = ["budget", "midrange", "luxury"];

/**
 * The trust boundary. Rejects anything that isn't a known enum value and returns
 * only known fields, so a bad value can never reach storage — from there it would
 * propagate silently into every future trip's prompt, which is far harder to
 * notice than a 400 at the point of writing it.
 */
export function parseProfile(value: unknown): TravelerProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;

  const stringList = (x: unknown): string[] | null =>
    Array.isArray(x) && x.every((s) => typeof s === "string") ? (x as string[]) : null;

  const priorities = stringList(v.priorities);
  const topPriorities = stringList(v.topPriorities);
  if (
    !GROUPS.includes(v.group as GroupType) ||
    !STYLES.includes(v.explorerStyle as ExplorerStyle) ||
    !ENERGIES.includes(v.energy as EnergyLevel) ||
    !CROWDS.includes(v.crowds as CrowdPreference) ||
    !TIER_IDS.includes(v.tier as TierId) ||
    priorities === null ||
    topPriorities === null
  ) {
    return null;
  }

  return {
    group: v.group as GroupType,
    explorerStyle: v.explorerStyle as ExplorerStyle,
    energy: v.energy as EnergyLevel,
    crowds: v.crowds as CrowdPreference,
    tier: v.tier as TierId,
    priorities,
    topPriorities,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/lib/travelerProfile.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test && npx tsc --noEmit -p tsconfig.json`
Expected: 28 tests pass; no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/travelerProfile.ts src/lib/travelerProfile.test.mjs
git commit -m "Add the traveler profile shape and its validation

Stores only what stays true between trips: group, explorer style, energy,
crowds, tier and priorities. Purpose, dates, budget amount and POIs stay
per-trip -- a business trip and an anniversary are the same person.

parseProfile is the trust boundary and refuses unknown enum values on the
way in, because a bad value reaching storage propagates silently into
every future trip's prompt.

Separate from the persistence half so every import here can be import
type, which is what makes it loadable from a .test.mjs."
```

---

### Task 5b: Persist it

**Files:**
- Modify: `src/lib/db.ts` — the table, its row helpers, and the read/write pair

**Interfaces:**
- Consumes: `LOCAL_OWNER`, `TravelerProfile`, `parseProfile` from Task 5.
- Produces:
  - `readProfile(ownerId?: string): TravelerProfile | null`
  - `writeProfile(profile: TravelerProfile, ownerId?: string): void`
  - Task 6 imports both.

- [ ] **Step 1: Create the table**

In `src/lib/db.ts`, after the `trip_artifacts` block and before the `addColumnIfMissing` helper, add:

```ts
// `owner_id` is deliberate insurance, not speculation. Swapping an LLM vendor
// later is one file's internals; retrofitting ownership onto rows that already
// exist is a data migration plus every query that reads them. It is written from
// the LOCAL_OWNER constant rather than a column DEFAULT, since a primary key that
// is always supplied explicitly would never fire the default — the column is the
// insurance, not the default. See FUTURE-INTEGRATION.md.
db.exec(`
  CREATE TABLE IF NOT EXISTS traveler_profile (
    owner_id TEXT PRIMARY KEY,
    profile_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);
```

- [ ] **Step 2: Add the row helpers**

Further down `src/lib/db.ts`, alongside the other row helpers, add:

```ts
export interface TravelerProfileRow {
  owner_id: string;
  profile_json: string;
  updated_at: string;
}

export function getTravelerProfile(ownerId: string): TravelerProfileRow | undefined {
  return db.prepare(`SELECT * FROM traveler_profile WHERE owner_id = ?`).get(ownerId) as
    | TravelerProfileRow
    | undefined;
}

export function upsertTravelerProfile(ownerId: string, profileJson: string): void {
  db.prepare(
    `INSERT OR REPLACE INTO traveler_profile (owner_id, profile_json, updated_at)
     VALUES (@owner_id, @profile_json, @updated_at)`
  ).run({
    owner_id: ownerId,
    profile_json: profileJson,
    updated_at: new Date().toISOString(),
  });
}
```

- [ ] **Step 3: Add the read/write pair**

Immediately after the row helpers from Step 2, in `src/lib/db.ts`, add:

```ts
/**
 * Returns null for "no row" and for "row failed to parse" alike. The house rule
 * elsewhere is that null and empty must stay distinguishable, but here the
 * caller's response is identical either way — fall back to the wizard's built-in
 * defaults — so the distinction would carry no consequence. Deliberate departure
 * from the convention, not an oversight.
 */
export function readProfile(ownerId: string = LOCAL_OWNER): TravelerProfile | null {
  const row = getTravelerProfile(ownerId);
  if (!row) return null;
  try {
    return parseProfile(JSON.parse(row.profile_json));
  } catch {
    return null;
  }
}

export function writeProfile(profile: TravelerProfile, ownerId: string = LOCAL_OWNER): void {
  upsertTravelerProfile(ownerId, JSON.stringify(profile));
}
```

Add the import at the top of `src/lib/db.ts`:

```ts
import { LOCAL_OWNER, parseProfile, type TravelerProfile } from "./travelerProfile";
```

`travelerProfile.ts` imports nothing from `db.ts`, so this does not create a cycle.

- [ ] **Step 4: Typecheck, lint, and run the suite**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint && npm test`
Expected: no errors; 28 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.ts
git commit -m "Persist the traveler profile

owner_id is written from the LOCAL_OWNER constant rather than a column
default, because a primary key that is always supplied explicitly would
never fire one. The column is the insurance: retrofitting ownership later
is a data migration across every query, whereas swapping an LLM vendor is
one file's internals.

readProfile returns null for a missing row and an unparseable one alike.
The caller falls back to the wizard's defaults either way, so the
distinction the fail-soft convention normally demands would carry no
consequence here."
```

---

### Task 6: `GET` and `PUT /api/profile`

**Files:**
- Create: `src/app/api/profile/route.ts`

**Interfaces:**
- Consumes: `parseProfile` from Task 5; `readProfile` and `writeProfile` from Task 5b.
- Produces: `GET /api/profile` → `{ profile: TravelerProfile | null }`; `PUT /api/profile` → `{ ok: true }` or `{ error }` with status 400. Task 7 calls both.

- [ ] **Step 1: Write the route**

Create `src/app/api/profile/route.ts`, following the shape of `src/app/api/trips/route.ts`. Note the two import sources: validation lives with the shape, persistence lives in `db.ts` with every other row helper.

```ts
import { NextRequest, NextResponse } from "next/server";
import { readProfile, writeProfile } from "@/lib/db";
import { parseProfile } from "@/lib/travelerProfile";

export async function GET() {
  return NextResponse.json({ profile: readProfile() });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const profile = parseProfile(body?.profile);
  if (!profile) {
    // A contract failure, not something a traveller can act on: the wizard only
    // ever sends values it rendered as choices.
    return NextResponse.json({ error: "The profile sent wasn't a valid shape." }, { status: 400 });
  }
  writeProfile(profile);
  return NextResponse.json({ ok: true });
}
```

The profile's fields are already `camelCase` in both the row JSON and the API, so there is no `snake_case` mapping to do here — only `owner_id` is `snake_case` and it never crosses the API boundary.

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: no errors.

- [ ] **Step 3: Verify against a running server**

With `npm run dev` running:

```bash
curl -s http://localhost:3000/api/profile
```

Expected: `{"profile":null}` on a fresh database.

```bash
curl -s -X PUT http://localhost:3000/api/profile \
  -H 'Content-Type: application/json' \
  -d '{"profile":{"group":"family_with_kids","explorerStyle":"relaxed","energy":"low","crowds":"avoid","tier":"budget","priorities":["Food","Shopping"],"topPriorities":["Food"]}}'
```

Expected: `{"ok":true}`. Then `curl -s http://localhost:3000/api/profile` returns that profile.

- [ ] **Step 4: Verify validation rejects a bad value**

```bash
curl -s -i -X PUT http://localhost:3000/api/profile \
  -H 'Content-Type: application/json' \
  -d '{"profile":{"group":"aliens","explorerStyle":"relaxed","energy":"low","crowds":"avoid","tier":"budget","priorities":[],"topPriorities":[]}}' | head -1
```

Expected: `HTTP/1.1 400 Bad Request`, and a follow-up `GET` still returns the previously stored profile, unmodified.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/profile/route.ts
git commit -m "Add GET and PUT /api/profile

Thin, matching the shape of the trips route. Every profile field is
already camelCase on both sides, so only owner_id is snake_case and it
never crosses the API boundary.

PUT refuses an unknown enum value with a 400 rather than storing it."
```

---

### Task 7: Seed the wizard from the profile, and write it back

**Files:**
- Modify: `src/app/page.tsx` — imports, a new effect near the state declarations at `:166-193`, and the `generate()` success path

**Interfaces:**
- Consumes: `GET`/`PUT /api/profile` from Task 6.
- Produces: no new exports.

- [ ] **Step 1: Import the type**

Add to the existing imports in `src/app/page.tsx`:

```ts
import type { TravelerProfile } from "@/lib/travelerProfile";
```

- [ ] **Step 2: Seed the durable state on mount**

After the Step 2b state declarations (the block ending with `const [customPois, setCustomPois] = useState<string[]>([]);` around line 187), add:

```ts
  // The profile supplies defaults; the wizard always wins. Nothing here is locked —
  // a solo traveler who usually goes with kids just changes it on the screen, and
  // that trip's answers are what generation sees. Any failure leaves the hardcoded
  // defaults above in place, which is the same experience as a first visit.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/profile")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const profile: TravelerProfile | null = data?.profile ?? null;
        if (cancelled || !profile) return;
        setGroup(profile.group);
        setExplorerStyle(profile.explorerStyle);
        setEnergy(profile.energy);
        setCrowds(profile.crowds);
        setTier(profile.tier);
        setInterests(profile.priorities);
        setStarredInterests(profile.topPriorities);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
```

- [ ] **Step 3: Write the profile back after a successful generate**

In `generate()`, immediately after `setStep("result");` and before the `} catch (e) {`, add:

```ts
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
```

- [ ] **Step 4: Confirm `useEffect` is imported**

`src/app/page.tsx` already imports React hooks. Check the top-of-file import includes `useEffect`; add it to the existing `from "react"` statement if not.

- [ ] **Step 5: Typecheck, lint, and run the suite**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint && npm test`
Expected: no errors; 28 tests pass.

- [ ] **Step 6: Verify the round trip in the browser**

With `npm run dev` running, open `http://localhost:3000`:

1. Walk the wizard: choose **family with kids**, **relaxed**, **low energy**, **avoid crowds**, **budget** tier, star **Food**. Generate a trip and let it finish.
2. Reload the page and start a new plan.
3. Confirm the group, explorer style, energy, crowds, tier and starred interest screens all open on the choices from step 1 rather than the defaults (`solo`, `mixed`, `moderate`, `mixed`, `midrange`, nothing starred).
4. Change energy to **high** on this second run and generate. Reload again and confirm the energy screen now opens on **high** — the wizard's answer overwrote the profile, not the other way round.

- [ ] **Step 7: Verify a failing profile endpoint doesn't break the wizard**

Stop the dev server, delete `tripmate.db`, restart, and load the page. The wizard must render with its hardcoded defaults and generate normally. This is the first-visit path and the degraded path at once.

- [ ] **Step 8: Commit**

```bash
git add src/app/page.tsx
git commit -m "Seed the wizard from the saved profile and write it back

The profile supplies defaults and the wizard always wins -- nothing is
locked, so a solo traveler who usually goes with kids just changes it on
the screen and that trip's answers are what generation sees.

Written back only after a successful generate: a wizard abandoned halfway
is not a statement about how someone travels. Both the read and the write
swallow failures, because neither is worth an error on a trip the traveler
just waited two minutes for."
```

---

### Task 8: Update the tracker docs

**Files:**
- Modify: `docs/backend.md`, `docs/llm.md`, `docs/frontend.md`, `docs/project-crux.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Read the conventions**

Read `docs/project-crux.md`'s "How to maintain the tracker docs" section. New feature means a new row with a `Since` date and a `Developer`; tweaks edit rows in place. Contributors log under their own name — these rows are **Zaid**.

- [ ] **Step 2: Add the rows**

All three trackers share the columns `| Feature | Status | Since | Developer | Notes |`. Append to each Features table:

`docs/backend.md`:

```md
| `traveler_profile` table + `GET/PUT /api/profile` | Active | 2026-08-16 | Zaid | Durable answers only (group, style, energy, crowds, tier, priorities). `owner_id` carried from the first row so auth can be added without a data migration — see `FUTURE-INTEGRATION.md`. `PUT` refuses unknown enum values rather than storing them |
```

`docs/llm.md`:

```md
| `formatTravelerProfile()` | Active | 2026-08-16 | Zaid | Feeds pace, mobility, crowd bias, family rules and starred priorities into generate/refine/critique. `deriveFlags` computed all of this already; the route never read `userAnswers`, so it was discarded. Own module because `itineraryPrompt.ts` imports `TIERS` as a value and so can't be loaded from a `.test.mjs` |
```

`docs/frontend.md`:

```md
| Wizard seeds from the saved traveler profile | Active | 2026-08-16 | Zaid | Durable answers pre-fill on mount and are written back after a successful generate. Defaults only — the wizard always wins, and any failure falls back to the hardcoded defaults |
```

- [ ] **Step 3: Add the timeline row**

Add one row to the timeline table in `docs/project-crux.md`:

| Date | Area | Developer | What happened |
|---|---|---|---|
| 2026-08-16 | Frontend, Backend, LLM | Zaid | Traveler profile: the plan wizard's answers now reach the model — the route read no `userAnswers`, so `deriveFlags`' pace/mobility/crowd/family constraints were computed and discarded. Added `formatTravelerProfile` (own module, so it is testable) feeding generate/refine/critique, plus a `traveler_profile` table carrying `owner_id` from the first row so authentication can be added later without a migration. Durable answers seed the wizard on a later visit; per-trip answers are still asked fresh |

- [ ] **Step 4: Commit**

```bash
git add docs/backend.md docs/llm.md docs/frontend.md docs/project-crux.md
git commit -m "Log the traveler profile in the tracker docs"
```

---

## Already done, do not redo

The spec's "Documentation to update" section lists a `CLAUDE.md` correction. It
landed before this plan was written, in commit `5d98cce`, together with a fix for
`npm test` silently running zero tests — the glob was single-quoted, which reaches
Node literally on Windows. That commit also records the `import type` constraint
this plan depends on. Nothing further is needed there.

## Done criteria

- [ ] `npm test` passes with 28 tests.
- [ ] `npx tsc --noEmit -p tsconfig.json` is clean.
- [ ] `npm run lint` is clean.
- [ ] A generate with `userAnswers` puts a `Traveler profile:` block in the prompt, confirmed by reading the trace in the FAB — not inferred from the code.
- [ ] A generate without `userAnswers` produces a prompt with no such block.
- [ ] The wizard opens on previously chosen answers after a reload, and a changed answer overwrites them.
- [ ] Deleting `tripmate.db` leaves the wizard working on its hardcoded defaults.
