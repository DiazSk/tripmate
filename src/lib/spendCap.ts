import { getSpendRowsSince } from "./db";

const DAY_MS = 24 * 60 * 60 * 1000;

function dailyCapUsd(): number {
  const raw = process.env.DAILY_SPEND_CAP_USD;
  if (!raw) return Infinity;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : Infinity;
}

/**
 * When the daily cap lifts, or null when it is not reached. The window is a rolling 24h, not a
 * calendar day, so the cap lifts when enough of the oldest spend ages out: walk the window oldest
 * first, dropping each trace's cost until the rest is under the cap, and that trace's time plus
 * 24h is the answer.
 *
 * Unset/invalid DAILY_SPEND_CAP_USD means no cap — the default in local dev, where the
 * LLM_TRANSPORT=cli path costs nothing extra anyway. Bounds overshoot to "one extra generation's
 * worth", not an exact ceiling: a single in-flight expensive run can push spend past the cap
 * before the next request's check sees it. Fine for a demo guard, not a precise billing control —
 * see docs/superpowers/specs/2026-08-25-deploy-and-direct-api-design.md.
 */
export function dailyCapResumesAt(now = Date.now()): Date | null {
  const cap = dailyCapUsd();
  if (cap === Infinity) return null;
  const rows = getSpendRowsSince(new Date(now - DAY_MS).toISOString());
  let total = rows.reduce((sum, r) => sum + r.cost_usd, 0);
  if (total < cap) return null;
  for (const row of rows) {
    total -= row.cost_usd;
    if (total < cap) return new Date(Date.parse(row.created_at) + DAY_MS);
  }
  // Only a cap at or below 0 gets here: nothing ageing out brings spend under it.
  return new Date(now + DAY_MS);
}
