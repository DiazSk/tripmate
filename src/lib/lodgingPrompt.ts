import type { LodgingOption } from "./lodging";

/**
 * The lodging half of the generate prompt: the real-options block, and the instruction that tells
 * the model what to do with it.
 *
 * Its own module for the same reason `dietaryPrompt.ts` is one — `itineraryPrompt.ts` cannot be
 * loaded from a `.test.mjs`, and the rule below is worth testing. Before this existed the model
 * invented every nightly rate, and the invented numbers were not close: measured against
 * tier-matched inventory across six saved trips, lodging was understated by 22% to 399%, while
 * every one of those plans still reported hitting 85-100% of budget. The budget line was arithmetic
 * over a number nobody had checked.
 */

/** Real properties, rendered as a facts block. Returns "" for both `null` (lookup failed) and
 *  `[]` (searched fine, nothing at this tier) — an absent block rather than an empty heading,
 *  matching `formatDietary`. In both cases the prompt keeps its pre-existing behaviour. */
export function formatLodging(options: LodgingOption[] | null): string {
  if (!options || options.length === 0) return "";

  const lines = options.map((o) => {
    const parts = [
      o.hotelClass ?? "unclassified",
      `$${o.nightlyUsd}/night`,
      o.stayTotalUsd !== null ? `$${o.stayTotalUsd} for the whole stay` : null,
      o.rating !== null ? `rated ${o.rating}${o.reviews !== null ? ` (${o.reviews} reviews)` : ""}` : null,
    ].filter(Boolean);
    return `- ${o.name} — ${parts.join(", ")}`;
  });

  return `\nReal lodging available for these dates, already filtered to this trip's tier:\n${lines.join("\n")}\n`;
}

/**
 * What to do about lodging — one of two mutually exclusive rules.
 *
 * Deliberately a function rather than a second constant appended to the first. The two texts
 * contradict each other: the fallback forbids naming a specific property and forbids stating a
 * price, which is exactly what the real-options text requires. Shipping both would put a direct
 * contradiction in one prompt, and this codebase's observed failure mode is the model resolving
 * that by inventing — the defect this whole change exists to remove.
 */
export function lodgingInstruction(hasRealOptions: boolean): string {
  if (!hasRealOptions) {
    return `For "lodging", choose the TYPE of stay, not just a hotel. Consider hostels/social guesthouses (solo, younger, tight budget), B&Bs/guesthouses/homestays (local and cultural interests), apartments (families, groups, longer stays), hotels (when convenience, accessibility or a late check-in matters), and stays the destination is genuinely known for — riverside or desert camps, glamping, mountain huts, houseboats, farmstays, ryokan-style inns. When the traveler's interests lean adventurous or outdoorsy, actively offer the adventurous option (e.g. a riverside camp) on the night whose location makes it natural, instead of defaulting to a city hotel — but only where such stays genuinely exist at that destination, and never when the night's weather, a remote location after dark, or a family/accessibility need makes it a bad idea. Phrase the lodging "name" as the type FIRST, then the area — "Boutique hotel in Capitol Hill", "Riverside camp near Shivpuri", "Family apartment in Fremont". Never write it the other way round ("Capitol Hill Boutique Hotel"), which reads as a specific property and invents one that may not exist; name an actual property only when it is itself the draw or needs booking far ahead. Use "note" to say in one line why this type suits this traveler plus ONE alternative of a different type or price band. Keep the same base while consecutive days share an area — switch only when the itinerary's geography actually moves. Never invent specific prices, availability, or ratings beyond the cost estimate.`;
  }

  return `For "lodging", choose ONE property from the real lodging list above and use it for every night in the same city — repeat its exact name and its real nightly rate on each of those days. Only switch when the itinerary actually relocates to a different city or region. Do not invent a property that is not on that list, and do not invent a rate: the listed nightly rate IS the cost for that night. Use "note" to say in one line why this stay suits this traveler, plus ONE alternative from the same list. If none of the listed options suits the trip, say so in the note and fall back to describing the TYPE of stay with an estimated cost, rather than inventing a named property. If the real nightly rate makes the stated budget unreachable, keep the real rate and say plainly in that night's "note" what the trip actually costs and by how much it overshoots — the budget target above does NOT license substituting a cheaper invented property, which is the one outcome this list exists to prevent.`;
}

/**
 * How that night's lodging is priced — the phrase that lands mid-sentence in the generate prompt.
 *
 * Exists because "priced to the style above" and a list of real rates are two different pricing
 * bases, and the abstract one arrives first. Verified the hard way: with both present the model
 * ignored five listed 5-star Paris properties (cheapest $377) and invented "Hotel Duo" at $195.
 * The later, more specific rule did NOT win — so the competing basis has to go, not be outranked.
 */
export function lodgingPricingBasis(hasRealOptions: boolean): string {
  return hasRealOptions
    ? "priced at its exact nightly rate from the real lodging list above"
    : "priced to the style above";
}

/**
 * The budget target, made aware of whether lodging is a real price or an estimate.
 *
 * Without this the 85-100% target is an unqualified MUST sitting next to real rates, and the only
 * way to satisfy it on some trips is to invent a cheaper hotel — the defect this feature removes.
 * A measured case: real 5-star Mumbai lodging is $2,793 for the stay against a $1,000 budget, so
 * no honest itinerary can hit the band at all. An overshoot the traveler can see beats a fit
 * nobody can book.
 */
export function budgetInstruction(hasRealOptions: boolean): string {
  if (!hasRealOptions) {
    return `The itinerary's total cost (lodging + stops combined) MUST come close to the full stated budget (aim for 85-100% of it), not just "under" it. If standard sightseeing and dining wouldn't use up a high budget, add premium extras appropriate to the tier (private guides, exclusive experiences, shopping, spa, upgraded transport) rather than leaving the budget unused.`;
  }

  return `The chosen lodging's nightly rate is a real, looked-up price: it is fixed, and must never be adjusted, rounded down, or swapped for a cheaper invented property to make a total work. Aim the REST of the itinerary (stops, meals, extras) so the combined total comes close to the full stated budget (85-100% of it), adding premium extras appropriate to the tier rather than leaving the budget unused. If the real lodging cost alone already carries the total past the stated budget, keep the real cost anyway and say plainly in that night's "note" what the trip actually costs and by how much it overshoots. An honest overshoot is a correct answer here; a total that only fits because the lodging price was fabricated is not.`;
}
