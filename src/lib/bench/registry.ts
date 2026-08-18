import { listBenchFixtures } from "../db";
import { BENCH_FIXTURES } from "./fixtures";
import type { BenchFixture } from "./fixtures";

/**
 * One lookup across both kinds of trip: the frozen built-in test set and the custom trips typed
 * into the form. Everything downstream — running a cell, judging, scoring — takes a `BenchFixture`
 * and neither knows nor cares which table it came from.
 *
 * The built-ins stay first and keep their ids, so a stored result from last week still resolves.
 */
export function allFixtures(): BenchFixture[] {
  const custom = listBenchFixtures().map((row) => JSON.parse(row.fixture_json) as BenchFixture);
  return [...BENCH_FIXTURES, ...custom];
}

export function findFixture(id: string): BenchFixture | undefined {
  return allFixtures().find((f) => f.id === id);
}

/** Built-ins are the repeatable baseline; custom trips are ad-hoc and can't be reproduced. */
export function isBuiltIn(id: string): boolean {
  return BENCH_FIXTURES.some((f) => f.id === id);
}
