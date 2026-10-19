import type { Anchor, AnchorPriority, UnplacedAnchor } from "./types";

/**
 * The traveler's own places — one normaliser every path goes through.
 *
 * Exists because the wizard's POI picker wrote `selectedPois`/`customPois` into `userAnswers` for
 * months and nothing downstream read them: the one field where a traveler says "we must go here"
 * had no effect on the plan. `anchors` is the new shape; the legacy fields are still folded in
 * because the iOS wizard sends only those.
 */

export const MAX_ANCHORS = 40;

/** Case-, accent- and punctuation-blind identity for a place name. */
export function anchorKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // Unicode letters and digits, not [a-z0-9]: "浅草寺" or "Łazienki" must not normalise to "".
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Trust boundary: `answers` is an unvalidated request body. Malformed entries are dropped. */
export function normalizeAnchors(answers: unknown): Anchor[] {
  const a = (answers ?? {}) as Record<string, unknown>;
  const out: Anchor[] = [];
  if (Array.isArray(a.anchors)) {
    for (const raw of a.anchors as Record<string, unknown>[]) {
      const name = text(raw?.name);
      if (!name) continue;
      const priority: AnchorPriority = raw.priority === "must" ? "must" : "want";
      const source =
        raw.source === "import" || raw.source === "picked" || raw.source === "typed"
          ? raw.source
          : undefined;
      out.push({ name, lat: num(raw.lat), lng: num(raw.lng), priority, source });
    }
  }
  if (Array.isArray(a.selectedPois)) {
    for (const raw of a.selectedPois as Record<string, unknown>[]) {
      const name = text(raw?.name);
      if (name) out.push({ name, lat: num(raw.lat), lng: num(raw.lon), priority: "want", source: "picked" });
    }
  }
  if (Array.isArray(a.customPois)) {
    for (const raw of a.customPois) {
      const name = text(raw);
      if (name) out.push({ name, lat: null, lng: null, priority: "want", source: "typed" });
    }
  }
  const byKey = new Map<string, Anchor>();
  for (const anchor of out) {
    const key = anchorKey(anchor.name);
    if (!key) continue;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, anchor);
      continue;
    }
    byKey.set(key, {
      ...prev,
      priority: prev.priority === "must" || anchor.priority === "must" ? "must" : "want",
      lat: prev.lat ?? anchor.lat,
      lng: prev.lng ?? anchor.lng,
    });
  }
  // Stable sort (must before want) so a must past position 40 survives the cap instead of a want
  // that happened to be typed or imported earlier — the guardrail only ever sees this array.
  const ordered = Array.from(byKey.values());
  ordered.sort((a, b) => (a.priority === b.priority ? 0 : a.priority === "must" ? -1 : 1));
  return ordered.slice(0, MAX_ANCHORS);
}

/** The model's `unplaced` array, validated. Anything malformed is dropped. */
export function readUnplaced(value: unknown): UnplacedAnchor[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => {
    const name = text((v as Record<string, unknown>)?.name);
    const reason = text((v as Record<string, unknown>)?.reason);
    return name && reason ? [{ name, reason }] : [];
  });
}

/** The planner's one line after "Find the places": how many of a batch were placed, and what to do
 *  about the rest. Empty when nothing came back — the unread notes already say why. */
export function foundSummary(found: number, total: number, city: string): string {
  if (total === 0) return "";
  const where = city.trim() ? ` in ${city.trim()}` : "";
  if (found === total) return `Found ${found} of ${total} ${total === 1 ? "place" : "places"}${where}.`;
  const left = total - found;
  return `Found ${found} of ${total} — ${left} ${left === 1 ? "needs" : "need"} a nearby landmark.`;
}

/** Copy row P-21a: a text or link import that read fine but held no places. The text stays in the box. */
export const NO_PLACES_FOUND = "No places found in that. Try place names, a list, or a link to a place.";

/** True when an import came back with nothing placed and nothing already explained by an unread note. */
export function foundNothing(places: number, unread: number): boolean {
  return places === 0 && unread === 0;
}
