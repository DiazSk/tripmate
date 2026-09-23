# Itinerary Constraint System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the itinerary planner's constraints explicitly hierarchical and mechanically checked, and measure the change against the version it replaces.

**Architecture:** Eleven prompt rules land across the five files that state planning rules (the skill plus four prompt builders). Four new deterministic checks join `guardrails.ts` as optional rules and feed the critique pass through the `travelFindings` channel that already carries findings as fact. Three new traveller inputs flow from both wizards into `UserAnswers`. A new `scripts/skill-ab.mjs` captures a baseline arm **before any of that**, a candidate arm after, and re-scores both with one copy of the scorer code plus a blinded judge.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, React Native (Expo Router) for `mobile/`, `node --test` with `scripts/ts-resolve.mjs`, libsql/SQLite.

**Spec:** `docs/superpowers/specs/2026-09-23-itinerary-constraint-system-design.md`

## Global Constraints

- **Git commit messages carry NO signature or trailer of any kind.** No `Co-Authored-By`, no "Generated with Claude Code". This is `CLAUDE.md`'s rule for this repo and it overrides the harness's default template. Write the message and stop.
- **Node ≥ 22.** Run `nvm use` if the shell drifts.
- **Working directory is the worktree:** `/Users/zaidshaikh/GitHub/tripmate/.worktrees/react-native-app`, branch `react-native-app`. Do not `cd` to the main checkout.
- **Task 1 must complete, and `baseline.json` must exist on disk, before Task 2 changes a single prompt byte.** The A/B has no baseline arm otherwise, and it cannot be reconstructed afterwards.
- **Run the full verification set before each commit:** `npm test`, `npx tsc --noEmit -p tsconfig.json`, `npm run lint`. A passing suite proves less here than in a normally covered repo — prompt text is covered by nothing.
- **Tests are `node --test`, no framework.** A `.test.mjs` importing a `.ts` module must write the explicit `.ts` extension (`import { x } from "./foo.ts"`). Modules *under* test may import extensionlessly; the resolve hook handles that.
- **`AGENTS.md` is rewritten by `next dev`.** If it appears modified, commit it with the work rather than reverting it.
- **DB rows are `snake_case`, API and type surfaces are `camelCase`**, mapped by hand per route.
- **Fail-soft is the house convention.** A client returns `null` for "the fetch failed" and `[]`/`{}` for "fetched fine, nothing found". New optional fields are absent-means-not-asked, never absent-means-no.
- **`src/lib/llmConfig.ts` is the only place model names belong.** Do not hardcode one at a call site.

---

## File Structure

**Created:**
- `scripts/skill-ab.mjs` — the A/B harness: `--arm <out.json>` runs one arm and stores raw output; `--compare a.json b.json` re-scores both and judges them.
- `src/lib/bench/scorers/commitments.ts` — the four new unweighted scorers.
- `src/lib/bench/scorers/commitments.test.mjs` — their tests.

**Modified:**
- `.claude/skills/itinerary-planner/SKILL.md` — new §0, §14e, §15; rewritten §5, §4c-bis, §9, §10, §12, §13, §14c.
- `src/lib/lodgingPrompt.ts:34-36` — `budgetInstruction()` rewritten.
- `src/lib/travelerProfilePrompt.ts:102-130` — `formatTravelLegs()` buffer wording; new `formatRequirements()`.
- `src/lib/itineraryPrompt.ts` — precedence header; critique checklist at `:351`.
- `src/lib/editPrompt.ts` — minimal-change rule appended to `CHAT_CAPABILITIES`.
- `src/lib/guardrails.ts` — four new rules behind optional options.
- `src/lib/generationRunner.ts:565-575` — pass the new options, append their messages.
- `src/lib/types.ts:217-249` — three new `UserAnswers` fields.
- `src/lib/userAnswers.ts:120-130` — sanitize them.
- `src/lib/tripContext.ts:94-105, 292-352` — new context section.
- `src/app/HomeView.tsx:1047-1072` + JSX near `:2293` — web wizard fields.
- `mobile/src/lib/planDraft.tsx`, `mobile/src/app/plan/preferences.tsx` — mobile wizard fields.
- `src/lib/bench/fixtures.ts` — one new fixture.
- `src/lib/bench/scorers/domain.ts:662-691` — buffer constants split.
- `src/lib/bench/scorers/context.ts:218-226` — `scoreAgainstBand` becomes a ceiling.
- `src/lib/bench/types.ts`, `src/lib/bench/runBenchmark.ts:83-107` — wire the new scorers in.
- `docs/itinerary-quality.md`, `docs/llm.md` — results and tracker rows.

---

## Task 1: The A/B harness and the baseline arm

**This task must finish, with `baseline.json` committed to `/tmp`-adjacent scratch AND its path recorded, before any other task begins.**

**Files:**
- Create: `scripts/skill-ab.mjs`

**Interfaces:**
- Produces: a JSON file of shape `{ arm: string, path: "staged"|"legacy", cells: [{ fixtureId, itineraryMd, runId, wallMs, costUsd }] }`. Task 17 reads this shape in `--compare`.
- Consumes: `getFixture` from `src/lib/bench/fixtures.ts`, `generateItinerary` from `src/lib/generateItinerary.ts`, `getRunSteps` from `src/lib/db.ts`, `benchUserAnswers` and `closestTier` for the legacy path (same imports `scripts/critique-ab.mjs` already uses).

- [ ] **Step 1: Read the existing A/B script end to end**

Run: `cat scripts/critique-ab.mjs`

It is the pattern this follows: the same `--compare` argv shape, the same reason for going over HTTP on the legacy path (`generationRunner.ts` pulls `CritiqueResult` into a value import block, so the module cannot be instantiated from `.mjs`), and the same n-caveat printed at the end.

- [ ] **Step 2: Write the script**

```javascript
/**
 * Does the rewritten constraint system produce better plans than the one it replaced?
 *
 * **Why the baseline arm runs first, before any prompt edit.** Both arms store only raw output.
 * Scoring happens at `--compare` time, with whatever scorer code exists then — so a scorer written
 * during the change grades both arms identically, and there is no "old prompt" code path kept
 * alive to rot. Arm A is genuinely the old prompts because it ran before they changed.
 *
 * **Two paths, and they answer different questions.** The default drives `generateItinerary()` —
 * the staged pipeline, one LLM call, SKILL.md plus trip-context plus the fixed ask, no critique.
 * Every delta there is attributable to prompt text. `AB_PATH=legacy` drives POST /api/itinerary,
 * which is what travellers actually see; it includes critique, so it is noisier and is run on one
 * fixture as a direction check rather than a second measurement.
 *
 * Going over HTTP for the legacy arm is structural, not stylistic: `generationRunner.ts` pulls
 * `CritiqueResult` into a *value* import block, so Node throws at instantiation and the module is
 * unreachable from a `.mjs` script. `scripts/critique-ab.mjs` and `scripts/perf-bench.mjs` both
 * route around it the same way.
 *
 *   # baseline, BEFORE any prompt change:
 *   node --import ./scripts/ts-resolve.mjs scripts/skill-ab.mjs --arm baseline.json
 *
 *   # candidate, after:
 *   node --import ./scripts/ts-resolve.mjs scripts/skill-ab.mjs --arm candidate.json
 *
 *   # legacy sanity check (needs `npm run dev` running):
 *   AB_PATH=legacy AB_FIXTURES=kyoto-couple-mixed \
 *     node --import ./scripts/ts-resolve.mjs scripts/skill-ab.mjs --arm legacy-a.json
 */
import { writeFileSync } from "fs";

import { BENCH_FIXTURES, getFixture } from "../src/lib/bench/fixtures.ts";
import { benchUserAnswers } from "../src/lib/bench/refineTasks.ts";
import { generateItinerary } from "../src/lib/generateItinerary.ts";
import { getRunSteps } from "../src/lib/db.ts";
import { closestTier } from "../src/lib/tiers.ts";

const BASE = process.env.AB_BASE_URL ?? "http://localhost:3000";
const PATH_KIND = process.env.AB_PATH ?? "staged";

/** Every built-in by default. The seven frozen fixtures are what the composite in
 *  docs/itinerary-quality.md is scored against, so an arm over a different set is not comparable. */
function selectedFixtures() {
  const ids = process.env.AB_FIXTURES?.split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids || ids.length === 0) return BENCH_FIXTURES;
  return ids.map((id) => {
    const f = getFixture(id);
    if (!f) throw new Error(`no fixture ${id}`);
    return f;
  });
}

async function runStaged(fixture) {
  const startedAt = Date.now();
  const generated = await generateItinerary({
    reconciled: fixture.reconciled,
    poiDetails: fixture.poiDetails,
    destination: fixture.reconciled.rawFetch.destination.region ?? fixture.title,
  });
  const steps = getRunSteps(generated.runId);
  return {
    fixtureId: fixture.id,
    itineraryMd: generated.itineraryMd,
    itineraryJson: null,
    runId: generated.runId,
    wallMs: Date.now() - startedAt,
    costUsd: steps.reduce((n, s) => n + (s.cost_usd ?? 0), 0),
  };
}

async function runLegacy(fixture) {
  const answers = benchUserAnswers(fixture);
  const days = fixture.reconciled.rawFetch.dateContext.days;
  const startDate = days[0].date;
  const endDate = days[days.length - 1].date;
  const startedAt = Date.now();
  const res = await fetch(`${BASE}/api/itinerary`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      destination: fixture.reconciled.rawFetch.destination.region ?? fixture.title,
      startDate,
      endDate,
      budget: answers.budget,
      tier: closestTier(answers.budget, days.length),
      userAnswers: answers,
      preferences: { tags: answers.priorities ?? [] },
    }),
  });
  const wallMs = Date.now() - startedAt;
  const payload = await res.json();
  if (!res.ok || !payload.itinerary) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(payload).slice(0, 300)}`);
  }
  const steps = getRunSteps(payload.runId);
  return {
    fixtureId: fixture.id,
    // The legacy route returns JSON, not markdown. `--compare` branches on which one is present.
    itineraryMd: null,
    itineraryJson: payload.itinerary,
    runId: payload.runId,
    wallMs,
    costUsd: steps.reduce((n, s) => n + (s.cost_usd ?? 0), 0),
  };
}

const mode = process.argv[2];
if (mode !== "--arm") {
  console.error("usage: skill-ab.mjs --arm <out.json>");
  process.exit(1);
}
const out = process.argv[3];
if (!out) {
  console.error("usage: skill-ab.mjs --arm <out.json>");
  process.exit(1);
}

const fixtures = selectedFixtures();
console.log(`path      ${PATH_KIND}`);
console.log(`fixtures  ${fixtures.map((f) => f.id).join(", ")}`);

const cells = [];
for (const fixture of fixtures) {
  process.stdout.write(`  ${fixture.id} … `);
  try {
    const cell = PATH_KIND === "legacy" ? await runLegacy(fixture) : await runStaged(fixture);
    cells.push(cell);
    console.log(`${(cell.wallMs / 1000).toFixed(1)}s  $${cell.costUsd.toFixed(6)}`);
  } catch (err) {
    // One fixture failing must not lose the arms that already ran — 90s each is too expensive
    // to throw away over an unrelated timeout.
    console.log(`FAILED: ${err.message}`);
    cells.push({ fixtureId: fixture.id, itineraryMd: null, itineraryJson: null, runId: null, wallMs: 0, costUsd: 0, error: String(err.message) });
  }
}

writeFileSync(out, JSON.stringify({ arm: out, path: PATH_KIND, cells }, null, 2));
console.log(`\nwrote ${out} — ${cells.filter((c) => !c.error).length}/${cells.length} cells`);
```

- [ ] **Step 3: Verify it typechecks and lints**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: both pass. (`scripts/` is `.mjs`, so `tsc` does not read it; this is checking nothing was broken by the imports.)

- [ ] **Step 4: Smoke-test on one fixture**

Run: `node --import ./scripts/ts-resolve.mjs scripts/skill-ab.mjs --arm /tmp/smoke.json`
with `AB_FIXTURES=kyoto-couple-mixed` set.

Expected: one cell, non-empty `itineraryMd`, roughly 60-120s. If it fails on a `libsql` or import error, fix that now — every later task depends on this script running.

- [ ] **Step 5: Capture the real baseline**

Run: `node --import ./scripts/ts-resolve.mjs scripts/skill-ab.mjs --arm docs/superpowers/plans/baseline-2026-09-23.json`

Expected: 7 cells, roughly 10-20 minutes total. Check every cell has a non-null `itineraryMd` before continuing; re-run any that errored by setting `AB_FIXTURES` to just those ids and merging by hand.

- [ ] **Step 6: Commit the script and the baseline**

The baseline JSON is committed deliberately — it is the only copy of the old prompts' output, and it cannot be regenerated once Task 2 lands.

```bash
git add scripts/skill-ab.mjs docs/superpowers/plans/baseline-2026-09-23.json
git commit -m "Keep what the old rules produced, before changing them"
```

---

## Task 2: Budget becomes a ceiling

**Files:**
- Modify: `src/lib/lodgingPrompt.ts:34-36`
- Modify: `.claude/skills/itinerary-planner/SKILL.md` §5
- Modify: `src/lib/itineraryPrompt.ts:351`
- Test: `src/lib/lodgingPrompt.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `budgetInstruction(): string` keeps its exact signature — it is called from two places in `itineraryPrompt.ts` (`:217` and `:250`) and both must keep working unchanged.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/lodgingPrompt.test.mjs`:

```javascript
test("budgetInstruction states the budget as a ceiling, not a target to consume", () => {
  const text = budgetInstruction();
  assert.match(text, /ceiling/i);
  // The exact mechanism the review identified as manufacturing bad recommendations: a rule to
  // fill the remaining budget with premium extras.
  assert.doesNotMatch(text, /85-100/);
  assert.doesNotMatch(text, /premium extras/i);
  assert.match(text, /never add an experience primarily because money remains/i);
});
```

Add `budgetInstruction` to the file's existing import from `./lodgingPrompt.ts` if it is not already there.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/lodgingPrompt.test.mjs`
Expected: FAIL — the current string contains "85-100" and "premium extras".

