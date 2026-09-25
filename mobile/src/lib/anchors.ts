import type { Anchor, Itinerary, UnplacedAnchor } from '@/api/types';

/**
 * The traveler's own places — receipt logic, ported from the web's `src/lib/anchors.ts` and
 * `src/lib/guardrails.ts` (`anchorCoverage`). Keep the two in step: this is a second
 * implementation of the same rule, not a reference to it, because the web app is a Next.js server
 * module this client cannot import.
 */

/** Case-, accent- and punctuation-blind identity for a place name. */
export function anchorKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Unicode letters and digits, not [a-z0-9]: "浅草寺" or "Łazienki" must not normalise to "".
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** How close a stop must be to an anchor's coordinates to count as that place, whatever it's called. */
const ANCHOR_MATCH_METRES = 150;

function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const p = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * p) / 2) ** 2 +
    Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(((b.lng - a.lng) * p) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export interface AnchorCoverage {
  /** `must` anchors only — a skipped `want` needs no explanation. */
  total: number;
  placed: { name: string; dayIndex: number }[];
  unplaced: UnplacedAnchor[];
  /** Neither scheduled nor explained: the model dropped it silently. */
  missing: string[];
}

/**
 * Which of the traveler's `must` places made it into the plan. `null` when there are no musts, so
 * the receipt can render nothing rather than an empty "0 of 0" line.
 */
export function anchorCoverage(itinerary: Itinerary): AnchorCoverage | null {
  const musts = (itinerary.anchors ?? []).filter((a) => a.priority === 'must');
  if (musts.length === 0) return null;
  const explained = new Map((itinerary.unplaced ?? []).map((u) => [anchorKey(u.name), u] as const));
  const cov: AnchorCoverage = { total: musts.length, placed: [], unplaced: [], missing: [] };
  for (const anchor of musts) {
    const key = anchorKey(anchor.name);
    const dayIndex = itinerary.days.findIndex((day) =>
      (day.stops ?? []).some(
        (s) =>
          (key && anchorKey(s.name).includes(key)) ||
          (anchor.lat !== null &&
            anchor.lng !== null &&
            metresBetween(s, { lat: anchor.lat, lng: anchor.lng }) <= ANCHOR_MATCH_METRES)
      )
    );
    if (dayIndex !== -1) cov.placed.push({ name: anchor.name, dayIndex });
    else if (explained.has(key)) cov.unplaced.push(explained.get(key)!);
    else cov.missing.push(anchor.name);
  }
  return cov;
}

/** Shared by every "Fit it anyway" call site — opens the chat editor pre-filled with this, never
 *  auto-sent. Same text as the web's `AnchorReceipt.tsx`. */
export const fitMessage = (name: string) =>
  `Please fit ${name} into the plan. It matters to us; drop or move something else to make room, and tell me what you changed.`;

/**
 * Merge a freshly-imported batch into the anchors already held, deduped by `anchorKey`.
 *
 * A geocoded entry always wins over one with null coordinates (from either side), and `must` wins
 * over `want` — the same two rules `ImportDropZone.tsx`'s `findPlaces` and the server's
 * `normalizeAnchors` apply.
 */
export function mergeAnchors(prev: Anchor[], incoming: Anchor[]): Anchor[] {
  const byKey = new Map<string, Anchor>();
  for (const anchor of prev) byKey.set(anchorKey(anchor.name), anchor);
  for (const anchor of incoming) {
    const key = anchorKey(anchor.name);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, anchor);
      continue;
    }
    byKey.set(key, {
      ...existing,
      priority: existing.priority === 'must' || anchor.priority === 'must' ? 'must' : 'want',
      lat: existing.lat ?? anchor.lat,
      lng: existing.lng ?? anchor.lng,
    });
  }
  return Array.from(byKey.values());
}
