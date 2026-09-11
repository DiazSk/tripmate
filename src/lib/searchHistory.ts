/**
 * Recent map searches, kept per browser.
 *
 * The empty search box is dead space, and the two things worth putting in it are what this
 * traveler asked for before and what their own plan already contains. This module owns the first;
 * the second is derived from the itinerary at the call site, because it is already in memory and
 * persisting a copy of it would be a second source of truth for something the plan already knows.
 *
 * **Free text only.** A category press is one click to redo and carries no typing worth saving, so
 * recording it would fill the list with "Cafés" and push out the queries that actually cost the
 * traveler something to compose.
 *
 * Storage is best-effort throughout: private mode, a disabled-storage policy and a quota-full
 * profile all read as "no history" rather than as an error. Nothing here is worth an exception —
 * this is a convenience over an input box, and the box works without it.
 */

const STORAGE_KEY = "tripmateSearchHistory";

/** Enough to be useful, short enough that the list never scrolls under the input. */
export const MAX_HISTORY = 6;

/** Longer than this is a paste, not a search, and it would wrap the row three times. */
const MAX_ENTRY_LENGTH = 60;

/**
 * Normalise a query for *comparison* — not for display.
 *
 * "cafe", "Cafe" and "  cafe " are one search that happens to have been typed three ways, and a
 * history that lists all three is a history nobody reads. The stored entry keeps the traveler's
 * own casing; only the deduplication key is folded.
 */
function keyOf(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    // Validated rather than trusted. This is user-writable storage that survives deploys, so a
    // shape from an older build — or from a hand-edited profile — must not reach the render as a
    // non-string and throw inside a map().
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  } catch {
    return [];
  }
}

function write(entries: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota, private mode, or storage disabled by policy. The in-memory list the caller is
    // holding stays correct for this session; only persistence is lost.
  }
}

/** Most recent first. */
export function recentSearches(): string[] {
  return read().slice(0, MAX_HISTORY);
}

/**
 * Record a search and return the new list, most recent first.
 *
 * Returning the list rather than relying on the caller re-reading is what keeps the UI correct
 * when storage is unavailable: the entry is still first in the returned array even though nothing
 * was persisted, so the panel behaves identically in private mode for the length of a session.
 */
export function rememberSearch(query: string): string[] {
  // Runs of whitespace collapsed in the stored entry as well as in the key, so the list shows
  // "bar luce" rather than the "bar   luce" that a stray double-space typed it as. Casing is left
  // exactly as the traveler wrote it — that is theirs; the spacing is a typo.
  const trimmed = query.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length > MAX_ENTRY_LENGTH) return recentSearches();
  const key = keyOf(trimmed);
  // The freshly-typed casing wins, and the old spelling of the same search is dropped rather than
  // left as a near-duplicate below it.
  const next = [trimmed, ...read().filter((entry) => keyOf(entry) !== key)].slice(0, MAX_HISTORY);
  write(next);
  return next;
}

/** Drop one entry — the row's × — and return what is left. */
export function forgetSearch(query: string): string[] {
  const key = keyOf(query);
  const next = read().filter((entry) => keyOf(entry) !== key);
  write(next);
  return next.slice(0, MAX_HISTORY);
}

/**
 * The trip's own stops, as the other half of the empty state.
 *
 * Named stops only, deduplicated, in visit order. Order matters: a plan reads chronologically, and
 * offering its highlights shuffled or alphabetised would make the list feel like a different trip
 * from the one in the panel. Capped at the same length as the history so the two sections balance.
 */
export function itineraryHighlights(
  days: { stops: { name: string }[] }[],
  limit = MAX_HISTORY
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const day of days) {
    for (const stop of day.stops) {
      const name = stop.name?.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
      if (out.length >= limit) return out;
    }
  }
  return out;
}
