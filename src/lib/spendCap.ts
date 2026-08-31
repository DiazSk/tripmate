import { getSpendSince } from "./db";

function dailyCapUsd(): number {
  const raw = process.env.DAILY_SPEND_CAP_USD;
  if (!raw) return Infinity;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : Infinity;
}

/**
 * True once today's LLM spend (a rolling 24h window, not calendar-day) reaches the configured
 * cap. Unset/invalid DAILY_SPEND_CAP_USD means no cap — the default in local dev, where the
 * LLM_TRANSPORT=cli path costs nothing extra anyway. Bounds overshoot to "one extra generation's
 * worth", not an exact ceiling: a single in-flight expensive run can push spend past the cap
 * before the next request's check sees it. Fine for a demo guard, not a precise billing control —
 * see docs/superpowers/specs/2026-08-25-deploy-and-direct-api-design.md.
 */
export function isOverDailyCap(): boolean {
  const cap = dailyCapUsd();
  if (cap === Infinity) return false;
  const cutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  return getSpendSince(cutoffIso) >= cap;
}
