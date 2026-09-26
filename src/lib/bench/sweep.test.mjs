/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/bench/sweep.test.mjs */
import assert from "node:assert/strict";
import test from "node:test";
import { getFixture } from "./fixtures.ts";
import { criticalRate, errorText, headlineDelta, isFailedRun, runsOf, summarizeRuns, withSeenWeather, withoutGrounding } from "./sweep.ts";

const KYOTO = getFixture("kyoto-couple-mixed");

test("withSeenWeather swaps only the weather, and leaves the frozen fixture alone", () => {
  const seen = [{ date: "2026-09-19", tempMaxC: 30, tempMinC: 20, precipitationProbability: 90, humidity: 80, weatherCode: 61, sunrise: null, sunset: null, historical: true }];
  const before = JSON.stringify(KYOTO.reconciled.rawFetch.weather);
  const f = withSeenWeather(KYOTO, seen);
  assert.deepEqual(f.reconciled.rawFetch.weather, { available: true, historical: true, days: seen });
  assert.equal(JSON.stringify(KYOTO.reconciled.rawFetch.weather), before);
  assert.equal(f.reconciled.rawFetch.destination, KYOTO.reconciled.rawFetch.destination);
  assert.equal(withSeenWeather(KYOTO, []).reconciled.rawFetch.weather.available, false);
});

test("withoutGrounding nulls grounding and nothing else", () => {
  const scores = { grounding: { namedStops: 5, normalized: 0.2 }, coverage: { normalized: 0.8 } };
  const out = withoutGrounding(scores);
  assert.equal(out.grounding.normalized, null);
  assert.equal(out.grounding.namedStops, 5);
  assert.equal(out.coverage.normalized, 0.8);
  assert.equal(scores.grounding.normalized, 0.2, "input untouched");
});

test("runsOf reads an arm file written before repeats existed", () => {
  const old = { fixtureId: "x", itineraryMd: "md" };
  assert.deepEqual(runsOf(old), [old]);
  const now = { fixtureId: "x", runs: [{ a: 1 }, { a: 2 }] };
  assert.equal(runsOf(now).length, 2);
});

const run = (composite, critical = [], failed = false) => ({ failed, composite, critical, costUsd: 1, wallMs: 1000 });

test("summarizeRuns reports mean, worst, and distinct codes", () => {
  const s = summarizeRuns([run(0.9), run(0.7, ["duplicate"]), run(0.8, ["duplicate", "pace"])]);
  assert.equal(s.n, 3);
  assert.ok(Math.abs(s.meanComposite - 0.8) < 1e-9);
  assert.equal(s.worstComposite, 0.7);
  assert.equal(s.criticalRuns, 2);
  assert.deepEqual(s.codes, ["duplicate", "pace"]);
});

test("summarizeRuns on all-failed runs has no NaN", () => {
  const s = summarizeRuns([run(null, ["generation_failed"], true), run(null, ["generation_failed"], true)]);
  assert.equal(s.meanComposite, null);
  assert.equal(s.worstComposite, null);
  assert.equal(s.criticalRuns, 2);
  assert.ok(!Number.isNaN(s.meanCostUsd));
});

test("criticalRate is failing runs over all runs", () => {
  assert.deepEqual(criticalRate([run(0.9), run(0.8, ["pace"]), run(null, ["generation_failed"], true), run(0.7)]), {
    failing: 2,
    total: 4,
    rate: 0.5,
  });
  assert.equal(criticalRate([]).rate, null);
});

test("a run that produced no plan is failed, even when its error message is empty", () => {
  // ECONNREFUSED over node:http arrives as an AggregateError whose `message` is "".
  const refused = new AggregateError([new Error("connect ECONNREFUSED ::1:3000")], "");
  refused.code = "ECONNREFUSED";
  assert.equal(errorText(refused), "ECONNREFUSED");
  assert.equal(errorText(new Error("boom")), "boom");
  assert.equal(isFailedRun({ error: "", itineraryMd: null, itineraryJson: null }), true);
  assert.equal(isFailedRun({ itineraryMd: null, itineraryJson: null }), true);
  assert.equal(isFailedRun({ itineraryMd: "md" }), false);
  assert.equal(isFailedRun({ itineraryMd: null, itineraryJson: { days: [] } }), false);
});

test("the headline delta says when the two arms were not gated alike", () => {
  const a = { failing: 1, total: 2, rate: 0.5 };
  const b = { failing: 2, total: 2, rate: 1 };
  assert.deepEqual(headlineDelta(a, b, "legacy", "legacy"), { delta: 0.5, likeForLike: true });
  // travel_leg only runs on legacy JSON, so a staged-vs-legacy delta is biased against legacy.
  assert.equal(headlineDelta(a, b, "staged", "legacy").likeForLike, false);
  assert.equal(headlineDelta({ rate: null }, b, "legacy", "legacy").delta, null);
});
