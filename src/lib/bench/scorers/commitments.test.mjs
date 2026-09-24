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
