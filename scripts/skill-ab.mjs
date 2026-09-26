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
 *
 * **Repeats.** `AB_RUNS=3` generates each fixture three times. One run is a direction; three
 * show whether a rule holds or merely held once. `--report arm.json` prints mean, worst, and how
 * many runs broke a hard rule, per fixture, with the critical-trip failure rate as the headline.
 *
 *   AB_PATH=legacy AB_RUNS=3 node --import ./scripts/ts-resolve.mjs scripts/skill-ab.mjs --arm legacy.json
 *   node --import ./scripts/ts-resolve.mjs scripts/skill-ab.mjs --report legacy.json
 */
import { readFileSync, writeFileSync } from "fs";

import { BENCH_FIXTURES, getFixture } from "../src/lib/bench/fixtures.ts";
import { benchUserAnswers } from "../src/lib/bench/refineTasks.ts";
import { benchTimeoutMs } from "../src/lib/bench/models.ts";
import { generateItinerary } from "../src/lib/generateItinerary.ts";
import { getGeneration, getRunSteps } from "../src/lib/db.ts";
import { closestTier } from "../src/lib/tiers.ts";
import {
  compositeGroups,
  compositeScore,
  scoreItinerary,
  scoreParsed,
} from "../src/lib/bench/runBenchmark.ts";
import { itineraryToParsed } from "../src/lib/bench/itineraryToParsed.ts";
import { judgeFixture } from "../src/lib/bench/scorers/judge.ts";
import { criticalFailures } from "../src/lib/bench/criticalFailures.ts";
import { criticalRate, errorText, headlineDelta, isFailedRun, legacyDestination, runsOf, summarizeRuns, withSeenWeather, withoutGrounding } from "../src/lib/bench/sweep.ts";
import { postJson } from "../src/lib/bench/postJson.ts";

const BASE = process.env.AB_BASE_URL ?? "http://localhost:3000";
const PATH_KIND = process.env.AB_PATH ?? "staged";
const RUNS = Math.max(1, Number(process.env.AB_RUNS ?? 1) || 1);

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
  const { status, payload } = await postJson(
    `${BASE}/api/itinerary`,
    {
      destination: legacyDestination(fixture),
      startDate,
      endDate,
      budget: answers.budget,
      tier: closestTier(answers.budget, days.length),
      userAnswers: answers,
      preferences: { tags: answers.priorities ?? [] },
    },
    benchTimeoutMs()
  );
  const wallMs = Date.now() - startedAt;
  if (status < 200 || status >= 300 || !payload.itinerary) {
    throw new Error(`HTTP ${status}: ${JSON.stringify(payload).slice(0, 300)}`);
  }
  // The legacy route fetched its own live forecast; score against that, not the fixture's.
  const context = getGeneration(payload.runId)?.context_json;
  const seenWeather = context ? JSON.parse(context).weather ?? [] : null;
  const steps = getRunSteps(payload.runId);
  return {
    fixtureId: fixture.id,
    // The legacy route returns JSON, not markdown. `--compare` branches on which one is present.
    itineraryMd: null,
    itineraryJson: payload.itinerary,
    runId: payload.runId,
    seenWeather,
    wallMs,
    costUsd: steps.reduce((n, s) => n + (s.cost_usd ?? 0), 0),
  };
}

