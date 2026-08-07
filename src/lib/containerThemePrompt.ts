const SHAPE_HINT = `{"containerType":"vintage_envelope|furoshiki_wrap|travel_trunk|classic_box","themeTitle":"short evocative title","primaryColor":"#RRGGBB","stampOrIcon":"short_snake_case_icon_name","lidType":"envelope_flap|side_hinge_lid|knot_open"}`;

/**
 * Picks a themed "unboxing container" for the search→generate transition
 * animation, based on the destination's culture/geography. Kept as its own
 * tiny classification call (not folded into the itinerary prompt) so it can
 * resolve fast and independently — it's decorative, not something worth
 * blocking the actual itinerary generation on.
 */
export function buildContainerThemePrompt(destination: string): string {
  return `Pick a themed "unboxing container" for a trip-planning app, for a traveler headed to: "${destination}".

Choose whichever containerType best fits the destination's culture/geography:
- "vintage_envelope" (lidType must be "envelope_flap") — destinations with a strong postal/airmail/letter-writing romance
- "furoshiki_wrap" (lidType must be "knot_open") — destinations with a textile-wrapping or gift-wrapping cultural tradition (e.g. Japan)
- "travel_trunk" (lidType must be "side_hinge_lid") — destinations evoking old-world exploration/adventure travel
- "classic_box" (lidType must be "side_hinge_lid") — safe default if the destination is general, ambiguous, or you're unsure

Also pick:
- themeTitle: a short, evocative title (3-5 words), e.g. "Airmail to Kyoto"
- primaryColor: a hex color fitting the destination's flag/culture/mood
- stampOrIcon: one short snake_case icon concept, e.g. "cherry_blossom", "eiffel_tower", "compass", "palm_tree"

Respond with ONLY valid JSON, no markdown code fences, no commentary, in exactly this shape:
${SHAPE_HINT}`;
}
