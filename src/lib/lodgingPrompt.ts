/**
 * The lodging half of the generate prompt: the instruction that tells the model what to do
 * about lodging when there is no real-listings data to ground it in — which is now always,
 * since the hotel-search fetch has been removed entirely (no free/affordable real-time hotel
 * pricing API exists). Kept as a real function rather than an inlined string in
 * `itineraryPrompt.ts` because before this existed the model invented every nightly rate, and the
 * invented numbers were not close: measured against tier-matched inventory across six saved
 * trips, lodging was understated by 22% to 399%, while every one of those plans still reported
 * hitting 85-100% of budget. The budget line was arithmetic over a number nobody had checked.
 *
 * Its own module for the same reason `dietaryPrompt.ts` is one — `itineraryPrompt.ts` cannot be
 * loaded from a `.test.mjs`, and the rule below is worth testing.
 */

/**
 * What to do about lodging, given there is never a real listing to point at: choose the TYPE of
 * stay, not a specific named property.
 */
export function lodgingInstruction(): string {
  return `For "lodging", choose the TYPE of stay, not just a hotel. Consider hostels/social guesthouses (solo, younger, tight budget), B&Bs/guesthouses/homestays (local and cultural interests), apartments (families, groups, longer stays), hotels (when convenience, accessibility or a late check-in matters), and stays the destination is genuinely known for — riverside or desert camps, glamping, mountain huts, houseboats, farmstays, ryokan-style inns. When the traveler's interests lean adventurous or outdoorsy, actively offer the adventurous option (e.g. a riverside camp) on the night whose location makes it natural, instead of defaulting to a city hotel — but only where such stays genuinely exist at that destination, and never when the night's weather, a remote location after dark, or a family/accessibility need makes it a bad idea. Phrase the lodging "name" as the type FIRST, then the area — "Boutique hotel in Capitol Hill", "Riverside camp near Shivpuri", "Family apartment in Fremont". Never write it the other way round ("Capitol Hill Boutique Hotel"), which reads as a specific property and invents one that may not exist; name an actual property only when it is itself the draw or needs booking far ahead. Use "note" to say in one line why this type suits this traveler plus ONE alternative of a different type or price band. Keep the same base while consecutive days share an area — switch only when the itinerary's geography actually moves. Never invent specific prices, availability, or ratings beyond the cost estimate.`;
}

/**
 * How that night's lodging is priced — the phrase that lands mid-sentence in the generate prompt.
 */
export function lodgingPricingBasis(): string {
  return "priced to the style above";
}

/**
 * The budget target. Without this the 85-100% target is an unqualified MUST, and the only way to
 * satisfy it on some trips is to invent a cheaper hotel — the defect this feature removes.
 */
export function budgetInstruction(): string {
  return `The itinerary's total cost (lodging + stops combined) MUST come close to the full stated budget (aim for 85-100% of it), not just "under" it. If standard sightseeing and dining wouldn't use up a high budget, add premium extras appropriate to the tier (private guides, exclusive experiences, shopping, spa, upgraded transport) rather than leaving the budget unused.`;
}
