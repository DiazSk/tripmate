/**
 * How long an unsaved plan is kept before it is swept up.
 *
 * Every generation writes a `draft` trip row, and most generations are discarded — the traveler
 * tweaks an answer and runs it again, or never comes back. Keeping those forever would turn the
 * Drafts tab into an archive of every plan the app ever wrote, so a draft nobody kept expires.
 *
 * Thirty days is chosen against the thing being protected: the loss this feature exists to stop is
 * a plan lost minutes or days after it was generated, and a plan still unsaved a month later is one
 * the traveler decided against. Promoting a draft to `saved` takes it out of scope entirely — a
 * kept trip is never swept, however old.
 */
export const DRAFT_TTL_DAYS = 30;

/**
 * The ISO cutoff a draft's `created_at` must be newer than to survive.
 *
 * Built in JS as an ISO string, and that is not a stylistic choice. Every timestamp in this
 * database is written as `new Date().toISOString()` — `2026-08-21T21:41:26.123Z` — while SQLite's
 * own `datetime('now','-30 days')` returns `2026-07-22 21:41:26`, space-separated. Compared as
 * strings, `T` (0x54) sorts above `' '` (0x20), so `created_at < datetime(...)` silently matches
 * nothing at all for same-second dates and misjudges the boundary in general. Both sides of the
 * comparison have to share a format, so the cutoff is produced here.
 *
 * `now` is a parameter rather than read from the clock so this is testable without freezing time.
 */
export function staleDraftCutoff(now: Date = new Date(), ttlDays: number = DRAFT_TTL_DAYS): string {
  return new Date(now.getTime() - ttlDays * 24 * 60 * 60 * 1000).toISOString();
}
