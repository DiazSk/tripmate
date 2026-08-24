import { runComposioTool } from "./composio";
import type { TierId } from "./tiers";

/** One real, bookable-looking property with a real price. `nightlyUsd` is required — a listing
 *  without a parseable rate is dropped, because the only reason this data exists is to put a
 *  real number into the budget arithmetic (see `distilLodgingOptions`). */
export interface LodgingOption {
  name: string;
  hotelClass: string | null;
  nightlyUsd: number;
  stayTotalUsd: number | null;
  rating: number | null;
  reviews: number | null;
  lat: number | null;
  lon: number | null;
}

const TOOL_SLUG = "COMPOSIO_SEARCH_HOTELS";
const DEFAULT_LIMIT = 5;

/**
 * §6's tier register expressed as Google's star-class filter.
 *
 * This is load-bearing, not a detail. An unfiltered search returns whatever is cheapest nearby —
 * for a luxury trip that means hostels — and comparing a luxury plan against that inventory
 * inverts the answer. The Phase 0 spike did exactly this and concluded lodging was *overstated*
 * by 55%, when tier-matched inventory showed it understated by 140%.
 */
const HOTEL_CLASS_BY_TIER: Record<TierId, string> = {
  budget: "2,3",
  midrange: "3,4",
  luxury: "5",
};

export function hotelClassForTier(tier: TierId): string {
  return HOTEL_CLASS_BY_TIER[tier] ?? HOTEL_CLASS_BY_TIER.midrange;
}

/** Rates arrive as display strings — "$265", "$1,234", occasionally already a number. Anything
 *  that doesn't yield a positive number is treated as absent rather than coerced to 0, which
 *  would read downstream as a free room. */