- [ ] **Step 3: Rewrite `budgetInstruction()`**

Replace `src/lib/lodgingPrompt.ts:34-36` with:

```typescript
/**
 * The one shared budget string, spliced into both legacy prompts (`itineraryPrompt.ts:217` and
 * `:250`) and mirrored by SKILL.md §5. The three must not drift.
 *
 * This used to ask for 85-100% of the stated budget and, failing that, for premium extras to
 * consume the rest. A stated budget almost always means "do not exceed this", and the rule turned
 * a good $2,900 trip into a padded $4,700 one. `evaluateBudget` in guardrails.ts has always
 * treated the budget as a pure ceiling, so the code and the prompt were already disagreeing; this
 * sides with the code.
 */
export function budgetInstruction(): string {
  return `Treat the stated budget as a ceiling, not a target to reach. A strong itinerary does not need to spend all of it. Stay comfortably within it, prefer value and fit over spending, and where practical leave roughly 10-15% unspent for unplanned transport, price variation, tips and taxes. Let the tier set the style of what you recommend. If the traveler explicitly asked to use the full budget, to make it luxurious, or for the best possible within the amount, premium upgrades are welcome where they genuinely improve the trip. Never add an experience primarily because money remains.`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/lodgingPrompt.test.mjs`
Expected: PASS.

- [ ] **Step 5: Rewrite SKILL.md §5**

Replace the whole of `## §5. Budget` (currently two paragraphs beginning "The itinerary's total cost (lodging + stops combined) MUST come close") with:

```markdown
## §5. Budget

The stated budget is a **ceiling**, not a target to reach. A strong itinerary does not need to
spend all of it, and an unspent remainder is not a planning failure.

- Stay comfortably within the stated budget.
- Prefer value and fit over spending. Where practical, leave roughly 10-15% unspent for unplanned
  transport, price variation, tips and taxes.
- Let the tier (§6) set the register of what you recommend, not the size of the remainder.
- **Never add an experience primarily because money remains.**

The exception is stated, never inferred: if the traveler asked to use the full budget, to make it
luxurious, or for the best possible within the amount, premium upgrades are welcome where they
genuinely improve the trip.

Costs given per person become party cost before they are compared to the budget (§9, party
composition). Anything already paid for — booked lodging, a booked flight — is cost 0 and is not
charged against what is left to spend (§4e).

When editing an existing itinerary, this is a constraint the edit may not violate. A small edit is
not expected to rebalance the trip's total; it must simply not push it over the ceiling without
saying so (§12d).
```

- [ ] **Step 6: Fix the critique checklist**

In `src/lib/itineraryPrompt.ts:351`, replace `(1) total cost (lodging + stops) landing within 85-100% of the budget` with:

```
(1) total cost (lodging + stops) landing at or under the budget, with anything already paid for counted as 0 and per-person costs multiplied by party size
```

- [ ] **Step 7: Verify nothing else references the old band**

Run: `grep -rn "85-100\|85%" src/ .claude/ docs/*.md`
Expected: the only remaining hits are `BUDGET_TARGET_FLOOR` in `src/lib/bench/scorers/context.ts` (Task 16 handles it) and historical prose in `docs/`. If `src/lib/bench/scorers/context.ts:208` and `:214` still describe the old rule in comments, leave them — Task 16 rewrites that block.

- [ ] **Step 8: Full verification and commit**

```bash
npm test && npx tsc --noEmit -p tsconfig.json && npm run lint
git add src/lib/lodgingPrompt.ts src/lib/lodgingPrompt.test.mjs .claude/skills/itinerary-planner/SKILL.md src/lib/itineraryPrompt.ts
git commit -m "Let a budget be a limit rather than a quota"
```

---

## Task 3: Transfer time and airport processing become two buffers

**Files:**
- Modify: `src/lib/travelerProfilePrompt.ts:102-130`
- Modify: `.claude/skills/itinerary-planner/SKILL.md` §4c-bis
- Test: `src/lib/travelerProfilePrompt.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `formatTravelLegs(logistics: TripLogistics | null): string` keeps its signature and its empty-string-for-absent contract.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/travelerProfilePrompt.test.mjs`:

```javascript
test("a departure reserves transfer time AND an airport buffer, named separately", () => {
  const text = formatTravelLegs({
    arrivalTime: null,
    arrivalPoint: null,
    departureTime: "18:00",
    departurePoint: "Kansai Intl (KIX)",
    stayBooked: null,
  });
  // Both halves must be present and distinguishable — collapsing them into one 90-minute figure
  // is the defect this replaces.
  assert.match(text, /travel time/i);
  assert.match(text, /2 hours/);
  assert.match(text, /3 hours/);
  assert.doesNotMatch(text, /90 minutes before/i);
});

test("an arrival still allows 90 minutes, which is a different thing from a departure buffer", () => {
  const text = formatTravelLegs({
    arrivalTime: "13:45",
    arrivalPoint: null,
    departureTime: null,
    departurePoint: null,
    stayBooked: null,
  });
  assert.match(text, /90 minutes/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/travelerProfilePrompt.test.mjs`
Expected: FAIL on the departure test — the current string says "Leave about 90 minutes before that clear".

- [ ] **Step 3: Rewrite the departure branch**

In `src/lib/travelerProfilePrompt.ts`, replace the `departureTime` string (currently `Leave about 90 minutes before that clear for the transfer out, and plan nothing that would run into it.`) with:

```typescript
      ? `The traveler departs on the last day at ${logistics.departureTime}${where}. Reserve two separate things before it: the travel time from the last stop to the departure point, PLUS an arrival buffer at the departure point itself — about 2 hours for a domestic flight, 3 for an international one, much less for a train. Those defaults apply unless the trip context says otherwise, and the airport buffer is not part of the transfer time. Plan nothing that would run into either.`
```

Update the docstring at `:99` — it currently says "The 90-minute figure is stated here and in the skill (§4c-bis), and mirrors `TRANSFER_BUFFER_MIN` in the benchmark scorer". Replace with:

```typescript
 * Two figures, not one, and they are different things. Arrival keeps 90 minutes for immigration,
 * bags and the transfer in. Departure reserves travel time to the airport PLUS a processing buffer
 * before the flight — 2h domestic, 3h international. Collapsing them was the defect: "90 minutes
 * before a 18:00 flight" reads as leaving at 16:30, which is not enough for either half.
 *
 * Both are mirrored in SKILL.md §4c-bis and in `ARRIVAL_BUFFER_MIN` / `DEPARTURE_BUFFER_MIN` in
 * the benchmark scorers. Move one, move all three.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/travelerProfilePrompt.test.mjs`
Expected: PASS.

- [ ] **Step 5: Rewrite SKILL.md §4c-bis's departure paragraph**

Replace the sentence `The last day mirrors this: leave roughly 90 minutes clear before the departure time for the transfer out, plan nothing that would run into it, and keep that day's stops near the departure point.` with:

```markdown
The last day mirrors this, but with **two** buffers rather than one, because they are different
things and collapsing them is how a traveler misses a flight:

1. the travel time from the last stop to the departure point; **plus**
2. an arrival buffer at the departure point itself — roughly 2 hours before a domestic flight,
   3 hours before an international one, and much less for a train.

Those are conservative defaults, not claims about a specific airport: if the trip context gives
airline or airport guidance, use that instead. The airport buffer is never part of the transfer
time. Plan nothing that would run into either, and keep that day's stops near the departure point.
```

- [ ] **Step 6: Full verification and commit**

```bash
npm test && npx tsc --noEmit -p tsconfig.json && npm run lint
git add src/lib/travelerProfilePrompt.ts src/lib/travelerProfilePrompt.test.mjs .claude/skills/itinerary-planner/SKILL.md
git commit -m "Getting to the airport and waiting at it are two different hours"
```

---

## Task 4: A global constraint precedence

**Files:**
- Modify: `.claude/skills/itinerary-planner/SKILL.md` — insert §0 before §1
- Modify: `src/lib/itineraryPrompt.ts` — the generate prompt header at `:204`
- Test: `src/lib/itineraryPrompt.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: a `PRECEDENCE_INSTRUCTION` exported const in `src/lib/itineraryPrompt.ts`, so Task 5's critique-checklist edit can reference the same ordering without restating it.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/itineraryPrompt.test.mjs`:

```javascript
test("the generate prompt states which constraint wins when two conflict", () => {
  const prompt = buildGeneratePrompt({
    destination: "Kyoto",
    startDate: "2026-09-19",
    endDate: "2026-09-22",
    budget: 3000,
    tier: "mid-range",
  });
  assert.match(prompt, /when two of these conflict/i);
  // The ordering itself, not just the fact that an ordering exists.
  assert.ok(
    prompt.indexOf("Fixed commitments") < prompt.indexOf("Primary interests"),
    "commitments must be listed above interests"
  );
  assert.ok(
    prompt.indexOf("Safety and accessibility") < prompt.indexOf("Traveler profile"),
    "accessibility must be listed above pace"
  );
});
```

Match the exact argument shape `buildGeneratePrompt` takes by reading `src/lib/itineraryPrompt.ts:194-227` first; the test above shows the required fields only.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/itineraryPrompt.test.mjs`
Expected: FAIL — no precedence text exists.

- [ ] **Step 3: Add the shared constant**

In `src/lib/itineraryPrompt.ts`, near `CONTEXT_USE_INSTRUCTION` at `:146`:

```typescript
/**
 * The one answer to "what wins when three valid rules disagree".
 *
 * The rules below (and in SKILL.md) each say "hard constraint", "authoritative", "priority" —
 * which is unambiguous one at a time and silent about a packed-pace traveler with low mobility, a
 * museum closing at 4pm and a 6pm reservation. Stating the order once is what makes the model
 * consistent across those, rather than picking a different winner each generation.
 *
 * Mirrored by SKILL.md §0. Move one, move both.
 */
export const PRECEDENCE_INSTRUCTION = `When two of these conflict, this is the order that decides it, highest first:
1. Fixed commitments and immutable facts — booked flights, trains, accommodation, timed tickets, anything the traveler says cannot move.
2. Safety and accessibility — stated accessibility needs, dietary and allergy requirements, destination safety notes.
3. Physical and temporal feasibility — opening hours, travel time, arrival and departure boundaries, daylight, realistic stop duration.
4. Explicit traveler requirements and exclusions — must-dos, do-not-includes, transport restrictions, the budget ceiling.
5. Traveler profile — pace, energy, crowd preference, group and family rules.
6. Primary (starred) interests.
7. Secondary interests and vibe.
8. Variety, aesthetics and optimization.
A lower item never silently overrides a higher one. When two hard constraints genuinely cannot both hold, keep the higher one and say plainly in the affected stop's note that the other could not be met.`;
```

- [ ] **Step 4: Splice it into the generate prompt**

In `buildGeneratePrompt` (`:204`), add `${PRECEDENCE_INSTRUCTION}` on its own line immediately after the opening `Plan a day-by-day trip itinerary for …` line and before the existing constraint sections, so it is read before the rules it orders.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/itineraryPrompt.test.mjs`
Expected: PASS.

- [ ] **Step 6: Add SKILL.md §0**

Insert immediately after the intro paragraph ("These rules apply to every itinerary you produce or edit…") and before `## §1`:

```markdown
## §0. What wins when two rules conflict

Every section below states its own constraint, and one at a time each is unambiguous. This is what
decides it when several apply at once — a packed-pace traveler with low mobility, a museum that
shuts at 4pm, a 6pm reservation and rain from 2pm. Highest first:

1. **Fixed commitments and immutable facts** — booked flights and trains, booked accommodation,
   timed tickets, anything the traveler says cannot move (§4c-bis, §4e).
2. **Safety and accessibility** — stated accessibility needs (§9e), dietary and allergy
   requirements (§3d), destination safety notes (§1).
3. **Physical and temporal feasibility** — opening hours (§10), travel time (§12a), arrival and
   departure boundaries (§4c-bis), daylight (§10), realistic stop duration.
4. **Explicit traveler requirements and exclusions** — must-dos, do-not-includes, transport
   restrictions, the budget ceiling (§5).
5. **Traveler profile** — pace, energy, crowd bias, group and family rules (§9).
6. **Primary (starred) interests** (§9a).
7. **Secondary interests and vibe** (§1).
8. **Variety, aesthetics and optimization** (§14a).

A lower rank never silently overrides a higher one. When two hard constraints genuinely cannot
both hold, keep the higher and say so plainly where the traveler would act on it — §12 specifies
how to surface that.

The local precedences stated further down — dietary over priority (§3d), accessibility over energy
and pace (§9e), a starred priority over a tie-breaker (§9a) — are instances of this order, not
competitors to it. They stay where they are, next to the rules they govern.
```

- [ ] **Step 7: Full verification and commit**

```bash
npm test && npx tsc --noEmit -p tsconfig.json && npm run lint
git add .claude/skills/itinerary-planner/SKILL.md src/lib/itineraryPrompt.ts src/lib/itineraryPrompt.test.mjs
git commit -m "Say once which rule outranks which"
```

---

## Task 5: The five skill-only rules

**Files:**
- Modify: `.claude/skills/itinerary-planner/SKILL.md` — new §14e and §15; rewritten §9, §10, §13, §14c
- Modify: `src/lib/itineraryPrompt.ts:351` — two more critique checks

**Interfaces:**
- Consumes: `PRECEDENCE_INSTRUCTION` from Task 4 (referenced, not restated).
- Produces: nothing importable. This task is prose.

There is no unit test for prompt prose — nothing in the repo tests SKILL.md, and inventing a regex assertion per paragraph would test the wording rather than the behaviour. The A/B in Task 18 is this task's verification.

