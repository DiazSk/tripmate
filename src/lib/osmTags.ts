/**
 * Readers for OpenStreetMap tags — and a module with **no imports at all**, deliberately.
 *
 * These parsers were born in `poiDetails.ts`, which is a server module: it reaches `fetchCache.ts`,
 * which reaches `db.ts`, which reaches `better-sqlite3`. That is fine where it lives, and fatal
 * where these are now also needed. `MapSearchPanel.tsx` imports `PLACE_CATEGORIES` from
 * `placeSearch.ts` as a *value*, so `placeSearch.ts`'s whole module graph is reachable from the
 * client bundle; today that graph is two files deep and clean. One import of `poiDetails` from
 * `placeSearch` would put a native node module in it.
 *
 * So the shared readers live here, at the bottom of the graph, and both sides import them. Adding
 * an import to this file re-creates the problem it exists to solve — keep it empty.
 */

/**
 * OSM's `wheelchair` values in the wild include `designated`, `partial` and `limited?`. Only the
 * three documented values are trusted; anything else reads as unknown rather than being coerced
 * into a guess, since a wrong "yes" here sends someone to a place they can't get into.
 */
export function parseWheelchair(raw: string | undefined): "yes" | "limited" | "no" | null {
  if (raw === "yes" || raw === "designated") return "yes";
  if (raw === "limited") return "limited";
  if (raw === "no") return "no";
  return null;
}

/**
 * A tag that is present, non-empty and worth showing — or `undefined`.
 *
 * OSM carries empty strings and lone semicolons often enough to matter, and `DESIGN.md`'s rule is
 * that a surface must not render a heading for a value that is not there. Normalising here means
 * the card can ask `if (place.website)` and be right, rather than each call site re-deciding what
 * counts as absent.
 */
export function tagValue(
  tags: Record<string, string> | undefined,
  ...keys: string[]
): string | undefined {
  if (!tags) return undefined;
  for (const key of keys) {
    const raw = tags[key]?.trim();
    if (raw && raw !== ";") return raw;
  }
  return undefined;
}

/**
 * `yes`/`no` tags, as a tri-state.
 *
 * `null` rather than `false` for "said no" so a caller can tell it apart from "nobody said" — the
 * same distinction `parseWheelchair` draws, and for the same reason: "this café has no outdoor
 * seating" and "nobody has recorded whether it does" are different sentences, and only one of them
 * is worth printing.
 */
export function parseYesNo(raw: string | undefined): boolean | null {
  if (raw === "yes" || raw === "designated" || raw === "only") return true;
  if (raw === "no") return false;
  return null;
}

/**
 * A Wikidata item id, if the tag holds one.
 *
 * Validated rather than trusted: the value reaches an API URL, and OSM's `wikidata` tag contains
 * prose, lists and outright junk often enough that a shape check is the cheap half of not sending
 * it. `Q` followed by digits is the entire grammar.
 */
export function parseWikidataId(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return /^Q[1-9]\d*$/.test(trimmed) ? trimmed : undefined;
}
