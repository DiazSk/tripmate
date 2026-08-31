import { test } from "node:test";
import assert from "node:assert/strict";

import { DRAFT_TTL_DAYS, staleDraftCutoff } from "./drafts.ts";

const NOW = new Date("2026-08-28T14:30:00.000Z");

test("the cutoff is the TTL back from now", () => {
  assert.equal(staleDraftCutoff(NOW), "2026-07-29T14:30:00.000Z");
});

// The bug this file exists to prevent: SQLite's own datetime() returns
// "2026-07-29 14:30:00", and compared as strings against the ISO timestamps this database
// actually stores, "T" (0x54) sorts above " " (0x20) — so the boundary lands in the wrong
// place. Both sides of the comparison have to be ISO.
test("the cutoff is ISO-shaped, matching how created_at is written", () => {
  const cutoff = staleDraftCutoff(NOW);
  assert.match(cutoff, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(!cutoff.includes(" "));
});

test("a draft written just inside the TTL survives, one just outside does not", () => {
  const cutoff = staleDraftCutoff(NOW);
  const dayMs = 24 * 60 * 60 * 1000;
  const fresh = new Date(NOW.getTime() - (DRAFT_TTL_DAYS - 1) * dayMs).toISOString();
  const stale = new Date(NOW.getTime() - (DRAFT_TTL_DAYS + 1) * dayMs).toISOString();
  // String comparison, because that is exactly what the SQL predicate does.
  assert.ok(fresh > cutoff, "a 29-day-old draft is still listed");
  assert.ok(stale < cutoff, "a 31-day-old draft is swept");
});

test("a shorter TTL moves the cutoff without touching the default", () => {
  assert.equal(staleDraftCutoff(NOW, 1), "2026-08-27T14:30:00.000Z");
  assert.equal(DRAFT_TTL_DAYS, 30);
});

// Month and year boundaries are where a hand-rolled date subtraction breaks; epoch arithmetic
// crosses them for free, and this is what proves it kept doing so.
test("crossing a year boundary is not special", () => {
  assert.equal(staleDraftCutoff(new Date("2027-01-15T00:00:00.000Z")), "2026-12-16T00:00:00.000Z");
});
