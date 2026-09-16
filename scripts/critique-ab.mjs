/**
 * Does the critique pass earn the model it runs on?
 *
 * **Why this exists rather than `npm run bench`.** The benchmark calls `generateItinerary()`,
 * which makes a single LLM call and no critique at all (`generateItinerary.ts:96`); critique
 * lives only in `runGeneration()` on the legacy `/api/itinerary` path. So nothing in the bench
 * harness can put a critiqued plan beside an uncritiqued one, or one critique model beside
 * another. This drives the legacy route and scores the result with the bench's own scorers, so
 * the numbers are comparable to everything in `docs/itinerary-quality.md`.
 *
 * **Why over HTTP rather than importing `runGeneration`.** `generationRunner.ts` pulls
 * `CritiqueResult` into a *value* import block, so Node throws at instantiation and the module is
 * unreachable from a `.mjs` script — see CLAUDE.md. `scripts/perf-bench.mjs` goes through the
 * route for the same reason.
 *
 * **Requires `LLM_TRANSPORT=api`.** The CLI path pins every call to `MODEL`
 * (`claude.ts:337`) and never consults `apiModelFor()`, so on CLI transport the critique model is
 * whatever `MODEL` is and this measures nothing.
 *
 * `LLM_MODEL_CRITIQUE` is read from the *server's* environment, so the two arms need two server
 * starts. Run one arm, write its JSON, restart with the other value, run again, then `--compare`.
 *
 *   LLM_TRANSPORT=api LLM_MODEL_CRITIQUE=claude-opus-5 npm run dev
 *   node --import ./scripts/ts-resolve.mjs scripts/critique-ab.mjs opus.json
 *   # restart the server without LLM_MODEL_CRITIQUE (defaults to the cheap tier)
 *   node --import ./scripts/ts-resolve.mjs scripts/critique-ab.mjs haiku.json
 *   node --import ./scripts/ts-resolve.mjs scripts/critique-ab.mjs --compare opus.json haiku.json
 */
import { readFileSync, writeFileSync } from "fs";

import { getFixture } from "../src/lib/bench/fixtures.ts";
import { benchUserAnswers } from "../src/lib/bench/refineTasks.ts";
import { compositeGroups, compositeScore, scoreParsed } from "../src/lib/bench/runBenchmark.ts";
import { itineraryToParsed } from "../src/lib/bench/itineraryToParsed.ts";
import { getRunSteps } from "../src/lib/db.ts";
import { closestTier } from "../src/lib/tiers.ts";

const BASE = process.env.AB_BASE_URL ?? "http://localhost:3000";
const FIXTURE_ID = process.env.AB_FIXTURE ?? "kyoto-couple-mixed";

if (process.argv[2] === "--compare") {
  const [a, b] = process.argv.slice(3).map((f) => JSON.parse(readFileSync(f, "utf8")));
  compare(a, b);
  process.exit(0);
}

const out = process.argv[2];
if (!out) {
  console.error("usage: critique-ab.mjs <out.json> | --compare <a.json> <b.json>");
  process.exit(1);
}

// `getFixture` rather than the registry's `allFixtures()`: the built-in set is what
// `docs/itinerary-quality.md` is scored against, and it needs no database read.
const fixture = getFixture(FIXTURE_ID);
if (!fixture) throw new Error(`no fixture ${FIXTURE_ID}`);

const answers = benchUserAnswers(fixture);
const days = fixture.reconciled.rawFetch.dateContext.days;
const startDate = days[0].date;
const endDate = days[days.length - 1].date;

const body = {
  destination: fixture.reconciled.rawFetch.destination.region ?? fixture.title,
  startDate,
  endDate,
  budget: answers.budget,
  tier: closestTier(answers.budget, days.length),
  userAnswers: answers,
  preferences: { tags: answers.priorities ?? [] },
};

console.log(`fixture   ${FIXTURE_ID}`);
console.log(`trip      ${body.destination} ${startDate}..${endDate} $${body.budget} ${body.tier}`);
console.log("generating (this is one full run of the legacy path, critique included)…");