async function runArm(out) {
  const fixtures = selectedFixtures();
  console.log(`path      ${PATH_KIND}`);
  console.log(`fixtures  ${fixtures.map((f) => f.id).join(", ")}`);

  const cells = [];
  // Written after every run, not once at the end: a sweep is hours of generations, and a crash on
  // run 20 must not take runs 1-19 with it. The partial file is a valid arm.
  const save = () =>
    writeFileSync(out, JSON.stringify({ arm: out, path: PATH_KIND, runsPerFixture: RUNS, cells }, null, 2));
  for (const fixture of fixtures) {
    const runs = [];
    cells.push({ fixtureId: fixture.id, runs });
    for (let i = 0; i < RUNS; i++) {
      process.stdout.write(`  ${fixture.id} [${i + 1}/${RUNS}] … `);
      try {
        const run = PATH_KIND === "legacy" ? await runLegacy(fixture) : await runStaged(fixture);
        runs.push(run);
        console.log(`${(run.wallMs / 1000).toFixed(1)}s  $${run.costUsd.toFixed(6)}`);
      } catch (err) {
        // One run failing must not lose the runs that already finished — each costs minutes.
        const reason = errorText(err);
        console.log(`FAILED: ${reason}`);
        runs.push({ fixtureId: fixture.id, itineraryMd: null, itineraryJson: null, runId: null, wallMs: 0, costUsd: 0, error: reason });
      }
      save();
    }
  }
  save();
  const ok = cells.flatMap((c) => c.runs).filter((r) => !isFailedRun(r)).length;
  console.log(`\nwrote ${out} — ${ok}/${cells.length * RUNS} runs`);
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
    // A run may carry `itineraryMd: null` plus an `error` string (Task 17 brief ruling 5) —
    // unpaired or all-errored fixtures are skipped rather than scored as zero or crashing scoreCell.
    const firstOk = (cell) => runsOf(cell).find((r) => !isFailedRun(r));
    const runA = firstOk(cellA);
    const runB = cellB && firstOk(cellB);
    if (!runA || !runB) continue;
    const fixture = getFixture(cellA.fixtureId);
    if (!fixture) continue;
    rows.push({ fixture, a: scoreCell(fixture, runA), b: scoreCell(fixture, runB), cellA: runA, cellB: runB });
  }

  console.log(`\npaired fixtures: ${rows.length}/${a.cells.length}\n`);
  const tableA = armTable(a);
  const tableB = armTable(b);
  printArmTable(`arm A — ${aPath}`, tableA);
  printArmTable(`arm B — ${bPath}`, tableB);
  const { delta: d, likeForLike } = headlineDelta(tableA.headline, tableB.headline, a.path, b.path);
  console.log(`\ncritical-trip failure rate delta  ${d === null ? "n/a" : `${d >= 0 ? "+" : ""}${(d * 100).toFixed(0)} pts`}`);
  if (!likeForLike) {
    console.log(`  not like-for-like: ${a.path} vs ${b.path} — travel_leg is only checked on the legacy path`);
  }
  console.log(`\naxes below use each fixture's first successful run per arm\n`);
  printAxis(rows, "composite", (s, cell) => compositeOf(cell, s));
  for (const key of ["routeEfficiency", "constraintAdherence", "weatherFeasibility", "mealVibeAlignment", "coverageGrounding"]) {
    printAxis(rows, `  ${key}`, (s) => compositeGroups(s)[key]);
  }
  console.log("\nunweighted — new axes, not in the composite:");
  printAxis(rows, "  duplicates", (s) => s.duplicates.normalized, "duplicates");
  printAxis(rows, "  commitments", (s) => s.commitments.normalized, "commitments");
  printAxis(rows, "  mustInclude", (s) => s.mustInclude.normalized, "mustInclude");
  printAxis(rows, "  dietary", (s) => s.dietary.normalized);
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
  console.log(`\nn=${rows.length} paired, ${a.runsPerFixture ?? 1} vs ${b.runsPerFixture ?? 1} generation(s) per fixture. Enough to catch a`);
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
  const pairs = rows.filter((r) => pick(r.a, r.cellA) !== null && pick(r.b, r.cellB) !== null);
  if (pairs.length === 0) {
    console.log(`${label.padEnd(24)}n/a — unmeasurable on 0/${total} fixtures (nothing stated to check)`);
    return;
  }
  const mean = (xs) => xs.reduce((n, x) => n + x, 0) / xs.length;
  const mA = mean(pairs.map((r) => pick(r.a, r.cellA)));
  const mB = mean(pairs.map((r) => pick(r.b, r.cellB)));
  const better = pairs.filter((r) => pick(r.b, r.cellB) > pick(r.a, r.cellA)).length;
  const worse = pairs.filter((r) => pick(r.b, r.cellB) < pick(r.a, r.cellA)).length;
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
 *  scorers, by different doors. The legacy door is scored against the weather it was given, with
 *  grounding out of the composite — see withoutGrounding for why. */