- [ ] **Step 1: Add §14e, duplicate prevention**

Append to §14, after §14d:

```markdown
### §14e. Never send them to the same place twice

Don't schedule the same attraction, restaurant, market or neighbourhood experience more than once
across the whole trip. Three exceptions, all of them explicit: the traveler asked to go back, the
second visit serves a materially different purpose (a market for breakfast and again for an
evening food tour), or it is their lodging.

Watch the near-duplicates, which are the ones that slip through: the same place under two names
("Sensō-ji" and "Asakusa Kannon Temple"), two branches of one chain read as two experiences, and a
named venue on one day inside an area-level stop (§3b) on another. Before you finish, read the
whole trip's stop names together — not day by day, which is exactly how a repeat survives.
```

- [ ] **Step 2: Add §15, the whole-trip audit**

Append at the end of the file, after §14d/§14e. The file runs §11 output format, §12 guardrails, §13 missing facts, §14 variety — so §15 at the end keeps the existing numbering untouched:

```markdown
## §15. Read the whole trip before you finish

§12's guardrails check a day. This checks the trip, which is a different question — four
food-heavy days each pass every per-day rule and still fail a traveler whose starred priorities
were food, history and nature. Before you commit a complete itinerary:

- Every must-include named by the traveler appears, exactly once. If one genuinely could not fit,
  say which and why rather than dropping it silently.
- Every stated exclusion is absent — not merely de-emphasised.
- The starred priorities visibly shaped the trip, in the order given, rather than appearing once
  each as a gesture.
- No day repeats another day's theme without a reason (§14a).
- Nothing appears twice by accident (§14e).
- The expensive days are spread rather than stacked.
- For a moderate- or low-energy traveler, no two strenuous days run back to back.
- The geographic clusters make sense as a sequence, not just individually.
- Every fixed commitment survived (§0 rank 1).

This is a pass over what you have written, not a re-plan. Fix what it finds; don't rebuild what it
doesn't.
```

- [ ] **Step 3: Generalise §14c into an availability rule**

Replace §14c's body with:

```markdown
### §14c. Existing is not the same as being available

A real restaurant, hotel, tour, event or attraction is not necessarily available to this traveler
on this date, and you have no booking data at all. So unless the trip context explicitly says
otherwise: never claim a reservation is available, never promise tickets remain, never state a
hotel has rooms, never imply a timed-entry slot exists.

Recommend it conditionally and say what needs checking. Where a stop plausibly needs booking ahead
— a tasting-menu restaurant, a named viewing platform, a guided tour, a small museum with entry
slots — say so in its note, early enough to act on. "Book ahead — these fill weeks out" is honest.
"Reserve the 14:00 slot" is invented.
```

- [ ] **Step 4: Add uncertainty propagation to §13**

Append to §13, after its numbered list:

```markdown
And a conclusion is never more certain than what it was computed from. If the travel time was
estimated, the timing that depends on it is approximate and the note says so. If the hours are
unverified, the stop is not described as definitely open. If the coordinates are approximate, any
route drawn through them is approximate. An estimate does not become a fact by being used in an
arithmetic — "a 12-minute journey" stated flatly, derived from a guessed coordinate and a guessed
distance, is the specific failure this prevents.
```

- [ ] **Step 5: Add local-time semantics to §10**

Append to §10:

```markdown
Every time you write is **local to where the traveler physically is at that point in the trip**.
When a trip crosses time zones, don't carry the previous destination's clock forward: flights,
trains, reservations, opening hours and sunrise/sunset are each in their own place's local time.
And when a transfer crosses zones, reason about the elapsed travel time, not the difference
between the two displayed clocks — a 10:00 departure arriving 11:30 the same morning can be a
ten-hour flight.
```

- [ ] **Step 6: Reconcile §9's "morning through evening" with deliberate free time**

In §9, replace the paragraph beginning `And the target caps the day's density, never its length.` with:

```markdown
And the target caps the day's density, never its length. Every day should still **account for**
its hours — lunch around 12:00-13:30, dinner around 18:30-20:30, and something in the evening
rather than a last entry at lunchtime.

Accounted-for is not the same as filled with sightseeing. Deliberate beach time, resort time, pool
time, a nap, shopping, or unstructured wandering can legitimately hold an afternoon when that is
what the traveler's profile asks for — a honeymoon at a resort, a relaxation-led trip, a low-energy
day. The requirement is that the time is **intentional and visible**, as an entry that says what it
is for (§14b), not that every hour contains an attraction. What is still wrong is a day that simply
stops at 1pm with nothing said about the rest of it — that is two thirds missing, not relaxed.

The only reasons to genuinely end early are the ones the context states: an arrival, a departure,
or a stated need to be back.
```

- [ ] **Step 7: Extend the critique checklist**

In `src/lib/itineraryPrompt.ts:351`, append two checks to the numbered list:

```
, (7) whether any attraction, restaurant or area appears more than once across the whole trip — including under a second name or as a branch of the same chain, (8) whether the trip as a whole reflects the starred priorities in the order given, rather than one day carrying all of them
```

- [ ] **Step 8: Check the file has not bloated**

Run: `wc -l .claude/skills/itinerary-planner/SKILL.md`
Expected: under 560 lines. If over, the §5 rewrite in Task 2 or the §14c rewrite in Step 3 has grown rather than replaced — check for a leftover copy of the text each was meant to supersede.

- [ ] **Step 9: Full verification and commit**

```bash
npm test && npx tsc --noEmit -p tsconfig.json && npm run lint
git add .claude/skills/itinerary-planner/SKILL.md src/lib/itineraryPrompt.ts
git commit -m "Read the whole trip, not just each day of it"
```

---

## Task 6: Minimal-change editing

**Files:**
- Modify: `src/lib/editPrompt.ts` — `CHAT_CAPABILITIES`
- Modify: `.claude/skills/itinerary-planner/SKILL.md` §12 — a new §12e
- Test: `src/lib/itineraryEdits.test.mjs` or a new assertion in an existing edit-prompt test

**Interfaces:**
- Consumes: nothing.
- Produces: nothing importable.

**Important:** `editPrompt.ts` carries recent work rewriting the ops and index rules — `applyPatch` now resolves every `stopIndex` against the plan as shown, and the prompt was updated to match. **Add to that wording; do not replace it.** In particular the instruction "If a request asks for several changes at once, do ALL of them in this one turn" must survive: doing every requested change and changing nothing else are the same principle from two directions, and deleting one to add the other would reintroduce the bug it fixed.

- [ ] **Step 1: Read the current state of the file**

Run: `sed -n 1,80p src/lib/editPrompt.ts`

Confirm `CHAT_CAPABILITIES` still contains "Every \"stopIndex\" you write refers to the plan exactly as shown below" and "do ALL of them in this one turn". If either is missing, stop and ask — the file has changed under this plan.

- [ ] **Step 2: Write the failing test**

Create `src/lib/editPrompt.test.mjs`:

```javascript
/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/editPrompt.test.mjs
 *
 * The chat edit prompt has to hold two rules that pull against each other: do every change the
 * traveler asked for, and change nothing they didn't. Dropping either produces a distinct,
 * already-seen failure — a half-applied request, or "change lunch" rewriting Wednesday. */
import assert from "node:assert/strict";
import test from "node:test";
import { buildChatEditPrompt } from "./editPrompt.ts";

const ITINERARY = {
  tier: "mid-range",
  days: [
    {
      date: "2026-09-19",
      weather: "Clear",
      stops: [
        { name: "Kiyomizu-dera", lat: 34.9949, lng: 135.785, cost: 5, note: "", time: "09:00", durationLabel: "1 hour", category: "entry" },
      ],
    },
  ],
};

test("the chat edit prompt asks for every requested change and nothing else", () => {
  const prompt = buildChatEditPrompt({
    skill: "",
    editContext: "",
    itinerary: ITINERARY,
    message: "change lunch",
  });
  // Both halves. Neither alone is the rule.
  assert.match(prompt, /do ALL of them in this one turn/);
  assert.match(prompt, /leave everything the traveler did not ask about exactly as it is/i);
  assert.match(prompt, /smallest set of stops/i);
});
```

Read `buildChatEditPrompt`'s real parameter shape at `src/lib/editPrompt.ts:113-177` first and match it — the object above shows the fields the test needs, not necessarily every required one.

- [ ] **Step 3: Run it to verify it fails**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/editPrompt.test.mjs`
Expected: FAIL on the "leave everything" assertion.

- [ ] **Step 4: Append the minimal-change rule to `CHAT_CAPABILITIES`**

Add immediately after the "do ALL of them in this one turn" paragraph:

```
And leave everything the traveler did not ask about exactly as it is. Change the smallest set of
stops that satisfies the request. Keep every fixed commitment, every stop they did not mention,
the lodging, and the shape of days they said nothing about. Re-check the travel time immediately
before and immediately after whatever you changed, and move a downstream time only where
feasibility forces it. Never restyle a stop you were not asked about because you would have picked
differently — "change lunch" rewriting Wednesday is the failure here, and it is more annoying than
a change that didn't happen. Where an edit genuinely forces a cascade, make the smallest one and
say which items moved.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/editPrompt.test.mjs`
Expected: PASS.

- [ ] **Step 6: Add SKILL.md §12e**

Append to §12:

```markdown
### §12e. An edit changes what was asked for, and nothing else

The plan on the table is the traveler's. When you change it, preserve everything they did not ask
about unless feasibility forces otherwise:

1. Change the smallest set of stops that satisfies the request.
2. Keep every fixed commitment (§0 rank 1) and every previously accepted stop.
3. Re-check travel time immediately before and immediately after the edited stop.
4. Adjust downstream times only where a check in §12 would otherwise fail.
5. Never rewrite an unrelated day, change the lodging, or restyle a stop for taste alone.

Where an edit genuinely forces a cascade, make the minimum one and say which items moved. A small
request that returns a differently-shaped week is a worse outcome than one that returns nothing.
```

- [ ] **Step 7: Full verification and commit**

```bash
npm test && npx tsc --noEmit -p tsconfig.json && npm run lint
git add src/lib/editPrompt.ts src/lib/editPrompt.test.mjs .claude/skills/itinerary-planner/SKILL.md
git commit -m "Change the lunch they asked about, not the week around it"
```

---

## Task 7: The duplicate guardrail

**Files:**
- Modify: `src/lib/guardrails.ts`
- Test: `src/lib/guardrails.test.mjs`

**Interfaces:**
- Consumes: `normalizeStopName` from `src/lib/placeConflicts.ts:127`.
- Produces: `GuardrailRule` gains `"duplicate"`. `evaluateItinerary` gains this check unconditionally — it needs no options, so the four existing UI callers (`ArrangeBoard.tsx:223`, `SplitEditor.tsx:122`, `FocusEditMode.tsx:212`, `ItineraryCard.tsx:437`) get it without changing a line.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/guardrails.test.mjs`:

```javascript
test("the same place on two days is a finding; the lodging is not", () => {
  const itinerary = {
    tier: "mid-range",
    days: [
      {
        date: "2026-09-19",
        weather: "Clear",
        lodging: { name: "Boutique hotel in Gion", cost: 180, note: "" },
        stops: [{ name: "Nishiki Market", lat: 35.0050, lng: 135.7649, cost: 0, note: "", time: "10:00", durationLabel: "1 hour", category: "other" }],
      },
      {
        date: "2026-09-20",
        weather: "Clear",
        lodging: { name: "Boutique hotel in Gion", cost: 180, note: "" },
        stops: [{ name: "nishiki  market", lat: 35.0050, lng: 135.7649, cost: 0, note: "", time: "10:00", durationLabel: "1 hour", category: "other" }],
      },
    ],
  };
  const found = evaluateItinerary(itinerary).filter((g) => g.rule === "duplicate");
  assert.equal(found.length, 1, "one finding for the repeated market");
  assert.match(found[0].message, /Nishiki Market/);
  assert.equal(found[0].dayIndex, 1, "reported against the later day, which is the one to change");
});

test("two different places close together are not duplicates", () => {
  const itinerary = {
    tier: "mid-range",
    days: [
      { date: "2026-09-19", weather: "Clear", stops: [{ name: "Museu Picasso", lat: 41.3851, lng: 2.1810, cost: 12, note: "", time: "10:00", durationLabel: "1 hour", category: "entry" }] },
      { date: "2026-09-20", weather: "Clear", stops: [{ name: "Gothic Quarter", lat: 41.3833, lng: 2.1766, cost: 0, note: "", time: "10:00", durationLabel: "1 hour", category: "other" }] },
    ],
  };
  assert.deepEqual(evaluateItinerary(itinerary).filter((g) => g.rule === "duplicate"), []);
});

test("the same stop twice within one day is also a duplicate", () => {
  const itinerary = {
    tier: "mid-range",
    days: [
      {
        date: "2026-09-19",
        weather: "Clear",
        stops: [
          { name: "Pike Place Market", lat: 47.6097, lng: -122.3422, cost: 0, note: "", time: "10:00", durationLabel: "1 hour", category: "other" },
          { name: "Pike Place Market", lat: 47.6097, lng: -122.3422, cost: 0, note: "", time: "15:00", durationLabel: "1 hour", category: "other" },
        ],
      },
    ],
  };
  assert.equal(evaluateItinerary(itinerary).filter((g) => g.rule === "duplicate").length, 1);
});
```

Add `evaluateItinerary` to the file's import from `./guardrails.ts`.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/guardrails.test.mjs`
Expected: FAIL — `"duplicate"` is not a rule, so all three filters return empty and the first two assertions fail.

- [ ] **Step 3: Implement the check**

In `src/lib/guardrails.ts`, extend the rule union:

```typescript
export type GuardrailRule =
  | "travel"
  | "overlap"
  | "pace"
  | "budget"
  | "duplicate"
  | "commitment"
  | "required"
  | "party-budget";
```

