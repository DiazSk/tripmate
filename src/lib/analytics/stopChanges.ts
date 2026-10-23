import type { Itinerary } from "../types";

export type StopChange = { change: "swap" | "remove" | "add" | "move"; count: number };

/** A stop has no id, so it is its name: the model and the traveller both address stops by it. */
const key = (name: unknown) => String(name ?? "").trim().toLowerCase();

/** Stops of `a` that keep their relative order in `b`'s sequence, as a count (longest increasing run). */
function inOrder(common: number[]): number {
  const best: number[] = [];
  for (let i = 0; i < common.length; i++) {
    best[i] = 1;
    for (let j = 0; j < i; j++) if (common[j] < common[i]) best[i] = Math.max(best[i], best[j] + 1);
  }
  return Math.max(0, ...best);
}

/**
 * What changed between two versions of a plan, in the four kinds the analytics events speak:
 * a stop that left while another arrived is a swap, one that only left a remove, one that only
 * arrived an add, and stops that stayed but changed their order a move (counted as the stops that
 * had to jump). Judged per day, by day position, so a stop carried to another day is a remove on
 * one day and an add on the other. Kinds with nothing in them are left out.
 */
export function stopChanges(before: Itinerary, after: Itinerary): StopChange[] {
  const totals = { swap: 0, remove: 0, add: 0, move: 0 };
  const days = Math.max(before.days.length, after.days.length);
  for (let d = 0; d < days; d++) {
    const was = (before.days[d]?.stops ?? []).map((s) => key(s?.name));
    const now = (after.days[d]?.stops ?? []).map((s) => key(s?.name));
    const left = [...was];
    const kept: string[] = [];
    const arrived: string[] = [];
    for (const name of now) {
      const at = left.indexOf(name);
      if (at < 0) arrived.push(name);
      else {
        left.splice(at, 1);
        kept.push(name);
      }
    }
    const swaps = Math.min(left.length, arrived.length);
    totals.swap += swaps;
    totals.remove += left.length - swaps;
    totals.add += arrived.length - swaps;
    // Positions in `was` of the kept stops, in their new order; an increasing run is unmoved.
    const pool = [...was];
    const positions = kept.map((name) => {
      const at = pool.indexOf(name);
      pool[at] = "\0";
      return at;
    });
    totals.move += kept.length - inOrder(positions);
  }
  return (["swap", "remove", "add", "move"] as const).filter((c) => totals[c] > 0).map((c) => ({ change: c, count: totals[c] }));
}