function scoreCell(fixture, cell) {
  const operational = { latencyMs: cell.wallMs, inputTokens: null, outputTokens: null, costUsd: cell.costUsd, cliReportedCostUsd: null, parsedOk: true, failed: false, errorMessage: null };
  if (cell.itineraryMd) return scoreItinerary(fixture, cell.itineraryMd, operational);
  const seen = cell.seenWeather ? withSeenWeather(fixture, cell.seenWeather) : fixture;
  return scoreParsed(seen, itineraryToParsed(cell.itineraryJson), JSON.stringify(cell.itineraryJson), operational);
}

/** Composite for display: grounding out for JSON runs (see scoreCell). */
function compositeOf(cell, scores) {
  return compositeScore(cell.itineraryJson ? withoutGrounding(scores) : scores);
}

function scoreRun(fixture, run) {
  if (isFailedRun(run)) {
    return { failed: true, composite: null, critical: ["generation_failed"], costUsd: run.costUsd ?? 0, wallMs: run.wallMs ?? 0, grounding: null, dietaryFlags: [] };
  }
  const scores = scoreCell(fixture, run);
  return {
    failed: false,
    composite: compositeOf(run, scores),
    critical: criticalFailures(scores, { itinerary: run.itineraryJson, modes: fixture.reconciled.transportModes }),
    costUsd: run.costUsd,
    wallMs: run.wallMs,
    grounding: scores.grounding.normalized,
    dietaryFlags: scores.dietary.flagged,
  };
}

/** One arm, every run re-scored now. Mean hides the bad run, so worst and k/N sit beside it. */
function armTable(arm) {
  const all = [];
  const rows = [];
  for (const cell of arm.cells) {
    const fixture = getFixture(cell.fixtureId);
    if (!fixture) continue;
    const scored = runsOf(cell).map((r) => scoreRun(fixture, r));
    all.push(...scored);
    rows.push({ fixtureId: cell.fixtureId, summary: summarizeRuns(scored), scored });
  }
  return { rows, headline: criticalRate(all), all };
}

function printArmTable(label, { rows, headline, all }) {
  console.log(`\n${label}`);
  console.log(`${"fixture".padEnd(28)}${"mean".padEnd(8)}${"worst".padEnd(8)}${"crit".padEnd(7)}${"ground".padEnd(8)}${"cost".padEnd(11)}wall   codes`);
  for (const { fixtureId, summary: s, scored } of rows) {
    const g = scored.map((r) => r.grounding).filter((x) => x !== null);
    const ground = g.length ? g.reduce((x, y) => x + y, 0) / g.length : null;
    console.log(
      `${fixtureId.padEnd(28)}${fmt(s.meanComposite).padEnd(8)}${fmt(s.worstComposite).padEnd(8)}${`${s.criticalRuns}/${s.n}`.padEnd(7)}${fmt(ground).padEnd(8)}${`$${s.meanCostUsd.toFixed(4)}`.padEnd(11)}${`${(s.meanWallMs / 1000).toFixed(0)}s`.padEnd(7)}${s.codes.join(",") || "—"}`
    );
    for (const r of scored) for (const f of r.dietaryFlags) console.log(`${"".padEnd(30)}dietary: ${f}`);
  }
  const overall = summarizeRuns(all);
  const rate = headline.rate === null ? "n/a" : `${(headline.rate * 100).toFixed(0)}%`;
  console.log(`\ncritical-trip failure rate  ${rate}  (${headline.failing}/${headline.total} runs broke a hard rule)`);
  console.log(`composite  mean ${fmt(overall.meanComposite)}  worst ${fmt(overall.worstComposite)}`);
}

function report(path) {
  const arm = JSON.parse(readFileSync(path, "utf8"));
  printArmTable(`${path} — ${arm.path} path, ${arm.runsPerFixture ?? 1} run(s) per fixture`, armTable(arm));
  console.log(`\nN=${arm.runsPerFixture ?? 1} per fixture catches instability, not small deltas. Grounding is`);
  console.log(`outside the composite for legacy runs: that path is never given the context it checks,`);
  console.log(`so its grounding is near-vacuously 1.0.`);
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
} else if (mode === "--report") {
  const path = process.argv[3];
  if (!path) {
    console.error("usage: skill-ab.mjs --report <arm.json>");
    process.exit(1);
  }
  report(path);
} else {
  console.error("usage: skill-ab.mjs --arm <out.json> | --compare <a.json> <b.json> | --report <arm.json>");
  process.exit(1);
}