Add the import and the check:

```typescript
import { normalizeStopName } from "./placeConflicts";

/** Two stops this close, under names that normalize the same, are one place written twice rather
 *  than two neighbours. Degrees, not metres: ~0.0015° is roughly 150m at any latitude this app
 *  plans trips at, and a haversine here would be precision the comparison does not need. */
const DUPLICATE_DEGREES = 0.0015;

/**
 * §14e: the same place scheduled twice across the trip.
 *
 * Trip-wide rather than per-day, because reading a plan day by day is exactly how a repeat
 * survives. Lodging is exempt — §4c *requires* the same stay on every night in one city, so
 * flagging it would report the rule working as a fault.
 *
 * Matches on the normalized name OR on proximity, not both: "Sensō-ji" and "Asakusa Kannon Temple"
 * share coordinates and no letters, while two branches of one chain share a name and no
 * coordinates. Either alone is enough to be worth a look.
 */
function checkDuplicates(itinerary: Itinerary): Guardrail[] {
  const found: Guardrail[] = [];
  const seen: { key: string; lat: number; lng: number; name: string }[] = [];

  itinerary.days.forEach((day, dayIndex) => {
    for (const stop of day.stops ?? []) {
      const key = normalizeStopName(stop.name);
      if (!key) continue;
      const prior = seen.find(
        (s) =>
          s.key === key ||
          (Math.abs(s.lat - stop.lat) < DUPLICATE_DEGREES &&
            Math.abs(s.lng - stop.lng) < DUPLICATE_DEGREES)
      );
      if (prior) {
        found.push({
          rule: "duplicate",
          dayIndex,
          message: `${stop.name} is already in the trip as ${prior.name} — the same place twice.`,
        });
      } else {
        seen.push({ key, lat: stop.lat, lng: stop.lng, name: stop.name });
      }
    }
  });

  return found;
}
```

Then call it from `evaluateItinerary`:

```typescript
export function evaluateItinerary(
  itinerary: Itinerary,
  options: { budget?: number; modes?: TransportMode[]; realMinutes?: LegMinutesLookup } = {}
): Guardrail[] {
  const perDay = itinerary.days.flatMap((day, i) =>
    evaluateDay(day, i, options.modes, options.realMinutes)
  );
  const budget = options.budget ? evaluateBudget(itinerary, options.budget) : [];
  // Needs no option, so every existing caller gains it — a duplicate is a defect whether the
  // model wrote it or an edit introduced it.
  return [...perDay, ...checkDuplicates(itinerary), ...budget];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/guardrails.test.mjs`
Expected: PASS, all three.

- [ ] **Step 5: Check the UI still compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS. `ArrangeBoard.tsx` and `ItineraryCard.tsx` both switch on `Guardrail["rule"]` for display — if either has an exhaustive switch, add a `"duplicate"` arm rendering the message the same way `"overlap"` does.

- [ ] **Step 6: Full verification and commit**

```bash
npm test && npx tsc --noEmit -p tsconfig.json && npm run lint
git add src/lib/guardrails.ts src/lib/guardrails.test.mjs src/components/
git commit -m "Notice when a place is in the trip twice"
```

---

## Task 8: The commitment guardrail and the split buffers

**Files:**
- Modify: `src/lib/bench/scorers/domain.ts:661-691` — split the constant
- Modify: `src/lib/guardrails.ts`
- Test: `src/lib/guardrails.test.mjs`, `src/lib/bench/bench.test.mjs`

**Interfaces:**
- Consumes: `TripLogistics` from `src/lib/types.ts:201`, `parseClock` and `parseDuration` from `src/lib/itinerary.ts`.
- Produces: `evaluateItinerary` gains `options.logistics?: TripLogistics | null`. `src/lib/bench/scorers/domain.ts` exports `ARRIVAL_BUFFER_MIN = 90` and `DEPARTURE_BUFFER_MIN = 120` in place of `TRANSFER_BUFFER_MIN`; Task 16 imports both.

**Context:** `usableSlot` in `domain.ts` is exported and tested but **has no caller** — nothing in `scoreParsed` reaches it. Changing its constant therefore moves no existing score. It already implements the arithmetic the commitment check needs, from the opposite direction ("is this slot plannable" vs "did the plan cross the boundary"), which is why the constants are split there and imported here rather than duplicated.

- [ ] **Step 1: Split the constant**

In `src/lib/bench/scorers/domain.ts`, replace lines 661-662:

```typescript
/**
 * Two buffers, because they are two different things.
 *
 * Arrival is immigration, bags and the transfer in after landing. Departure is check-in and
 * security before a flight, and it sits on top of the travel time to the airport rather than
 * including it — SKILL.md §4c-bis states 2h domestic and 3h international.
 *
 * 120 is the checkable floor rather than a claim the flight is domestic: `departurePoint` is free
 * text and cannot tell us which it is, a plan that correctly reserved 3 hours also clears a
 * 2-hour check, and checking against 180 would fail every correct domestic plan.
 */
export const ARRIVAL_BUFFER_MIN = 90;
export const DEPARTURE_BUFFER_MIN = 120;
```

Update `usableSlot`'s two uses: line 684 takes `ARRIVAL_BUFFER_MIN`, line 688 takes `DEPARTURE_BUFFER_MIN`.

- [ ] **Step 2: Update the existing `usableSlot` tests**

In `src/lib/bench/bench.test.mjs`, the departure expectations at lines 507-508 and 528 were written against 90 minutes. Recompute each against 120 and update the assertion, keeping the same fixtures. A `10:00` departure with a 120-minute buffer makes the usable boundary `08:00`, so `Morning` (06:00-12:00) now **ends** after it — change line 529's expectation from `true` to `false` if that is what the recomputation gives, and leave a comment saying the boundary moved with the buffer.

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/bench/bench.test.mjs`
Expected: PASS after the recomputation.

- [ ] **Step 3: Write the failing guardrail test**

Append to `src/lib/guardrails.test.mjs`:

```javascript
const LOGISTICS = {
  arrivalTime: "13:45",
  arrivalPoint: "KIX",
  departureTime: "18:00",
  departurePoint: "KIX",
  stayBooked: "Hotel Ronda (already paid)",
};

const twoDayTrip = (firstStopTime, lastStopTime) => ({
  tier: "mid-range",
  days: [
    {
      date: "2026-09-19",
      weather: "Clear",
      lodging: { name: "Hotel Ronda (already paid)", cost: 0, note: "" },
      stops: [{ name: "Gion walk", lat: 35.0037, lng: 135.7788, cost: 0, note: "", time: firstStopTime, durationLabel: "1 hour", category: "other" }],
    },
    {
      date: "2026-09-20",
      weather: "Clear",
      stops: [{ name: "Nishiki Market", lat: 35.0050, lng: 135.7649, cost: 0, note: "", time: lastStopTime, durationLabel: "1 hour", category: "other" }],
    },
  ],
});

test("a stop before the arrival buffer clears is a commitment finding", () => {
  // Lands 13:45, so nothing may start before 15:15.
  const found = evaluateItinerary(twoDayTrip("14:00", "09:00"), { logistics: LOGISTICS })
    .filter((g) => g.rule === "commitment");
  assert.equal(found.length, 1);
  assert.match(found[0].message, /arriv/i);
  assert.equal(found[0].dayIndex, 0);
});

test("a stop running into the departure buffer is a commitment finding", () => {
  // Departs 18:00, so nothing may still be running after 16:00.
  const found = evaluateItinerary(twoDayTrip("15:30", "15:30"), { logistics: LOGISTICS })
    .filter((g) => g.rule === "commitment");
  assert.equal(found.length, 1);
  assert.match(found[0].message, /depart/i);
  assert.equal(found[0].dayIndex, 1);
});

test("booked lodging charged again is a commitment finding", () => {
  const trip = twoDayTrip("15:30", "09:00");
  trip.days[0].lodging = { name: "Hotel Ronda (already paid)", cost: 180, note: "" };
  const found = evaluateItinerary(trip, { logistics: LOGISTICS })
    .filter((g) => g.rule === "commitment");
  assert.equal(found.length, 1);
  assert.match(found[0].message, /already paid/i);
});

