import { runComposioTool } from "./composio";

const TOOL_SLUG = "COMPOSIO_SEARCH_FLIGHTS";

/** A single number to do arithmetic against, not a chosen flight — there is no "pick one from
 *  the list" step here the way there is for lodging. `costUsd` is `price_insights.lowest_price`,
 *  the total for the whole party (not per-person), for a round trip on the trip's own dates. */
export interface FlightEstimate {
  costUsd: number;
  /** Google's own framing of where this sits — "typical" | "low" | "high" — kept for an honest
   *  note ("a low-price week to fly") rather than presenting one number as the only truth. */
  priceLevel: string | null;
  typicalRangeUsd: [number, number] | null;
}

/** Pure. `price_insights` is a summary block sitting alongside the individual flight listings —
 *  verified live: `lowest_price` already matches the cheapest entry in `best_flights`, so reading
 *  it directly skips picking through a list for a number that's already been computed once. */
export function distilFlightEstimate(raw: unknown): FlightEstimate | null {
  const insights = (raw as { results?: { price_insights?: unknown } } | null)?.results
    ?.price_insights as Record<string, unknown> | undefined;
  if (!insights || typeof insights.lowest_price !== "number" || insights.lowest_price <= 0) {
    return null;
  }

  const range = insights.typical_price_range;
  const typicalRangeUsd: [number, number] | null =
    Array.isArray(range) &&
    range.length === 2 &&
    typeof range[0] === "number" &&
    typeof range[1] === "number"
      ? [range[0], range[1]]
      : null;

  return {
    costUsd: insights.lowest_price,
    priceLevel: typeof insights.price_level === "string" ? insights.price_level : null,
    typicalRangeUsd,
  };
}

/**
 * A real round-trip cost for the trip's own dates, out of `departureIata` into `destination`.
 *
 * Round-trip is the only shape this asks for — nothing else in this app models a one-way trip,
 * and `outbound_date`/`return_date` map directly onto the trip's own `startDate`/`endDate`.
 *
 * Resolves `null` on any failure or a payload with no usable `price_insights` — the caller must
 * degrade to "no flight cost known," never invent one. There is deliberately no `[]` case the way
 * `fetchLodgingOptions` has one: a single number either exists or it doesn't.
 */
export async function fetchFlightEstimate(params: {
  departureIata: string;
  destination: string;
  outboundDate: string;
  returnDate: string;
  adults?: number;
}): Promise<FlightEstimate | null> {
  if (!params.departureIata) return null;

  const query: Record<string, unknown> = {
    departure_id: params.departureIata,
    query: `flights to ${params.destination}`,
    outbound_date: params.outboundDate,
    return_date: params.returnDate,
    currency: "USD",
  };
  if (params.adults && params.adults > 0) query.adults = params.adults;

  const data = await runComposioTool(TOOL_SLUG, query);
  return data === null ? null : distilFlightEstimate(data);
}

/**
 * The budget actually available for lodging + stops, once a real flight cost is known.
 *
 * Pure and separated from the fetch specifically so it has direct unit coverage — this is the
 * exact shape of arithmetic that has to reach `buildGeneratePrompt`, `buildRefinePrompt`, AND
 * `buildCritiquePrompt` identically, after critique's own review criteria was found this session
 * independently re-deriving a budget target with no knowledge of a correction made earlier in the
 * same run. One function, called once, used everywhere `budget` currently is — not three call
 * sites that each have to remember an adjustment.
 *
 * Never returns a number ≤ 0: a flight cost that meets or exceeds the whole stated budget would
 * make "plan the rest against what's left" nonsensical, so the stated budget is left untouched in
 * that case. The real flight cost still reaches the traveler through `FlightEstimate` itself —
 * this function only decides what the MODEL plans against, not what gets reported.
 */
export function computeEffectiveBudget(budget: number, estimate: FlightEstimate | null): number {
  if (!estimate || estimate.costUsd >= budget) return budget;
  return budget - estimate.costUsd;
}