const startedAt = Date.now();
const res = await fetch(`${BASE}/api/itinerary`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const wallMs = Date.now() - startedAt;
const payload = await res.json();
if (!res.ok || !payload.itinerary) {
  console.error(`HTTP ${res.status}:`, JSON.stringify(payload).slice(0, 300));
  process.exit(1);
}

// Per-call cost and model, read from the trace rows this run wrote — not re-derived, so the
// numbers are the ones `/api/llm-traces` and the perf dashboard report.
const steps = getRunSteps(payload.runId).map((s) => ({
  type: s.type,
  model: s.model,
  status: s.status,
  durationMs: s.duration_ms,
  costUsd: s.cost_usd,
}));

// `failed: false` because the run returned a plan; the scorers only read this for the
// operational axes, which are not in COMPOSITE_WEIGHTS.
const operational = {
  latencyMs: wallMs,
  inputTokens: null,
  outputTokens: null,
  costUsd: steps.reduce((n, s) => n + (s.costUsd ?? 0), 0),
  cliReportedCostUsd: null,
  parsedOk: true,
  failed: false,
  errorMessage: null,
};

const parsed = itineraryToParsed(payload.itinerary);
const scores = scoreParsed(fixture, parsed, JSON.stringify(payload.itinerary), operational);
const record = {
  fixtureId: FIXTURE_ID,
  runId: payload.runId,
  critiqueModel: steps.find((s) => s.type === "critique")?.model ?? "(no critique step)",
  wallMs,
  steps,
  totalCostUsd: operational.costUsd,
  groups: compositeGroups(scores),
  composite: compositeScore(scores),
  stops: parsed.days.reduce((n, d) => n + d.stops.length, 0),
  dayCount: parsed.days.length,
};

writeFileSync(out, JSON.stringify(record, null, 2));
console.log(`\ncritique model  ${record.critiqueModel}`);
console.log(`composite       ${fmt(record.composite)}`);
console.log(`cost            $${record.totalCostUsd.toFixed(6)}`);
console.log(`wall            ${(wallMs / 1000).toFixed(1)}s`);
for (const s of steps) {
  console.log(`  ${s.type.padEnd(9)} ${String(s.model).padEnd(20)} ${s.status.padEnd(7)} ${String(Math.round((s.durationMs ?? 0) / 1000)).padStart(4)}s  $${(s.costUsd ?? 0).toFixed(6)}`);
}
console.log(`\nwrote ${out}`);

function fmt(n) {
  return n === null || n === undefined ? "n/a" : n.toFixed(4);
}

function compare(a, b) {
  console.log(`fixture ${a.fixtureId}\n`);
  console.log(`${"".padEnd(16)}${a.critiqueModel.padEnd(22)}${b.critiqueModel}`);
  console.log("-".repeat(62));
  const row = (label, x, y, f = fmt) =>
    console.log(`${label.padEnd(16)}${String(f(x)).padEnd(22)}${f(y)}`);
  row("composite", a.composite, b.composite);
  for (const k of Object.keys(a.groups)) row(`  ${k}`, a.groups[k], b.groups[k]);
  row("cost usd", a.totalCostUsd, b.totalCostUsd, (n) => `$${n.toFixed(6)}`);
  row("wall s", a.wallMs, b.wallMs, (n) => (n / 1000).toFixed(1));
  row("stops", a.stops, b.stops, String);
  console.log("-".repeat(62));
  const dComposite =
    a.composite !== null && b.composite !== null ? b.composite - a.composite : null;
  const saved = a.totalCostUsd - b.totalCostUsd;
  console.log(`composite delta ${dComposite === null ? "n/a" : (dComposite >= 0 ? "+" : "") + dComposite.toFixed(4)}`);
  console.log(`cost saved      $${saved.toFixed(6)} (${((saved / a.totalCostUsd) * 100).toFixed(1)}%)`);
  console.log(`\nn=1 per arm. One fixture, one generation each — enough to catch a collapse,`);
  console.log(`not enough to call a small composite difference real.`);
}
