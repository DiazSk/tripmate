import { TTL, cached } from "./fetchCache";
import { askOverpass } from "./overpass";
import type { PoiOsmTags } from "./types";
import { parseWheelchair, parseWikidataId, tagValue } from "./osmTags";

/** Longer than the shared default because this batches every POI in a trip into one query and
 *  Overpass queues under load. NOTE the `[timeout:N]` inside the query is an instruction to
 *  *Overpass* about its own execution budget, not a cap on how long this process waits. */
const OVERPASS_TIMEOUT_MS = 45_000;
/** POIs are matched by name near their own known coordinates, so this only has to absorb the
 *  drift between OpenTripMap's centroid and OSM's — not city-scale search like roads.ts. */
const MATCH_RADIUS_M = 300;

interface OverpassPoiElement {
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function escapeForOverpass(name: string): string {
  return name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Names go into an Overpass regex, so regex metacharacters have to be neutralised as well as
 *  the surrounding quotes — stop names routinely contain "(", ")" and "-". */
function escapeForOverpassRegex(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/"/g, '\\"');
}

/** Opening hours / closed-days for named POIs, from OSM via the same free no-key Overpass API
 *  roads.ts already uses. One batched query for the whole selection rather than one call per POI.
 *  Fails soft, returning `null` on a failed request versus `{}` for "queried fine, nothing
 *  matched" — the two mean different things to the caller, and matching nothing is the common
 *  case (OpenTripMap names come from Wikidata and often differ from OSM's). */
export async function fetchPoiOsmTags(
  pois: { name: string; lat: number; lon: number }[],
  /**
   * How long to wait, overriding the batch default.
   *
   * The 45s above is sized for a generation run: one query covering every POI in a trip, against a
   * community mirror that queues under load, where waiting is strictly better than losing the
   * facts. An *interactive* caller is the opposite trade — `/api/place-gallery` opens on a tap, and
   * a stop that matches nothing was measured taking **36 seconds** to say so, which is a skeleton
   * nobody watches to the end. It passes a few seconds and does without.
   */
  timeoutMs: number = OVERPASS_TIMEOUT_MS
): Promise<Record<string, PoiOsmTags> | null> {
  if (pois.length === 0) return {};

  const clauses = pois
    .map(
      (p) =>
        `nwr["name"="${escapeForOverpass(p.name)}"](around:${MATCH_RADIUS_M},${p.lat},${p.lon});`
    )
    .join("");
  const query = `[out:json][timeout:30];(${clauses});out center tags;`;

  // Keyed on the whole batch, sorted so callers passing the same POIs in a different order share
  // a row. Any change to the set is a full miss, which is the lazy version and the right one here:
  // the callers fire per-run with a stable set. Shortest TTL in the app — `opening_hours` is the
  // one Overpass payload that genuinely churns.
  const key =
    "osmtags:" +
    pois
      .map((p) => `${p.name}@${p.lat.toFixed(4)},${p.lon.toFixed(4)}`)
      .sort()
      .join("|");

  return cached(key, TTL.CHURNING, () => fetchPoiOsmTagsUncached(query, timeoutMs));
}

async function fetchPoiOsmTagsUncached(
  query: string,
  timeoutMs: number
): Promise<Record<string, PoiOsmTags> | null> {
  try {
    // `null` from here means no mirror answered, which is exactly this function's own `null`:
    // "the fetch failed", as distinct from `{}` for "asked, matched nothing". The caller needs
    // that difference — see the fail-soft note in CLAUDE.md.
    const elements = (await askOverpass(query, { timeoutMs })) as
      | OverpassPoiElement[]
      | null;
    if (elements === null) return null;

    const byName: Record<string, PoiOsmTags> = {};
    for (const el of elements) {
      const name = el.tags?.name;
      if (!name || byName[name]) continue;
      const point = el.center ?? (el.lat !== undefined && el.lon !== undefined ? { lat: el.lat, lon: el.lon } : null);
      const tags = el.tags;
      // `addr:place` as well as `addr:street`: a venue on a named square carries the square, and
      // Heimplatz 1 is an address in exactly the way Bahnhofstrasse 1 is.
      const street = tagValue(tags, "addr:street", "addr:place");
      const houseNumber = tagValue(tags, "addr:housenumber");
      byName[name] = {
        openingHours: el.tags?.opening_hours ?? null,
        lat: point?.lat ?? null,
        lon: point?.lon ?? null,
        wheelchair: parseWheelchair(el.tags?.wheelchair),
        // All five were already in this response and were being dropped on the floor. `tagValue`
        // rather than a raw read because OSM carries empty strings and lone semicolons, and the
        // card's rule is that a heading is not drawn over a value that is not there.
        address: street ? (houseNumber ? `${houseNumber} ${street}` : street) : null,
        website: tagValue(tags, "website", "contact:website", "url") ?? null,
        phone: tagValue(tags, "phone", "contact:phone") ?? null,
        wikidataId: parseWikidataId(tagValue(tags, "wikidata")) ?? null,
        commonsCategory: tagValue(tags, "wikimedia_commons") ?? null,
      };
    }
    return byName;
  } catch {
    return null;
  }
}

/** OSM `opening_hours` syntax lists the days a place is OPEN (e.g. "Tu-Su 10:00-18:00"), so the
 *  closed days are whatever it omits. Only handles the plain day-range/day-list forms; anything
 *  with conditional or holiday syntax returns null rather than a confidently wrong answer. */
const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export function closedDaysFromOpeningHours(openingHours: string | null): string[] | null {
  if (!openingHours) return null;
  if (openingHours.includes("24/7")) return [];
  // PH (public holidays), "off"/"closed" exceptions and comment syntax carry rules this simple
  // parser would silently get wrong.
  if (/PH|off|closed|"/i.test(openingHours)) return null;

  const open = new Set<string>();
  for (const token of openingHours.split(/[;,]/)) {
    const dayPart = token.trim().match(/^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?)/);
    if (!dayPart) continue;
    const range = dayPart[1].split(/\s*-\s*/);
    const start = DAYS.indexOf(range[0]);
    if (start === -1) continue;
    if (range.length === 1) {
      open.add(DAYS[start]);
      continue;
    }
    const end = DAYS.indexOf(range[1]);
    if (end === -1) continue;
    // Wraps across the week boundary for ranges like "Sa-Tu".
    for (let i = start; ; i = (i + 1) % DAYS.length) {
      open.add(DAYS[i]);
      if (i === end) break;
    }
  }

  if (open.size === 0) return null;
  return DAYS.filter((d) => !open.has(d));
}

/** Above this the "match" is almost certainly a different place with a similar name. Kyoto's own
 *  sights span ~15km, so the bound has to be generous without letting a same-named place in
 *  another prefecture through. */
const MAX_CORRECTION_KM = 40;

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const p = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * p) / 2) ** 2 +
    Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(((b.lon - a.lon) * p) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Real coordinates for model-named places, looked up by name anywhere near the destination.
 *
 * The model writes lat/lng from memory and gets them wrong — measured against OSM, Fushimi Inari
 * came out 11km off and Nishiki Market 3km off, which puts map pins in the wrong part of the city.
 * This resolves each name against OSM instead, so pins land where the place actually is.
 *
 * Distinct from `fetchPoiOsmTags`, which searches a 300m radius around a POI's *known* position —
 * useless here, since the position is exactly what's untrustworthy.
 *
 * Fails soft: returns `{}` on any error, and callers keep the model's value for anything unmatched.
 */
export async function resolveNamedPlaceCoords(
  names: string[],
  near: { lat: number; lon: number },
  radiusM = 30000
): Promise<Record<string, { lat: number; lon: number }>> {
  const unique = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
  if (unique.length === 0) return {};

  // One regex union rather than a clause per name. Two clauses per name at this radius made
  // Overpass return 504 every time (measured: 12 clauses -> gateway timeout in 9s); the union
  // is one cheap pass and returns in ~25s.
  //
  // Both `name` and `name:en` are matched: OSM stores Japanese sights under `name` in Japanese
  // with `name:en` alongside, and the model always writes the English form.
  const union = unique.map(escapeForOverpassRegex).join("|");
  const clauses =
    `nwr["name"~"^(${union})$"](around:${radiusM},${near.lat},${near.lon});` +
    `nwr["name:en"~"^(${union})$"](around:${radiusM},${near.lat},${near.lon});`;

  // Same whole-batch key shape as the tags lookup, but a separate namespace and a long TTL: this
  // resolves a *coordinate*, which does not move, where `opening_hours` does.
  const key =
    `osmcoords:${near.lat.toFixed(2)}:${near.lon.toFixed(2)}:${radiusM}:` +
    [...unique].sort().join("|");

  // `{}` is this function's public "no corrections available" — the model's own lat/lng is then
  // kept — so the cache miss and the empty answer look the same to every caller. The `null`
  // matters one layer down, where it decides whether an Overpass refusal gets written down as
  // "none of these places exist" and freezes every stop's wrong coordinates for ninety days.
  return (await cached(key, TTL.STATIC, () => resolveNamedPlaceCoordsUncached(clauses, near, unique))) ?? {};
}

async function resolveNamedPlaceCoordsUncached(
  clauses: string,
  near: { lat: number; lon: number },
  /** The de-duplicated request names, needed to key results back to what the caller asked for. */
  unique: string[]
): Promise<Record<string, { lat: number; lon: number }> | null> {
  try {
    const elements = (await askOverpass(`[out:json][timeout:40];(${clauses});out center tags;`, {
      timeoutMs: OVERPASS_TIMEOUT_MS,
    })) as OverpassPoiElement[] | null;
    if (elements === null) return null;

    const byName: Record<string, { lat: number; lon: number }> = {};
    for (const el of elements) {
      const point = el.center ?? (el.lat !== undefined && el.lon !== undefined ? { lat: el.lat, lon: el.lon } : null);
      if (!point) continue;
      if (haversineKm(near, point) > MAX_CORRECTION_KM) continue;
      for (const key of [el.tags?.name, el.tags?.["name:en"]]) {
        if (key && unique.includes(key) && !byName[key]) byName[key] = point;
      }
    }
    return byName;
  } catch {
    return null;
  }
}
