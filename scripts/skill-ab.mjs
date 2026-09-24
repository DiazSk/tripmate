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
import { readFileSync, writeFileSync } from "fs";

import { BENCH_FIXTURES, getFixture } from "../src/lib/bench/fixtures.ts";
import { benchUserAnswers } from "../src/lib/bench/refineTasks.ts";
import { benchTimeoutMs } from "../src/lib/bench/models.ts";
import { generateItinerary } from "../src/lib/generateItinerary.ts";
import { getRunSteps } from "../src/lib/db.ts";
import { closestTier } from "../src/lib/tiers.ts";
import {
  compositeGroups,
  compositeScore,
  scoreItinerary,
  scoreParsed,
} from "../src/lib/bench/runBenchmark.ts";
import { itineraryToParsed } from "../src/lib/bench/itineraryToParsed.ts";
import { judgeFixture } from "../src/lib/bench/scorers/judge.ts";

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

async function runArm(out) {
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
}

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
    // A cell may carry `itineraryMd: null` plus an `error` string (Task 17 brief ruling 5) —
    // unpaired or errored fixtures are skipped rather than scored as zero or crashing scoreCell.
    if (!cellB || cellA.error || cellB.error) continue;
    const fixture = getFixture(cellA.fixtureId);
    if (!fixture) continue;
    rows.push({ fixture, a: scoreCell(fixture, cellA), b: scoreCell(fixture, cellB), cellA, cellB });
  }

  console.log(`\npaired fixtures: ${rows.length}/${a.cells.length}\n`);
  printAxis(rows, "composite", (s) => compositeScore(s));
  for (const key of ["routeEfficiency", "constraintAdherence", "weatherFeasibility", "mealVibeAlignment", "coverageGrounding"]) {
    printAxis(rows, `  ${key}`, (s) => compositeGroups(s)[key]);
  }
  console.log("\nunweighted — new axes, not in the composite:");
  printAxis(rows, "  duplicates", (s) => s.duplicates.normalized, "duplicates");
  printAxis(rows, "  commitments", (s) => s.commitments.normalized, "commitments");
  printAxis(rows, "  mustInclude", (s) => s.mustInclude.normalized, "mustInclude");
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

/** Raw integer fields behind the three axes the composite doesn't cover — see Task 17 brief
 *  ruling 1. Field names read off `src/lib/bench/scorers/commitments.ts` and the interfaces in
 *  `src/lib/bench/types.ts`, not guessed: `DuplicateScore.repeats`/`checkedStops`,
 *  `CommitmentScore.breaches`/`checked`, `MustIncludeScore.includedCount`+`respectedCount`/`checked`. */
const RAW_EXTRACTORS = {
  duplicates: (s) => ({ label: "repeats", got: s.duplicates.repeats, of: s.duplicates.checkedStops, ofLabel: "checked" }),
  commitments: (s) => ({ label: "breaches", got: s.commitments.breaches.length, of: s.commitments.checked, ofLabel: "checked" }),
  mustInclude: (s) => ({
    label: "covered",
    got: s.mustInclude.includedCount + s.mustInclude.respectedCount,
    of: s.mustInclude.checked,
    ofLabel: "total",
  }),
};

/** Per-axis paired mean plus the count of fixtures that moved each way — a mean alone hides two
 *  large opposite swings, which on n=7 is the likeliest thing to happen.
 *
 *  A fixture only counts as "measurable" for an axis when BOTH arms produced a non-null
 *  `normalized` for it — `null` means the fixture stated nothing to check (§0 mustInclude/avoid,
 *  §0 logistics), not that the rule scored zero. Printing a blank cell for that reads as "the rule
 *  changed nothing", which is the exact misreading this report exists to prevent (Task 17 brief
 *  ruling 2) — so an all-unmeasurable axis says so loudly, and every axis states its measurable
 *  count out of the total paired fixtures, not just the ones with nothing to show. */
function printAxis(rows, label, pick, rawKey) {
  const total = rows.length;
  const pairs = rows.filter((r) => pick(r.a) !== null && pick(r.b) !== null);
  if (pairs.length === 0) {
    console.log(`${label.padEnd(24)}n/a — unmeasurable on 0/${total} fixtures (nothing stated to check)`);
    return;
  }
  const mean = (xs) => xs.reduce((n, x) => n + x, 0) / xs.length;
  const mA = mean(pairs.map((r) => pick(r.a)));
  const mB = mean(pairs.map((r) => pick(r.b)));
  const better = pairs.filter((r) => pick(r.b) > pick(r.a)).length;
  const worse = pairs.filter((r) => pick(r.b) < pick(r.a)).length;
  const delta = mB - mA;
  console.log(
    `${label.padEnd(24)}${mA.toFixed(4)}  →  ${mB.toFixed(4)}   ${(delta >= 0 ? "+" : "") + delta.toFixed(4)}   (${better} better, ${worse} worse, measurable on ${pairs.length}/${total})`
  );
  if (rawKey) {
    const extract = RAW_EXTRACTORS[rawKey];
    const meta = extract(pairs[0].a);
    const sum = (side, field) => pairs.reduce((n, r) => n + extract(side === "a" ? r.a : r.b)[field], 0);
    console.log(
      `${"".padEnd(24)}  ${meta.label} ${sum("a", "got")}→${sum("b", "got")}  (of ${sum("a", "of")}→${sum("b", "of")} ${meta.ofLabel}, summed over the ${pairs.length} measurable fixture(s))`
    );
  }
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

const mode = process.argv[2];
if (mode === "--arm") {
  const out = process.argv[3];
  if (!out) {
    console.error("usage: skill-ab.mjs --arm <out.json>");
    process.exit(1);
  }
  await runArm(out);
} else if (mode === "--compare") {
  const [aPath, bPath] = [process.argv[3], process.argv[4]];
  if (!aPath || !bPath) {
    console.error("usage: skill-ab.mjs --compare <a.json> <b.json>");
    process.exit(1);
  }
  await compare(aPath, bPath);
} else {
  console.error("usage: skill-ab.mjs --arm <out.json> | --compare <a.json> <b.json>");
  process.exit(1);
}