function parseUsd(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== "string") return null;
  const n = Number(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Reduce the search payload to the few fields the prompt needs.
 *
 * Mandatory, not an optimisation: the raw response measured **81,407 tokens** and is offloaded to
 * a temp file rather than returned inline. The distilled block is ~163.
 *
 * Tolerates any shape without throwing — a malformed payload is a failed lookup, not a crash.
 */
export function distilLodgingOptions(raw: unknown, limit = DEFAULT_LIMIT): LodgingOption[] {
  const properties = (raw as { results?: { properties?: unknown } } | null)?.results?.properties;
  if (!Array.isArray(properties)) return [];

  const options: LodgingOption[] = [];
  for (const entry of properties) {
    if (!entry || typeof entry !== "object") continue;
    const p = entry as Record<string, unknown>;

    const name = typeof p.name === "string" ? p.name.trim() : "";
    const nightlyUsd = parseUsd((p.rate_per_night as Record<string, unknown> | undefined)?.lowest);
    // A listing with no name or no price can't anchor a budget, so it is not a listing worth
    // showing the model — it would just re-open the door to an invented number.
    if (!name || nightlyUsd === null) continue;

    const gps = (p.gps_coordinates ?? {}) as Record<string, unknown>;
    options.push({
      name,
      hotelClass:
        typeof p.hotel_class === "string"
          ? p.hotel_class
          : typeof p.extracted_hotel_class === "number"
            ? `${p.extracted_hotel_class}-star`
            : null,
      nightlyUsd,
      stayTotalUsd: parseUsd((p.total_rate as Record<string, unknown> | undefined)?.lowest),
      rating: asNumber(p.overall_rating),
      reviews: asNumber(p.reviews),
      lat: asNumber(gps.latitude),
      lon: asNumber(gps.longitude),
    });
    if (options.length >= limit) break;
  }
  return options;
}

/**
 * Real lodging for the destination, filtered to the tier's star class.
 *
 * Follows the `holidays.ts` contract rather than the `pois.ts` one, and the distinction matters:
 * `null` means the lookup failed (no `composio` on PATH, no session, timeout, malformed reply),
 * `[]` means the search ran and this destination genuinely has nothing at this tier — which is
 * real, not theoretical: a 5-star search for Zurich came back empty. `pois.ts` collapses both
 * into `[]`, which is why its caller has to guess at `available`.
 *
 * Callers must degrade on either — the prompt falls back to type-first naming with an estimated
 * cost, exactly as it behaved before this existed.
 */
export async function fetchLodgingOptions(params: {
  destination: string;
  checkIn: string;
  checkOut: string;
  tier: TierId;
  adults?: number;
}): Promise<LodgingOption[] | null> {
  const query: Record<string, unknown> = {
    q: params.destination,
    check_in_date: params.checkIn,
    check_out_date: params.checkOut,
    currency: "USD",
    hotel_class: hotelClassForTier(params.tier),
  };
  if (params.adults && params.adults > 0) query.adults = params.adults;

  const data = await runComposioTool(TOOL_SLUG, query);
  if (data === null) return null;
  return distilLodgingOptions(data);
}

/** Case/diacritic/punctuation-insensitive so "MGallery Collection" and small model rewordings
 *  still match, while a genuinely unrelated name correctly matches nothing. */
function normalizeLodgingName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Find the real option a model-written lodging name refers to, or `null` if it names a property
 *  that was never on the list — i.e. invented. Substring match in both directions: the model has
 *  been observed copying a listed name verbatim, and also observed shortening or padding it. */
export function matchLodgingOption(modelName: string, options: LodgingOption[]): LodgingOption | null {
  const norm = normalizeLodgingName(modelName);
  if (!norm) return null;
  for (const option of options) {
    const optionNorm = normalizeLodgingName(option.name);
    if (optionNorm && (optionNorm === norm || optionNorm.includes(norm) || norm.includes(optionNorm))) {
      return option;
    }
  }
  return null;
}

/** One night's lodging as the model wrote it — the shape `Lodging` from types.ts, kept local
 *  and structural here so this module stays free of a value-import into generationRunner.ts. */
export interface LodgingLike {
  name: string;
  cost: number;
  note: string;
}

/**
 * The deterministic backstop the prompt alone couldn't hold.
 *
 * Verified against a live generation: with the real list, the correct pricing basis, and an
 * explicit "do not invent" rule all present in the prompt, the model still invented
 * "Hotel Jeanne d'Arc Le Marais @ $140" once the cheapest real option didn't fit the budget. A
 * prompt is a request, not a constraint — so the request the model won't honor gets enforced in
 * code instead, the same way `resolveNamedPlaceCoords` corrects the model's invented coordinates
 * rather than asking it more firmly to remember real ones.
 *
 * `options` empty or `null` is a no-op: nothing to check the name against, so the model's
 * own choice (already following the type-first fallback instruction) stands unchanged.
 *
 * A genuine match just gets its cost pinned to the real rate — the model can drift on the price
 * of a property it named correctly. A miss is replaced with the cheapest real option, on the
 * reasoning that a repair should minimize the traveler's exposure to the correction. The note is
 * REPLACED rather than appended to: the model's own note was written to justify the invented
 * property (a false pretext), so keeping it would explain a choice the traveler no longer sees.
 */
export function reconcileLodging(
  lodging: LodgingLike,
  options: LodgingOption[] | null,
  budgetUsd: number
): LodgingLike {
  if (!options || options.length === 0) return lodging;

  const matched = matchLodgingOption(lodging.name, options);
  if (matched) {
    return matched.nightlyUsd === lodging.cost
      ? lodging
      : { ...lodging, cost: matched.nightlyUsd };
  }

  const cheapest = [...options].sort((a, b) => a.nightlyUsd - b.nightlyUsd)[0];
  const overshoot = cheapest.nightlyUsd > budgetUsd;
  return {
    name: cheapest.name,
    cost: cheapest.nightlyUsd,
    note: overshoot
      ? `Corrected to a real listed property — cheapest available at this tier still runs $${cheapest.nightlyUsd}/night, above the stated budget.`
      : `Corrected to a real listed property at its actual nightly rate.`,
  };
}
