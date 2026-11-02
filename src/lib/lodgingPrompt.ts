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
  return `For "lodging", choose the TYPE of stay, not just a hotel. Consider hostels/social guesthouses (solo, younger, tight budget), B&Bs/guesthouses/homestays (local and cultural interests), apartments (families, groups, longer stays), hotels (when convenience, accessibility or a late check-in matters), and stays the destination is genuinely known for: riverside or desert camps, glamping, mountain huts, houseboats, farmstays, ryokan-style inns. When the traveler's interests lean adventurous or outdoorsy, actively offer the adventurous option (e.g. a riverside camp) on the night whose location makes it natural, instead of defaulting to a city hotel, but only where such stays genuinely exist at that destination, and never when the night's weather, a remote location after dark, or a family/accessibility need makes it a bad idea. Phrase the lodging "name" as the type FIRST, then the area: "Boutique hotel in Capitol Hill", "Riverside camp near Shivpuri", "Family apartment in Fremont". Never write it the other way round ("Capitol Hill Boutique Hotel"), which reads as a specific property and invents one that may not exist; name an actual property only when it is itself the draw or needs booking far ahead. Use "note" to say in one line why this type suits this traveler plus ONE alternative of a different type or price band. Keep the same base while consecutive days share an area; switch only when the itinerary's geography actually moves. Never invent specific prices, availability, or ratings beyond the cost estimate.`;
}

/**
 * How that night's lodging is priced — the phrase that lands mid-sentence in the generate prompt.
 */
export function lodgingPricingBasis(): string {
  return "priced to the style above as one night for the whole party (every room it needs), like every other cost";
}

/**
 * The one shared budget string, spliced into both legacy prompts (`itineraryPrompt.ts:217` and
 * `:250`) and mirrored by SKILL.md §5. The three must not drift.
 *
 * This used to ask for 85-100% of the stated budget and, failing that, for premium extras to
 * consume the rest. A stated budget almost always means "do not exceed this", and the rule turned
 * a good $2,900 trip into a padded $4,700 one. `evaluateBudget` in guardrails.ts has always
 * treated the budget as a pure ceiling, so the code and the prompt were already disagreeing; this
 * sides with the code.
 */
export function budgetInstruction(): string {
  return `Treat the stated budget as a ceiling, not a target to reach. A strong itinerary does not need to spend all of it. Stay comfortably within it, prefer value and fit over spending, and where practical leave roughly 10-15% unspent for unplanned transport, price variation, tips and taxes. Let the tier set the style of what you recommend. If the traveler explicitly asked to use the full budget, to make it luxurious, or for the best possible within the amount, premium upgrades are welcome where they genuinely improve the trip. Never add an experience primarily because money remains.`;
}