test("no logistics means no commitment findings at all", () => {
  assert.deepEqual(
    evaluateItinerary(twoDayTrip("06:00", "23:00")).filter((g) => g.rule === "commitment"),
    []
  );
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/guardrails.test.mjs`
Expected: FAIL — `options.logistics` is not read.

- [ ] **Step 5: Implement the check**

In `src/lib/guardrails.ts`:

```typescript
import { ARRIVAL_BUFFER_MIN, DEPARTURE_BUFFER_MIN } from "./bench/scorers/domain";
import type { TripLogistics } from "./types";
```

**If that import pulls the benchmark graph into the client bundle**, move the two constants into `src/lib/itinerary.ts` instead and have `domain.ts` re-export them from there. Check with `npx tsc --noEmit` and by confirming `guardrails.ts` still has no transitive import of `db.ts`; the benchmark scorers import fixtures, which import `reconcile.ts`, so this is the likely outcome. Prefer the move.

```typescript
/**
 * §0 rank 1: what the traveler already committed to, which no plan may cross.
 *
 * Three things, all silent failures otherwise. A stop before the arrival buffer clears is a stop
 * they are still at baggage reclaim for. A stop still running inside the departure buffer is a
 * missed flight. A booked stay priced again double-counts money already spent and distorts what
 * is left.
 *
 * Every check is skipped when its field is absent — "not stated" is a real state and must not read
 * as a boundary of midnight.
 */
function checkCommitments(itinerary: Itinerary, logistics: TripLogistics): Guardrail[] {
  const found: Guardrail[] = [];
  const lastIndex = itinerary.days.length - 1;

  const landed = parseClock(logistics.arrivalTime ?? "");
  if (landed !== null && itinerary.days[0]) {
    const clears = landed + ARRIVAL_BUFFER_MIN;
    for (const stop of itinerary.days[0].stops ?? []) {
      const start = parseClock(stop.time ?? "");
      if (start !== null && start < clears) {
        found.push({
          rule: "commitment",
          dayIndex: 0,
          message: `${stop.name} starts at ${stop.time}, but the traveler only arrives at ${logistics.arrivalTime} and needs about ${ARRIVAL_BUFFER_MIN} min for bags and the transfer in.`,
        });
      }
    }
  }

  const leaves = parseClock(logistics.departureTime ?? "");
  if (leaves !== null && lastIndex >= 0 && itinerary.days[lastIndex]) {
    // The travel time to the departure point is not known here, so this checks the processing
    // buffer alone. A plan that clears this can still be too tight once the transfer is counted —
    // §12a's travel check is what catches that half.
    const mustEndBy = leaves - DEPARTURE_BUFFER_MIN;
    for (const stop of itinerary.days[lastIndex].stops ?? []) {
      const start = parseClock(stop.time ?? "");
      if (start === null) continue;
      const end = start + parseDuration(stop.durationLabel ?? "");
      if (end > mustEndBy) {
        found.push({
          rule: "commitment",
          dayIndex: lastIndex,
          message: `${stop.name} runs past ${formatClock(mustEndBy)}, which is when the traveler needs to be heading for a ${logistics.departureTime} departure.`,
        });
      }
    }
  }

  if (logistics.stayBooked) {
    itinerary.days.forEach((day, dayIndex) => {
      if (day.lodging && day.lodging.cost > 0) {
        found.push({
          rule: "commitment",
          dayIndex,
          message: `${day.lodging.name} is already paid for — it should cost 0, not $${day.lodging.cost}.`,
        });
      }
    });
  }

  return found;
}
```

Import `formatClock` from `./itinerary` alongside the existing `parseClock`/`parseDuration`. Extend the options and the call:

```typescript
export function evaluateItinerary(
  itinerary: Itinerary,
  options: {
    budget?: number;
    modes?: TransportMode[];
    realMinutes?: LegMinutesLookup;
    /** What the traveler already booked. Absent means not asked — every check inside is skipped
     *  rather than defaulting to a boundary. */
    logistics?: TripLogistics | null;
  } = {}
): Guardrail[] {
  const perDay = itinerary.days.flatMap((day, i) =>
    evaluateDay(day, i, options.modes, options.realMinutes)
  );
  const budget = options.budget ? evaluateBudget(itinerary, options.budget) : [];
  const commitments = options.logistics ? checkCommitments(itinerary, options.logistics) : [];
  return [...perDay, ...checkDuplicates(itinerary), ...commitments, ...budget];
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/guardrails.test.mjs src/lib/bench/bench.test.mjs`
Expected: PASS.

- [ ] **Step 7: Full verification and commit**

```bash
npm test && npx tsc --noEmit -p tsconfig.json && npm run lint
git add src/lib/guardrails.ts src/lib/guardrails.test.mjs src/lib/bench/scorers/domain.ts src/lib/bench/bench.test.mjs src/lib/itinerary.ts
git commit -m "Hold the plan inside the flights they already booked"
```

---

## Task 9: The must-include and party-budget guardrails

**Files:**
- Modify: `src/lib/guardrails.ts`
- Test: `src/lib/guardrails.test.mjs`

**Interfaces:**
- Consumes: `normalizeStopName`, `tripSpend` (already imported).
- Produces: `evaluateItinerary` gains `options.mustInclude?: string[]`, `options.avoid?: string[]`, `options.partySize?: number`. Task 10 passes all three; Task 11 defines where they come from.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/guardrails.test.mjs`:

```javascript
const oneStop = (name) => ({
  tier: "mid-range",
  days: [
    {
      date: "2026-09-19",
      weather: "Clear",
      stops: [{ name, lat: 48.8606, lng: 2.3376, cost: 20, note: "", time: "10:00", durationLabel: "1 hour", category: "entry" }],
    },
  ],
});

test("a must-include that never appears is a finding", () => {
  const found = evaluateItinerary(oneStop("Musée d'Orsay"), { mustInclude: ["Louvre Museum"] })
    .filter((g) => g.rule === "required");
  assert.equal(found.length, 1);
  assert.match(found[0].message, /Louvre Museum/);
  assert.equal(found[0].dayIndex, null, "a missing must-do is a trip-wide finding");
});

test("a must-include that appears is not a finding", () => {
  assert.deepEqual(
    evaluateItinerary(oneStop("Louvre Museum"), { mustInclude: ["louvre  museum"] })
      .filter((g) => g.rule === "required"),
    []
  );
});

test("an excluded term that appears is a finding", () => {
  const found = evaluateItinerary(oneStop("Rooftop cocktail bar"), { avoid: ["bar"] })
    .filter((g) => g.rule === "required");
  assert.equal(found.length, 1);
  assert.match(found[0].message, /bar/i);
});

test("party size multiplies per-person costs before the budget is judged", () => {
  // $20 a head for four is $80, which clears a $100 budget; the same plan for four at $30 a head
  // does not.
  assert.deepEqual(
    evaluateItinerary(oneStop("Louvre Museum"), { budget: 100, partySize: 4 })
      .filter((g) => g.rule === "party-budget"),
    []
  );
  const over = evaluateItinerary(oneStop("Louvre Museum"), { budget: 50, partySize: 4 })
    .filter((g) => g.rule === "party-budget");
  assert.equal(over.length, 1);
  assert.match(over[0].message, /4 people/);
});

test("no party size means the plain budget check, unchanged", () => {
  assert.deepEqual(
    evaluateItinerary(oneStop("Louvre Museum"), { budget: 50 }).filter((g) => g.rule === "party-budget"),
    []
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/guardrails.test.mjs`
Expected: FAIL — neither rule exists.

- [ ] **Step 3: Implement both checks**

```typescript
/**
 * §0 rank 4: what the traveler named outright.
 *
 * A must-include is not an interest tag. "I like museums" is a preference the plan weighs; "I have
 * to see the Louvre" is a requirement, and a plan missing it has failed however good the rest is.
 * Reported trip-wide (`dayIndex: null`) because the fix is "put it somewhere", not "fix day 3".
 *
 * Substring matching on the normalized form, so "Louvre" matches "Louvre Museum" and the model's
 * capitalisation drift is absorbed the same way `placeConflicts` absorbs it.
 */
function checkRequired(
  itinerary: Itinerary,
  mustInclude: string[],
  avoid: string[]
): Guardrail[] {
  const found: Guardrail[] = [];
  const names = itinerary.days.flatMap((d) => (d.stops ?? []).map((s) => normalizeStopName(s.name)));
  const haystack = names.join(" | ");

  for (const want of mustInclude) {
    const key = normalizeStopName(want);
    if (!key) continue;
    if (!names.some((n) => n.includes(key))) {
      found.push({
        rule: "required",
        dayIndex: null,
        message: `${want} was asked for but is not in the plan.`,
      });
    }
  }

  for (const unwanted of avoid) {
    const key = normalizeStopName(unwanted);
    if (!key) continue;
    if (haystack.includes(key)) {
      found.push({
        rule: "required",
        dayIndex: null,
        message: `${unwanted} was excluded but something in the plan matches it.`,
      });
    }
  }

  return found;
}

/**
 * §5 + §9: a per-person price is not a trip total.
 *
 * `tripSpend` sums the numbers as written. Where those are per head — which is what a "$20"
 * museum entry means for a party of four — the trip costs four times what the plan says, and the
 * budget check silently passes a trip that is 300% over. Reported separately from `budget` so the
 * two readings are visible side by side rather than one overwriting the other.
 *
 * Lodging is excluded from the multiplication: a room price is already a party price.
 */
function checkPartyBudget(itinerary: Itinerary, budget: number, partySize: number): Guardrail[] {
  if (partySize <= 1) return [];
  const stopsTotal = itinerary.days.reduce(
    (n, day) => n + (day.stops ?? []).reduce((m, s) => m + (s.actualCost ?? s.cost ?? 0), 0),
    0
  );
  const lodgingTotal = itinerary.days.reduce((n, day) => n + (day.lodging?.cost ?? 0), 0);
  const partyTotal = stopsTotal * partySize + lodgingTotal;
  if (partyTotal <= budget) return [];
  return [
    {
      rule: "party-budget",
      dayIndex: null,
      message: `Priced per person, this comes to $${Math.round(partyTotal)} for ${partySize} people — $${Math.round(partyTotal - budget)} over the $${budget} budget.`,
    },
  ];
}
```

Extend the options and the call:

```typescript
export function evaluateItinerary(
  itinerary: Itinerary,
  options: {
    budget?: number;
    modes?: TransportMode[];
    realMinutes?: LegMinutesLookup;
    logistics?: TripLogistics | null;
    /** Places the traveler named outright. Absent means none were named, not none matter. */
    mustInclude?: string[];
    avoid?: string[];
    /** Heads, for converting per-person stop costs to a party total. 1 or absent is a no-op. */
    partySize?: number;
  } = {}
): Guardrail[] {
  const perDay = itinerary.days.flatMap((day, i) =>
    evaluateDay(day, i, options.modes, options.realMinutes)
  );
  const budget = options.budget ? evaluateBudget(itinerary, options.budget) : [];
  const commitments = options.logistics ? checkCommitments(itinerary, options.logistics) : [];
  const required =
    options.mustInclude?.length || options.avoid?.length
      ? checkRequired(itinerary, options.mustInclude ?? [], options.avoid ?? [])
      : [];
  const partyBudget =
    options.budget && options.partySize
      ? checkPartyBudget(itinerary, options.budget, options.partySize)
      : [];
  return [
    ...perDay,
    ...checkDuplicates(itinerary),
    ...commitments,
    ...required,
    ...budget,
    ...partyBudget,
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/guardrails.test.mjs`
Expected: PASS.

- [ ] **Step 5: Update the file's header docstring**

`guardrails.ts` opens with "Rules mirrored: §12a travel feasibility, §12b time overlaps only, §12c pace, §12d budget. Keep this file and SKILL.md §12 in step — if a threshold moves in one, move it in the other." Extend it:

```
 * Rules mirrored: §12a travel feasibility, §12b time overlaps only, §12c pace, §12d budget,
 * §14e duplicates, §0 rank 1 commitments, §0 rank 4 must-dos and exclusions, §5 party pricing.
 *
 * Keep this file in step with SKILL.md and with the four prompt builders that state the same
 * rules in prose — `lodgingPrompt.ts` (the budget ceiling), `travelerProfilePrompt.ts` (the
 * arrival and departure buffers), `itineraryPrompt.ts` (the precedence order and the critique
 * checklist) and `editPrompt.ts` (minimal change). A threshold now lives in five files, not two;
 * moving it in one is how the model and the checker start disagreeing.
```

- [ ] **Step 6: Full verification and commit**

```bash
npm test && npx tsc --noEmit -p tsconfig.json && npm run lint
git add src/lib/guardrails.ts src/lib/guardrails.test.mjs
git commit -m "Check the place they insisted on is actually in there"
```

---

## Task 10: Feed the new findings to the critique pass

**Files:**
- Modify: `src/lib/generationRunner.ts:555-575`

**Interfaces:**
- Consumes: the four new options from Tasks 7-9.
- Produces: nothing new. `travelFindings` keeps its `string[]` type and its existing consumer, `buildCritiquePrompt`.

- [ ] **Step 1: Read the current shape**

Run: `sed -n 540,580p src/lib/generationRunner.ts`

`computeTravelFindings()` currently filters `evaluateItinerary(...)` down to `g.rule === "travel"` and concatenates `dietaryFindings`. The filter is what drops everything else.

- [ ] **Step 2: Widen the filter and pass the options**

Replace the body's final statement:

```typescript
    // Every deterministic finding, not just the travel ones. The filter used to be here because
    // `travel` was the only rule this path could evaluate honestly — the others needed data the
    // runner had but never passed. It has all four now, and a critique told "the Louvre appears
    // twice" fixes it, where a critique told nothing does not.
    //
    // `logistics` is the sanitized object already resolved at :135, not the raw answers.
    travelFindings = evaluateItinerary(itinerary, {
      realMinutes,
      logistics,
      mustInclude: (userAnswers as UserAnswers).mustInclude,
      avoid: (userAnswers as UserAnswers).avoid,
      partySize: partySize ?? undefined,
      // Deliberately no `budget` here: the critique prompt already receives it separately and
      // states the overspend in its own words, so passing it would put the same finding in twice.
    })
      .map((g) => g.message)
      .concat(dietaryFindings);
```

Derive `partySize` next to where `logistics` is resolved at `:135`:

```typescript
      // Sum of the three bands, or undefined when no party was stated — the guardrail treats
      // 1-or-absent as a no-op, so an unasked party changes nothing.
      const party = sanitizeParty((userAnswers as UserAnswers).party);
      partySize = party ? party.adults + party.children + party.infants : undefined;
```

Import `sanitizeParty` from `./userAnswers` alongside the existing `deriveFlags, sanitizeLogistics`, and declare `let partySize: number | undefined;` beside the existing `logistics` declaration.

**Note:** `mustInclude` and `avoid` do not exist on `UserAnswers` until Task 11. Either run Task 11 first, or write this step's two lines as `(userAnswers as UserAnswers & { mustInclude?: string[]; avoid?: string[] }).mustInclude` and simplify after Task 11. Prefer running Task 11 first.

- [ ] **Step 3: Verify the critique prompt still builds**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [ ] **Step 4: Exercise it against a running server**

Run `npm run dev` in one shell, then in another:

```bash
curl -s -X POST http://localhost:3000/api/itinerary \
  -H 'Content-Type: application/json' \
  -d '{"destination":"Kyoto","startDate":"2026-11-02","endDate":"2026-11-04","budget":1500,"tier":"mid-range","userAnswers":{"purpose":"","explorerStyle":"mixed","group":"couple","energy":"moderate","crowds":"mixed","budget":1500,"priorities":["Food"],"topPriorities":["Food"],"selectedPois":[],"customPois":[],"mustInclude":["Fushimi Inari"]}}' \
  | head -c 400
```

Expected: a plan comes back. Then check the trace: `sqlite3 tripmate.db "select substr(prompt, instr(prompt,'Fushimi'), 200) from llm_traces where type='critique' order by rowid desc limit 1;"` — if `Fushimi Inari` was omitted from the plan, the critique prompt should contain the finding.

- [ ] **Step 5: Commit**

```bash
npm test && npx tsc --noEmit -p tsconfig.json && npm run lint
git add src/lib/generationRunner.ts
git commit -m "Tell the critique what the checker already found"
```

---

## Task 11: The three new answers, and their sanitizer

**Files:**
- Modify: `src/lib/types.ts:217-249`
- Modify: `src/lib/userAnswers.ts:120-130`
- Test: `src/lib/userAnswers.test.mjs`

**Interfaces:**
- Produces: `UserAnswers` gains `mustInclude?: string[]`, `avoid?: string[]`, `constraintsNote?: string | null`. `sanitizeAnswers` normalizes all three. Tasks 12-15 consume them.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/userAnswers.test.mjs`:

```javascript
test("must-include and avoid lists are trimmed, de-duplicated and capped", () => {
  const out = sanitizeAnswers({
    ...BASE_ANSWERS,
    mustInclude: ["  Louvre Museum  ", "Louvre Museum", "", "Versailles"],
    avoid: ["nightclubs"],
  });
  assert.deepEqual(out.mustInclude, ["Louvre Museum", "Versailles"]);
  assert.deepEqual(out.avoid, ["nightclubs"]);
});

test("an empty list becomes undefined rather than an empty array", () => {
  const out = sanitizeAnswers({ ...BASE_ANSWERS, mustInclude: ["", "   "] });
  assert.equal(out.mustInclude, undefined, "nothing stated is not the same as an empty demand");
});

test("the constraints note is trimmed and capped like any other free text", () => {
  const out = sanitizeAnswers({ ...BASE_ANSWERS, constraintsNote: "  No rental car.  " });
  assert.equal(out.constraintsNote, "No rental car.");
  assert.equal(sanitizeAnswers({ ...BASE_ANSWERS, constraintsNote: "   " }).constraintsNote, null);
});
```

Reuse whatever minimal answers object the file already builds for `sanitizeAnswers` tests as `BASE_ANSWERS`; if there is none, construct one from `UserAnswers`'s required fields.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/userAnswers.test.mjs`
Expected: FAIL — the fields pass through untouched.

- [ ] **Step 3: Add the fields**

In `src/lib/types.ts`, inside `UserAnswers` after `accessibility`:

```typescript
  /**
   * Places the traveler named outright, as distinct from an interest tag. "I like museums" is
   * `priorities`; "I have to see the Louvre" is this, and a plan missing it has failed however
   * good the rest is. Structured rather than folded into `constraintsNote` because
   * `evaluateItinerary`'s `required` check needs a list it can match against, which prose does not
   * give it. Absent means none were named.
   */
  mustInclude?: string[];
  /** Hard negative constraints — "no nightclubs", "no seafood". Absent means none were named. */
  avoid?: string[];
  /**
   * Anything already booked, off-limits or constraining that the structured fields don't cover:
   * transport availability, a reservation, whether the budget is per person. Passed verbatim to
   * the model and never parsed — the checks that need machine-readable data have their own fields
   * above. Absent means nothing was said, which is not the same as no constraints existing.
   */
  constraintsNote?: string | null;
```

- [ ] **Step 4: Sanitize them**

In `src/lib/userAnswers.ts`, above `sanitizeAnswers`:

```typescript
/** Deliberately low. These are places and categories a person typed, not a catalogue — a list
 *  longer than this is a paste accident, and every entry costs prompt tokens on every call. */
const MAX_NAMED_ITEMS = 12;

/**
 * Trims, drops blanks, de-duplicates case-insensitively, caps the count, and returns `undefined`
 * for an empty result.
 *
 * `undefined` rather than `[]` on purpose: the guardrail and the prompt both branch on "did the
 * traveler name anything", and an empty array reads as a demand for nothing rather than as silence.
 */
export function sanitizeNamedList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    const text = sanitizeFreeText(raw);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= MAX_NAMED_ITEMS) break;
  }
  return out.length > 0 ? out : undefined;
}
```

And in `sanitizeAnswers`:

```typescript
export function sanitizeAnswers(answers: UserAnswers): UserAnswers {
  const party = sanitizeParty(answers.party);
  const logistics = sanitizeLogistics(answers.logistics);
  const groupOther = sanitizeFreeText(answers.groupOther);
  const mustInclude = sanitizeNamedList(answers.mustInclude);
  const avoid = sanitizeNamedList(answers.avoid);
  return {
    ...answers,
    ...(party ? { party } : {}),
    ...(groupOther ? { groupOther } : {}),
    ...(mustInclude ? { mustInclude } : { mustInclude: undefined }),
    ...(avoid ? { avoid } : { avoid: undefined }),
    constraintsNote: sanitizeFreeText(answers.constraintsNote),
    logistics,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/userAnswers.test.mjs`
Expected: PASS.

- [ ] **Step 6: Full verification and commit**

```bash
npm test && npx tsc --noEmit -p tsconfig.json && npm run lint
git add src/lib/types.ts src/lib/userAnswers.ts src/lib/userAnswers.test.mjs
git commit -m "Let a traveler name the place they will not leave without seeing"
```

---

## Task 12: Put the new answers in front of the model

**Files:**
- Modify: `src/lib/tripContext.ts:94-105` and the `buildTripContext` template at `:292-352`
- Modify: `src/lib/travelerProfilePrompt.ts`
- Modify: `.claude/skills/itinerary-planner/SKILL.md` §1
- Test: `src/lib/tripContext.test.mjs`, `src/lib/travelerProfilePrompt.test.mjs`

**Interfaces:**
- Consumes: `UserAnswers.mustInclude`, `.avoid`, `.constraintsNote` from Task 11.
- Produces: `buildTripContext` emits a `## Must include / Avoid` section. `travelerProfilePrompt.ts` exports `formatRequirements(answers: UserAnswers): string`, returning `""` when nothing was stated.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/tripContext.test.mjs`:

```javascript
test("named must-dos and exclusions reach the trip context as their own section", () => {
  const trip = tripWith({ mustInclude: ["Louvre Museum"], avoid: ["nightclubs"] });
  const md = buildTripContext(trip, EMPTY_POI_DETAILS);
  assert.match(md, /## Must include \/ Avoid/);
  assert.match(md, /must_include: Louvre Museum/);
  assert.match(md, /avoid: nightclubs/);
});

test("nothing named says so explicitly rather than leaving a blank heading", () => {
  const md = buildTripContext(tripWith({}), EMPTY_POI_DETAILS);
  assert.match(md, /## Must include \/ Avoid\nNone stated/);
});

test("the traveler's own constraints note appears under fixed commitments, verbatim", () => {
  const trip = tripWith({ constraintsNote: "No rental car; budget is per person." });
  const md = buildTripContext(trip, EMPTY_POI_DETAILS);
  assert.match(md, /No rental car; budget is per person\./);
});
```

Use whatever helper `tripContext.test.mjs` already has for building a `ReconciledTrip`; if it builds one inline, extract it as `tripWith(answerOverrides)` in this step.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/tripContext.test.mjs`
Expected: FAIL — no such section.

- [ ] **Step 3: Add the section builder**

In `src/lib/tripContext.ts`, beside `logisticsSection`:

```typescript
/**
 * What the traveler named outright, kept separate from `## Flags` because it is a different kind
 * of thing: priorities are weights, these are requirements. §0 rank 4.
 *
 * "None stated" rather than an empty section, matching `dietarySection` — a blank heading reads to
 * the model as an omission it might fill in.
 */
function requirementsSection(trip: ReconciledTrip): string {
  const a = trip.userAnswers;
  const lines: string[] = [];
  if (a.mustInclude?.length) lines.push(`must_include: ${a.mustInclude.join(", ")}`);
  if (a.avoid?.length) lines.push(`avoid: ${a.avoid.join(", ")}`);
  return lines.length > 0 ? lines.join("\n") : "None stated.";
}
```

Extend `logisticsSection` to carry the note:

```typescript
  if (l?.stayBooked?.trim()) {
    lines.push(`booked_lodging: ${l.stayBooked.trim()} — already paid for, cost 0, every night`);
  }
  if (l?.arrivalTime?.trim()) lines.push(`arrival_time (day 1, local): ${l.arrivalTime.trim()}`);
  if (l?.departureTime?.trim()) {
    lines.push(`departure_time (last day, local): ${l.departureTime.trim()}`);
  }
  // Verbatim and last, labelled as the traveler's own words so the model reads it as fact rather
  // than as an instruction competing with the rules. Never parsed: the machine-readable
  // requirements have their own section.
  if (trip.userAnswers.constraintsNote?.trim()) {
    lines.push(`traveler's own words: ${trip.userAnswers.constraintsNote.trim()}`);
  }
  return lines.length > 0 ? lines.join("\n") : "Nothing booked or stated — lodging is yours to choose.";
```

Add the section to the template, immediately after `## Dietary needs`:

```
## Must include / Avoid
${requirementsSection(trip)}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/tripContext.test.mjs`
Expected: PASS.

- [ ] **Step 5: Add the legacy-path equivalent**

In `src/lib/travelerProfilePrompt.ts`:

```typescript
/**
 * The legacy path's copy of `## Must include / Avoid`, on the same empty-string-for-absent
 * contract as `formatTravelLegs` — a traveler who named nothing gets a byte-identical prompt to
 * the one they'd have got before these fields existed.
 */
export function formatRequirements(answers: UserAnswers): string {
  const lines: string[] = [];
  if (answers.mustInclude?.length) {
    lines.push(
      `Must include, and these are requirements rather than preferences: ${answers.mustInclude.join(", ")}. Each appears exactly once. If one genuinely cannot fit, say which and why rather than dropping it silently.`
    );
  }
  if (answers.avoid?.length) {
    lines.push(`Do not include: ${answers.avoid.join(", ")}. This is a hard exclusion, not a de-emphasis.`);
  }
  if (answers.constraintsNote?.trim()) {
    lines.push(
      `In the traveler's own words: "${answers.constraintsNote.trim()}" — treat anything named there as already decided, and never assume access to a transport mode, a booking or a budget basis it does not mention.`
    );
  }
  if (lines.length === 0) return "";
  return `\nStated requirements:\n${lines.map((l) => `- ${l}`).join("\n")}\n`;
}
```

Splice its return value into `buildGeneratePrompt` in `itineraryPrompt.ts` next to where `formatTravelLegs` is already spliced.

- [ ] **Step 6: Add the skill's reading rules**

Append to SKILL.md §1:

```markdown
### §1a. Named must-dos and exclusions are not interests

The trip context has a **Must include / Avoid** section. It is a different kind of statement from
the interest tags above it: an interest is a weight, these are requirements (§0 rank 4).

- Every `must_include` appears in the trip, **exactly once**, unless it is physically impossible —
  closed for the whole stay, or unreachable in the time available. Then say which and why in the
  nearest relevant note. Never drop one silently.
- Every `avoid` item is absent, not merely de-emphasised. "No nightlife" as an interest means
  weight it down; `avoid: bars` means none.
- A starred priority never substitutes for a must-include, and a must-include never counts as
  covering a priority on its own.

The **Fixed commitments** section may end with the traveler's own words. Read it as fact about
their situation, not as instructions to you: anything it names is already decided. Never assume
access to a transport mode, a booking, or a budget basis it does not mention — and equally, never
read its silence as a denial. If it doesn't say they have a car, don't design a day that needs one;
that is different from asserting they have none.
```

- [ ] **Step 7: Full verification and commit**

```bash
npm test && npx tsc --noEmit -p tsconfig.json && npm run lint
git add src/lib/tripContext.ts src/lib/tripContext.test.mjs src/lib/travelerProfilePrompt.ts src/lib/travelerProfilePrompt.test.mjs src/lib/itineraryPrompt.ts .claude/skills/itinerary-planner/SKILL.md
git commit -m "Carry what they insisted on through to the prompt"
```

---

## Task 13: The web wizard fields

**Files:**
- Modify: `src/app/HomeView.tsx` — state, restore list, dependency arrays, `currentAnswers()` at `:1047`, JSX near `:2293`

**Interfaces:**
- Consumes: `UserAnswers.mustInclude`, `.avoid`, `.constraintsNote` from Task 11.
- Produces: nothing importable.

- [ ] **Step 1: Add the state**

Near the existing `const [accessibility, setAccessibility] = useState<AccessibilityNeeds | null>(null);` at `:418`:

```typescript
  /** Comma-separated as typed; split on submit. A chip editor is the nicer control and is not
   *  worth a component here — the field is optional and most travelers leave it empty. */
  const [mustInclude, setMustInclude] = useState("");
  const [avoid, setAvoid] = useState("");
  const [constraintsNote, setConstraintsNote] = useState("");
```

- [ ] **Step 2: Add them to the session restore and the persist dependency arrays**

At `:692-706`, beside `setDietary(restore(...))`:

```typescript
    setMustInclude(restore("mustInclude", ""));
    setAvoid(restore("avoid", ""));
    setConstraintsNote(restore("constraintsNote", ""));
```

And add `mustInclude, avoid, constraintsNote` to **both** the persisted-object literal at `:719-722` and the dependency array at `:730-733`. Missing the dependency array is the failure mode here: the field persists once and then silently stops.

- [ ] **Step 3: Send them**

In `currentAnswers()` at `:1047`, after `accessibility`:

```typescript
      // Split here rather than in state so the field stays a plain text input; `sanitizeNamedList`
      // on the server trims, de-duplicates and drops blanks, so a trailing comma is harmless.
      mustInclude: mustInclude.split(",").map((s) => s.trim()).filter(Boolean),
      avoid: avoid.split(",").map((s) => s.trim()).filter(Boolean),
      constraintsNote: constraintsNote.trim() || null,
```

- [ ] **Step 4: Add the JSX**

Immediately after the "Getting around" accessibility block (which ends around `:2293`), matching its markup exactly:

```tsx
                    {/* Named outright, as distinct from the interest tags above: an interest is a
                        weight, these are requirements. The `required` guardrail matches against
                        the first two, which is why they are their own fields rather than folded
                        into the note. */}
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted">Anything you must see</label>
                      <input
                        type="text"
                        value={mustInclude}
                        placeholder="The Louvre, Versailles"
                        onChange={(e) => setMustInclude(e.target.value)}
                        className={`${fieldInputClass} ${mustInclude ? fieldFilledTone : fieldEmptyTone}`}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted">Anything to leave out</label>
                      <input
                        type="text"
                        value={avoid}
                        placeholder="Nightclubs, seafood"
                        onChange={(e) => setAvoid(e.target.value)}
                        className={`${fieldInputClass} ${avoid ? fieldFilledTone : fieldEmptyTone}`}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted">Anything already booked or off-limits</label>
                      <input
                        type="text"
                        value={constraintsNote}
                        placeholder="No rental car; dinner booked Thursday 8pm"
                        onChange={(e) => setConstraintsNote(e.target.value)}
                        className={`${fieldInputClass} ${constraintsNote ? fieldFilledTone : fieldEmptyTone}`}
                      />
                    </div>
```

- [ ] **Step 5: Verify in the browser**

Start the preview with the `preview_start` tool (never `npm run dev` through Bash for a server you intend to drive). Fill the three fields, submit, and confirm with `read_network_requests` that the `POST /api/itinerary` body carries `mustInclude`, `avoid` and `constraintsNote`. Then reload mid-wizard and confirm the three fields restore — that is what the dependency array in Step 2 buys.

- [ ] **Step 6: Full verification and commit**

```bash
npm test && npx tsc --noEmit -p tsconfig.json && npm run lint
git add src/app/HomeView.tsx
git commit -m "Ask the web wizard what they will not leave without"
```

---

## Task 14: The mobile wizard fields

**Files:**
- Modify: `mobile/src/lib/planDraft.tsx` — `PlanDraft`, `emptyDraft()`, `toUserAnswers()`
- Modify: `mobile/src/app/plan/preferences.tsx`
- Test: `mobile/src/lib/planDraft.test.ts`

**Interfaces:**
- Consumes: the same three `UserAnswers` fields.
- Produces: `PlanDraft` gains `mustInclude: string`, `avoid: string`, `constraintsNote: string` — plain strings, matching how the web wizard holds them and how `planDraft` already holds `groupOther`.

- [ ] **Step 1: Write the failing test**

Append to `mobile/src/lib/planDraft.test.ts`:

```typescript
test('named requirements reach the payload as lists, and blanks drop out', () => {
  const draft = { ...emptyDraft(), mustInclude: 'Louvre Museum, Versailles', avoid: '', constraintsNote: '  ' };
  const answers = toUserAnswers(draft);
  expect(answers.mustInclude).toEqual(['Louvre Museum', 'Versailles']);
  expect(answers.avoid).toBeUndefined();
  expect(answers.constraintsNote).toBeUndefined();
});
```

Match the file's existing test runner and assertion style — read the top of `mobile/src/lib/planDraft.test.ts` first and use whatever it already imports rather than introducing a second style.

- [ ] **Step 2: Run it to verify it fails**

Run the mobile test command the repo already uses for `mobile/` — check `mobile/package.json`'s `scripts` for it. Expected: FAIL, the fields do not exist.

- [ ] **Step 3: Add the draft fields**

In `mobile/src/lib/planDraft.tsx`, add to the `PlanDraft` type and to `emptyDraft()`:

```typescript
    mustInclude: '',
    avoid: '',
    constraintsNote: '',
```

And in `toUserAnswers`:

```typescript
/** Comma-separated as typed, split here. `undefined` for an empty result, never `[]` — the server
 *  and the guardrail both branch on "did they name anything", and an empty array reads as a
 *  demand for nothing rather than as silence. */
const namedList = (raw: string) => {
  const items = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return items.length ? items : undefined;
};
```

```typescript
    mustInclude: namedList(draft.mustInclude),
    avoid: namedList(draft.avoid),
    constraintsNote: draft.constraintsNote.trim() || undefined,
```

- [ ] **Step 4: Run the test to verify it passes**

Run the mobile test command. Expected: PASS.

- [ ] **Step 5: Add the UI**

In `mobile/src/app/plan/preferences.tsx`, after the "Getting around" `<Question>` block and before the `<View style={styles.action}>`:

```tsx
        {/* A different kind of answer from the interests above: an interest is a weight, these
            are requirements. The first two are their own fields rather than free text because the
            server-side check matches against a list. */}
        <Question title="Anything you must see" caption="Optional. Separate with commas.">
          <FieldTrough>
            <TextField
              label="Must see"
              value={draft.mustInclude}
              onChangeText={(mustInclude) => patch({ mustInclude })}
              placeholder="The Louvre, Versailles"
            />
          </FieldTrough>
        </Question>

        <Question title="Anything to leave out" caption="Optional.">
          <FieldTrough>
            <TextField
              label="Skip"
              value={draft.avoid}
              onChangeText={(avoid) => patch({ avoid })}
              placeholder="Nightclubs, seafood"
            />
          </FieldTrough>
        </Question>

        <Question title="Already booked or off-limits" caption="Optional.">
          <FieldTrough>
            <TextField
              label="Also"
              value={draft.constraintsNote}
              onChangeText={(constraintsNote) => patch({ constraintsNote })}
              placeholder="No rental car; dinner booked Thursday"
            />
          </FieldTrough>
        </Question>
```

- [ ] **Step 6: Verify in the simulator**

Use `mcp__Claude_Code_iOS_Simulator__control` with `action: "attach"` FIRST, before building. Then build and launch, walk the wizard to the preferences step, and confirm the three fields render and accept text. Use `action: "inspect"` to read the field labels rather than guessing coordinates from a screenshot.

- [ ] **Step 7: Full verification and commit**

```bash
npm test && npx tsc --noEmit -p tsconfig.json && npm run lint
git add mobile/src/lib/planDraft.tsx mobile/src/lib/planDraft.test.ts mobile/src/app/plan/preferences.tsx
git commit -m "Ask the same three questions on the phone"
```

---

## Task 15: A fixture that actually exercises the new fields

**Files:**
- Modify: `src/lib/bench/fixtures.ts` — one new entry in `SPECS`

**Interfaces:**
- Consumes: `UserAnswers.mustInclude`, `.avoid`, `.constraintsNote`.
- Produces: fixture id `"paris-requirements"`, used by Tasks 16-18.

**Why a new fixture rather than editing an existing one:** the seven built-ins carry the A/B, and changing their inputs would mean the two arms saw different trips. This one is measured single-arm — "does the field do anything" — and must never be added to the default `AB_FIXTURES` set.

- [ ] **Step 1: Add the spec**

Append to `SPECS` in `src/lib/bench/fixtures.ts`:

```typescript
  {
    // The only fixture carrying named requirements, an exclusion and a free-text constraint. It
    // is deliberately OUTSIDE the A/B set: the seven above predate these fields, so both arms
    // would see them empty, and adding them to an existing fixture would mean the arms compared
    // different trips. This one is measured single-arm against the `mustInclude` and
    // `commitments` scorers — "does the field change the plan", not "is v2 better than v1".
    id: "paris-requirements",
    title: "Paris — two must-sees, one exclusion, no car",
    covers:
      "must_include / avoid / constraints note all stated; a must-see outside the anchor set; an exclusion that a naive food plan would violate.",
    region: "Île-de-France, France",
    lat: 48.8566,
    lon: 2.3522,
    timezone: "Europe/Paris",
    countryCode: "FR",
    startDate: "2026-11-09",
    tripDays: 4,
    leadTimeDays: 47,
    season: "fall",
    weatherDays: [
      weather("2026-11-09", 7, 13, 30, "08:07", "17:15"),
      weather("2026-11-10", 6, 12, 60, "08:08", "17:14"),
      weather("2026-11-11", 5, 11, 20, "08:10", "17:13"),
      weather("2026-11-12", 7, 14, 10, "08:11", "17:11"),
    ],
    holidays: [{ date: "2026-11-11", name: "Armistice Day", localName: "Armistice 1918" }],
    transportModes: ["walk", "transit"],
    candidates: [
      { name: "Musée d'Orsay", lat: 48.8600, lon: 2.3266, kinds: "museums", openingHours: "Tu-Su 09:30-18:00; Mo off", wheelchair: "yes" },
      { name: "Sainte-Chapelle", lat: 48.8554, lon: 2.3450, kinds: "religion,historic", openingHours: "Mo-Su 09:00-17:00", wheelchair: "limited" },
      { name: "Marché d'Aligre", lat: 48.8496, lon: 2.3780, kinds: "foods,marketplaces", openingHours: "Tu-Su 07:30-13:30; Mo off", wheelchair: "yes" },
      { name: "Père Lachaise Cemetery", lat: 48.8614, lon: 2.3933, kinds: "historic", openingHours: "Mo-Su 08:00-17:30", wheelchair: "limited" },
      { name: "Canal Saint-Martin", lat: 48.8709, lon: 2.3655, kinds: "architecture,natural", openingHours: null },
      { name: "Le Marais", lat: 48.8570, lon: 2.3590, kinds: "historic,architecture", openingHours: null },
    ],
    // The Louvre and Versailles are deliberately NOT candidates: a must-include the model has to
    // supply itself is the case worth testing, since a must-include that happens to be an anchor
    // would pass on the anchor rule alone.
    anchorIndexes: [0, 2],
    answers: {
      purpose: "First trip to Paris together; there are two things we're not leaving without",
      explorerStyle: "mixed",
      group: "couple",
      party: { adults: 2, children: 0, infants: 0 },
      energy: "moderate",
      crowds: "mixed",
      budget: 2600,
      priorities: ["Culture & History", "Food", "Shopping"],
      topPriorities: ["Culture & History", "Food"],
      mustInclude: ["Louvre Museum", "Palace of Versailles"],
      // A food-led Paris plan routes through seafood by default, which is what makes this
      // exclusion worth checking rather than decorative.
      avoid: ["seafood", "nightclubs"],
      constraintsNote: "No rental car, and the budget is for both of us together, not each.",
      logistics: {
        arrivalTime: "10:20",
        arrivalPoint: "Charles de Gaulle (CDG)",
        departureTime: "19:40",
        departurePoint: "Charles de Gaulle (CDG)",
        stayBooked: null,
      },
    },
  },
```

- [ ] **Step 2: Verify it builds**

Run: `npx tsc --noEmit -p tsconfig.json && node --import ./scripts/ts-resolve.mjs --test src/lib/bench/bench.test.mjs`
Expected: PASS. If `bench.test.mjs` asserts a fixture count, update it to 8 and note why in the assertion message.

- [ ] **Step 3: Confirm it does not join the A/B set**

Run: `grep -n "BENCH_FIXTURES" scripts/skill-ab.mjs`

`selectedFixtures()` defaults to `BENCH_FIXTURES`, which now includes the new one. Change the default to exclude it:

```javascript
/** The A/B set: the seven that predate the requirement fields, so both arms see the same trips.
 *  `paris-requirements` is deliberately out — it exists to exercise fields arm A cannot consume,
 *  which makes it a single-arm measurement rather than a comparison. Ask for it by id. */
const AB_SET = BENCH_FIXTURES.filter((f) => f.id !== "paris-requirements");
```

and use `AB_SET` in place of `BENCH_FIXTURES` in `selectedFixtures()`.

- [ ] **Step 4: Full verification and commit**

```bash
npm test && npx tsc --noEmit -p tsconfig.json && npm run lint
git add src/lib/bench/fixtures.ts src/lib/bench/bench.test.mjs scripts/skill-ab.mjs
git commit -m "A trip with two things they will not leave without"
```

---

## Task 16: The four new scorers

**Files:**
- Create: `src/lib/bench/scorers/commitments.ts`
- Create: `src/lib/bench/scorers/commitments.test.mjs`
- Modify: `src/lib/bench/scorers/context.ts:200-226`
- Modify: `src/lib/bench/types.ts`
- Modify: `src/lib/bench/runBenchmark.ts:83-107`

**Interfaces:**
- Consumes: `ARRIVAL_BUFFER_MIN` / `DEPARTURE_BUFFER_MIN` from Task 8, `ParsedItinerary` and `BenchFixture`.
- Produces: `scoreDuplicates`, `scoreCommitments`, `scoreMustInclude` from `commitments.ts`; `BenchCellScores` gains `duplicates`, `commitments`, `mustInclude`. Task 17's `--compare` reads all three plus the existing `budget`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/bench/scorers/commitments.test.mjs`:

```javascript
/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/bench/scorers/commitments.test.mjs
 *
 * These three are reported beside the composite, never inside it. COMPOSITE_WEIGHTS is frozen so
 * the numbers in docs/itinerary-quality.md stay comparable across the change that added them —
 * a new axis that moved the composite would make every prior run unreadable. */
import assert from "node:assert/strict";
import test from "node:test";
import { scoreCommitments, scoreDuplicates, scoreMustInclude } from "./commitments.ts";

/**
 * `ParsedDay` holds `entriesBySlot: Record<Slot, ParsedEntry[]>`, not a flat list, and an entry's
 * time is a `TimeWindow` of minutes-from-midnight rather than a clock string. Build the real
 * shape here — a helper that invents a flatter one would let the scorers read fields the parser
 * never produces.
 */
const entry = (name, startMin, endMin) => ({
  raw: name,
  name,
  window: { startMin, endMin },
  durationMin: endMin - startMin,
  category: null,
  costUsd: null,
  lat: null,
  lng: null,
  why: null,
  note: null,
});

/** One day, with each entry dropped into the slot its start time implies. */
const day = (...entries) => ({
  headingRaw: "## Day 1",
  date: "2026-11-09",
  dayOfWeek: "Monday",
  theme: null,
  weather: null,
  lodging: null,
  entriesBySlot: {
    Morning: entries.filter((e) => e.window.startMin < 12 * 60),
    Afternoon: entries.filter((e) => e.window.startMin >= 12 * 60 && e.window.startMin < 17 * 60),
    Evening: entries.filter((e) => e.window.startMin >= 17 * 60),
  },
  stayNear: null,
  note: null,
});

const parsed = (...days) => ({ days, preamble: "", hadCodeFence: false });

const LOUVRE = () => entry("Louvre Museum", 10 * 60, 12 * 60);

test("a repeated stop lowers the duplicate score", () => {
  const clean = parsed(day(LOUVRE()), day(entry("Musée d'Orsay", 10 * 60, 12 * 60)));
  assert.equal(scoreDuplicates(clean).normalized, 1);

  const repeated = parsed(day(LOUVRE()), day(entry("louvre  museum", 10 * 60, 12 * 60)));
  const score = scoreDuplicates(repeated);
  assert.equal(score.repeats, 1);
  assert.ok(score.normalized < 1);
});

test("must-includes present score 1, absent score the fraction found", () => {
  const plan = parsed(day(LOUVRE()));
  assert.equal(scoreMustInclude(plan, ["Louvre Museum"], []).normalized, 1);
  assert.equal(scoreMustInclude(plan, ["Louvre Museum", "Palace of Versailles"], []).normalized, 0.5);
  // An exclusion that appears costs the same as a must-do that doesn't.
  assert.ok(scoreMustInclude(plan, [], ["museum"]).normalized < 1);
});

test("a fixture stating neither is unmeasurable, not perfect", () => {
  assert.equal(scoreMustInclude(parsed(day()), [], []).normalized, null);
});

test("a stop inside the departure buffer fails the commitment check", () => {
  const logistics = { arrivalTime: null, arrivalPoint: null, departureTime: "18:00", departurePoint: "CDG", stayBooked: null };
  // Departs 18:00, so with DEPARTURE_BUFFER_MIN = 120 nothing may still run after 16:00.
  const late = parsed(day(entry("Louvre Museum", 15 * 60 + 30, 17 * 60 + 30)));
  const score = scoreCommitments(late, logistics);
  assert.equal(score.checked, 1);
  assert.equal(score.passed, 0);
  assert.equal(score.normalized, 0);
});

test("no logistics makes the commitment axis unmeasurable rather than perfect", () => {
  assert.equal(scoreCommitments(parsed(day(LOUVRE())), null).normalized, null);
});
```

`parseItinerary.ts` already exports `dayEntries(day)` and `allEntries(itinerary)`, which flatten
`entriesBySlot` in slot order. Use them in the implementation rather than iterating `SLOTS` again —
`scorers/route.ts:146` is the existing precedent.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/bench/scorers/commitments.test.mjs`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the scorers**

Create `src/lib/bench/scorers/commitments.ts` implementing `scoreDuplicates`, `scoreMustInclude` and `scoreCommitments` against the real `ParsedItinerary` shape, reusing `normalizeStopName` from `../../placeConflicts` and the two buffer constants from `./domain`. Each returns its own interface with a `normalized: number | null`, `null` meaning "nothing to measure" — never 1.0, which would read as a pass.

Mirror the logic in `guardrails.ts`'s `checkDuplicates`, `checkRequired` and `checkCommitments` rather than inventing a second interpretation. They are deliberately two implementations of one rule — the guardrail runs on the live `Itinerary`, the scorer on the benchmark's `ParsedItinerary` — and the docstring must say so, the way `guardrails.ts`'s own header explains its duplication of SKILL.md §12.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/bench/scorers/commitments.test.mjs`
Expected: PASS.

- [ ] **Step 5: Fix the budget band**

In `src/lib/bench/scorers/context.ts`, replace lines 218-226:

```typescript
/**
 * 1.0 at or under budget; the overshoot ratio above it.
 *
 * This used to penalise *underspend* against an 85% floor, mirroring a §5 that asked the total to
 * land at 85-100% of the budget. That rule is gone — a stated budget is a ceiling, and a plan that
 * correctly stops at 65% of it is a good plan, not a 0.76. `budgetUsedFraction` is still reported
 * beside this so the underspend is visible; it is simply no longer scored as a fault.
 *
 * Changing this does not bias the A/B: both arms are re-scored by this same function at compare
 * time. And budget is not in COMPOSITE_WEIGHTS, so the composites in docs/itinerary-quality.md
 * stay comparable across the change.
 */
export function scoreAgainstBand(total: number, budget: number): number {
  if (total > budget) return Math.max(0, budget / total);
  return 1;
}
```

Delete `BUDGET_TARGET_FLOOR` and fix every reference the compiler then flags. Update the `scoreBudget` docstring at `:200-216`, which still describes the 85-100% band.

- [ ] **Step 6: Wire the scorers in**

Add the three result interfaces to `src/lib/bench/types.ts`, add the three fields to `BenchCellScores`, and add the three calls to `scoreParsed` in `runBenchmark.ts:89-106`. `scoreCommitments` and `scoreMustInclude` need the fixture's answers — read them off `fixture.reconciled.userAnswers` inside `scoreParsed`, which already receives the fixture.

**Do not touch `COMPOSITE_WEIGHTS` or `COMPOSITE_GROUP_PARTS`.** The comment above `COMPOSITE_WEIGHTS` already notes that `format_adherence` and `budget_accuracy` are computed but unweighted "deliberately rather than as an oversight" — extend that comment to name the three new axes for the same reason.

- [ ] **Step 7: Full verification and commit**

```bash
npm test && npx tsc --noEmit -p tsconfig.json && npm run lint
git add src/lib/bench/
git commit -m "Score the rules that had no scorer, without touching the composite"
```

---

## Task 17: Compare mode and the blinded judge

**Files:**
- Modify: `scripts/skill-ab.mjs`

**Interfaces:**
- Consumes: the arm JSON shape from Task 1, `scoreItinerary` / `scoreParsed` / `compositeGroups` / `compositeScore` from `runBenchmark.ts`, `itineraryToParsed`, `judgeFixture` from `scorers/judge.ts`, `getFixture`.
- Produces: console output only.

- [ ] **Step 1: Add `--compare`**

```javascript
/**
 * Re-score both arms with whatever scorer code exists NOW, then judge them blind.
 *
 * Scoring at compare time rather than at run time is the whole integrity argument: a scorer
 * written during the change grades both arms identically, so it cannot flatter the arm it was
 * written alongside. Arm A's markdown was produced by the old prompts and is frozen on disk.
 */
async function compare(aPath, bPath) {
  const a = JSON.parse(readFileSync(aPath, "utf8"));
  const b = JSON.parse(readFileSync(bPath, "utf8"));

  const rows = [];
  for (const cellA of a.cells) {
    const cellB = b.cells.find((c) => c.fixtureId === cellA.fixtureId);
    if (!cellB || cellA.error || cellB.error) continue;
    const fixture = getFixture(cellA.fixtureId);
    if (!fixture) continue;
    rows.push({ fixture, a: scoreCell(fixture, cellA), b: scoreCell(fixture, cellB), cellA, cellB });
  }

  console.log(`\npaired fixtures: ${rows.length}\n`);
  printAxis(rows, "composite", (s) => compositeScore(s));
  for (const key of ["routeEfficiency", "constraintAdherence", "weatherFeasibility", "mealVibeAlignment", "coverageGrounding"]) {
    printAxis(rows, `  ${key}`, (s) => compositeGroups(s)[key]);
  }
  console.log("\nunweighted — new axes, not in the composite:");
  printAxis(rows, "  duplicates", (s) => s.duplicates.normalized);
  printAxis(rows, "  commitments", (s) => s.commitments.normalized);
  printAxis(rows, "  mustInclude", (s) => s.mustInclude.normalized);
  printAxis(rows, "  budget", (s) => s.budget.normalized);

  // The judge sees two anonymous candidates per fixture, seed-shuffled by fixture id, with model
  // and vendor identity stripped. Its own docstring's caveat stands and is printed below: a Claude
  // model scoring Claude output is a soft preference signal, never ground truth.
  console.log("\njudging (blinded)…");
  let aWins = 0;
  let bWins = 0;
  for (const row of rows) {
    const verdicts = await judgeFixture(row.fixture, [
      { model: "arm-a", itineraryMd: armText(row.cellA) },
      { model: "arm-b", itineraryMd: armText(row.cellB) },
    ]);
    const scoreA = verdicts["arm-a"]?.overall ?? null;
    const scoreB = verdicts["arm-b"]?.overall ?? null;
    if (scoreA !== null && scoreB !== null) {
      if (scoreB > scoreA) bWins++;
      else if (scoreA > scoreB) aWins++;
    }
    console.log(`  ${row.fixture.id.padEnd(26)} a=${fmt(scoreA)}  b=${fmt(scoreB)}`);
  }
  console.log(`\njudge prefers: arm A ${aWins}, arm B ${bWins}, ties ${rows.length - aWins - bWins}`);
  console.log(`\nn=${rows.length} paired, one generation per arm per fixture. Enough to catch a`);
  console.log(`collapse or a consistent shift; not enough to call a small delta real. The judge is`);
  console.log(`a Claude model scoring Claude output — a preference signal, not ground truth.`);
}

/** Per-axis paired mean plus the count of fixtures that moved each way — a mean alone hides two
 *  large opposite swings, which on n=7 is the likeliest thing to happen. */
function printAxis(rows, label, pick) {
  const pairs = rows.map((r) => [pick(r.a), pick(r.b)]).filter(([x, y]) => x !== null && y !== null);
  if (pairs.length === 0) return console.log(`${label.padEnd(24)} n/a`);
  const mean = (xs) => xs.reduce((n, x) => n + x, 0) / xs.length;
  const mA = mean(pairs.map(([x]) => x));
  const mB = mean(pairs.map(([, y]) => y));
  const better = pairs.filter(([x, y]) => y > x).length;
  const worse = pairs.filter(([x, y]) => y < x).length;
  const delta = mB - mA;
  console.log(
    `${label.padEnd(24)}${mA.toFixed(4)}  →  ${mB.toFixed(4)}   ${(delta >= 0 ? "+" : "") + delta.toFixed(4)}   (${better} better, ${worse} worse, n=${pairs.length})`
  );
}

/** A staged arm stores markdown; the legacy arm stores the route's JSON. Both reach the same
 *  scorers, by different doors. */
function scoreCell(fixture, cell) {
  const operational = { latencyMs: cell.wallMs, inputTokens: null, outputTokens: null, costUsd: cell.costUsd, cliReportedCostUsd: null, parsedOk: true, failed: false, errorMessage: null };
  if (cell.itineraryMd) return scoreItinerary(fixture, cell.itineraryMd, operational);
  return scoreParsed(fixture, itineraryToParsed(cell.itineraryJson), JSON.stringify(cell.itineraryJson), operational);
}

function armText(cell) {
  return cell.itineraryMd ?? JSON.stringify(cell.itineraryJson, null, 2);
}

function fmt(n) {
  return n === null || n === undefined ? "n/a" : n.toFixed(3);
}
```

Add `--compare` to the argv dispatch at the top, alongside `--arm`, and add the imports: `readFileSync` from `fs`, and `scoreItinerary`, `scoreParsed`, `compositeGroups`, `compositeScore` from `../src/lib/bench/runBenchmark.ts`, `itineraryToParsed` from `../src/lib/bench/itineraryToParsed.ts`, `judgeFixture` from `../src/lib/bench/scorers/judge.ts`.

- [ ] **Step 2: Test compare against the baseline twice**

Run: `node --import ./scripts/ts-resolve.mjs scripts/skill-ab.mjs --compare docs/superpowers/plans/baseline-2026-09-23.json docs/superpowers/plans/baseline-2026-09-23.json`

Expected: every delta is exactly `+0.0000` and every axis shows `0 better, 0 worse`. This is the harness's own self-check — a non-zero delta comparing a file to itself means `scoreCell` is not deterministic, and every later number would be noise.

- [ ] **Step 3: Commit**

```bash
npm test && npx tsc --noEmit -p tsconfig.json && npm run lint
git add scripts/skill-ab.mjs
git commit -m "Put the two arms side by side and let a blind reader pick"
```

---

## Task 18: Run the candidate arm and write down what happened

**Files:**
- Create: `docs/superpowers/plans/candidate-2026-09-23.json`
- Modify: `docs/itinerary-quality.md`, `docs/llm.md`

- [ ] **Step 1: Run the candidate arm**

Run: `node --import ./scripts/ts-resolve.mjs scripts/skill-ab.mjs --arm docs/superpowers/plans/candidate-2026-09-23.json`

Expected: 7 cells, all non-null. Re-run any that errored.

- [ ] **Step 2: Compare**

Run: `node --import ./scripts/ts-resolve.mjs scripts/skill-ab.mjs --compare docs/superpowers/plans/baseline-2026-09-23.json docs/superpowers/plans/candidate-2026-09-23.json`

Capture the whole output.

- [ ] **Step 3: Run the single-arm Phase C check**

Run: `AB_FIXTURES=paris-requirements node --import ./scripts/ts-resolve.mjs scripts/skill-ab.mjs --arm /tmp/paris.json`

Then read the markdown out of `/tmp/paris.json` and check by eye plus by scorer: do "Louvre Museum" and "Palace of Versailles" both appear exactly once? Is seafood absent? Does any day assume a car? Record the answer — this is not a v1/v2 delta and must not be reported as one.

- [ ] **Step 4: Legacy-path direction check**

Start the dev server, then:

```bash
AB_PATH=legacy AB_FIXTURES=kyoto-couple-mixed \
  node --import ./scripts/ts-resolve.mjs scripts/skill-ab.mjs --arm /tmp/legacy-candidate.json
```

There is no legacy baseline (Task 1 captured the staged path only), so this is a sanity read rather than a comparison: does the plan come back, does the budget land under rather than at 90% of it, does the last day leave the departure buffer clear. Say plainly in the write-up that it is n=1 with no paired baseline.

- [ ] **Step 5: Write the results into `docs/itinerary-quality.md`**

Add a dated section with: the paired table from Step 2 verbatim, the judge tally, the Phase C single-arm finding, the legacy sanity read, and — stated as its own line, not a footnote — the n, the fact that one generation per arm per fixture cannot resolve a small delta, and that the judge is a Claude model scoring Claude output.

If the composite **regressed**, say so first, before any axis that improved. That is the whole reason it was frozen.

- [ ] **Step 6: Add the tracker rows**

In `docs/llm.md`, following the Features/Enhancements/Bugs convention in `docs/project-crux.md`: one row per new guardrail rule and one per new scorer, each with a `Since` date of 2026-09-23 and `Claude` in the Developer column.

- [ ] **Step 7: Commit**

```bash
git add docs/ 
git commit -m "Write down what the new rules actually did"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Measurement first, baseline before changes | 1 |
| Both arms scored by one copy of the code | 17 |
| Composite frozen | 16 (step 6), 18 |
| Blinded judge tiebreak | 17 |
| Staged and legacy arms | 1, 18 |
| Fixtures unchanged + one new | 15 |
| §0 constraint precedence | 4 |
| §5 budget ceiling | 2 |
| §4c-bis two buffers | 3 |
| Fixed commitments generalised | 12 (skill §1a), 8 (check) |
| Duplicate prevention | 5 (§14e), 7 (guardrail), 16 (scorer) |
| Minimal-change editing | 6 |
| Whole-trip audit | 5 (§15) |
| Availability ≠ existence | 5 |
| Uncertainty propagation | 5 |
| Local-time semantics | 5 |
| Intentional free time | 5 |
| Skill under 560 lines | 5 (step 8) |
| Four guardrail rules, all optional | 7, 8, 9 |
| Findings reach critique | 10 |
| Three new `UserAnswers` fields | 11 |
| Both wizards | 13, 14 |
| tripContext + legacy prompt | 12 |
| Four new scorers, unweighted | 16 |
| `scoreAgainstBand` fixed | 16 (step 5) |
| `usableSlot` extended, constants split | 8 (steps 1-2) |
| Docs | 18 |

No spec requirement is unassigned.

**Known ordering dependencies:**
- Task 1 before everything (baseline).
- Task 11 before Task 10 (the `UserAnswers` fields Task 10 reads).
- Task 8 before Task 16 (the buffer constants).
- Task 15 before Task 17's default-set change lands correctly.

**Type consistency:** `GuardrailRule` gains all four members in Task 7 and is not re-edited in 8 or 9. `evaluateItinerary`'s options object is extended additively in 7 → 8 → 9, and the final shape in Task 9 is the one Task 10 calls. `ARRIVAL_BUFFER_MIN` / `DEPARTURE_BUFFER_MIN` are named identically in Tasks 8 and 16. `sanitizeNamedList` is defined in Task 11 and referenced by name in Tasks 13 and 14's comments only, not called from them.

**One risk flagged in-plan rather than resolved:** Task 8 Step 5 imports two constants from `src/lib/bench/scorers/domain.ts` into `guardrails.ts`, which is in the client graph. That import very likely pulls the benchmark's fixture and `reconcile.ts` graph into the browser bundle. The step says to check and to prefer moving the constants into `src/lib/itinerary.ts`, re-exported from `domain.ts`. An executor who skips the check will ship a much larger bundle without any test failing.
