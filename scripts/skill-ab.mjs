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
import { benchTimeoutMs } from "../src/lib/bench/models.ts";
import { generateItinerary } from "../src/lib/generateItinerary.ts";
import { getRunSteps } from "../src/lib/db.ts";
import { closestTier } from "../src/lib/tiers.ts";

const BASE = process.env.AB_BASE_URL ?? "http://localhost:3000";
const PATH_KIND = process.env.AB_PATH ?? "staged";

/** The A/B set: the seven that predate the requirement fields, so both arms see the same trips.
 *  `paris-requirements` is deliberately out — it exists to exercise fields arm A cannot consume,
 *  which makes it a single-arm measurement rather than a comparison. Ask for it by id. */
const AB_SET = BENCH_FIXTURES.filter((f) => f.id !== "paris-requirements");

/** The A/B set by default. Those seven frozen fixtures are what the composite in
 *  docs/itinerary-quality.md is scored against, so an arm over a different set is not comparable. */
function selectedFixtures() {
  const ids = process.env.AB_FIXTURES?.split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids || ids.length === 0) return AB_SET;
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
    // Not the default `itineraryTimeoutMs(days)` — that ceiling is tuned for the production
    // model/latency profile, not a benchmark run, and two fixtures were killed at exactly that
    // ceiling (310000ms / 306000ms) on the first baseline pass. `runBenchCell` in
    // runBenchmark.ts hit the same failure mode first and already fixed it by passing
    // `benchTimeoutMs()` (900s, overridable via BENCH_TIMEOUT_MS) instead.
    timeoutMs: benchTimeoutMs(),
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
