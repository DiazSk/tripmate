/**
 * The Pareto frontier for the quality-vs-cost scatter: models that no other model beats on both
 * axes (higher quality AND lower cost). Everything off the frontier is strictly dominated — this
 * is the "is Opus worth it" answer.
 *
 * Lives in its own file, with zero imports, specifically so the client chart component can call it.
 * `runBenchmark.ts` reaches `libsql` through `../db`, and importing it from a `"use client"`
 * component would drag a native node module into the browser bundle.
 */
export function paretoFrontier(
  points: { model: string; quality: number | null; cost: number | null }[]
): Set<string> {
  const usable = points.filter(
    (p): p is { model: string; quality: number; cost: number } =>
      p.quality !== null && p.cost !== null
  );
  const frontier = new Set<string>();
  for (const p of usable) {
    const dominated = usable.some(
      (q) =>
        q !== p &&
        q.quality >= p.quality &&
        q.cost <= p.cost &&
        (q.quality > p.quality || q.cost < p.cost)
    );
    if (!dominated) frontier.add(p.model);
  }
  return frontier;
}
