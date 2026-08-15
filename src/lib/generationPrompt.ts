/**
 * Step 6's prompt template — fixed and reusable, holding no trip data whatsoever.
 *
 * Deliberately contains no planning logic: no pacing rules, no clustering or sequencing advice,
 * no weather/hours handling, no output-format spec. All of that lives in the itinerary-planner
 * skill, and restating any of it here would create a second copy to drift out of sync with the
 * first. This template only frames the task and names the artifact to produce.
 */
const GENERATION_INSTRUCTION = `Build the itinerary.

The planning rules above are authoritative — apply them, including the flag branches, the output format they specify, and their rules for handling anything the context marks as missing or estimated.

The trip context is the complete set of facts available. Do not invent facts it doesn't contain: no opening hours, travel times, or events beyond what's listed. Where it marks something unknown or estimated, follow the rules' guidance for that case rather than filling the gap with a plausible guess.

Respond with only the itinerary in the format the rules specify — no preamble, no commentary, no code fences.`;

/**
 * Assembles the one generation call: fixed skill rules, then per-trip facts, then the ask.
 *
 * The ordering is the point — rules and facts stay in separate, labelled blocks so neither the
 * model nor a later reader has to untangle which is which, and Step 7 can reuse the exact same
 * frozen context block against a different ask.
 */
export function buildItineraryGenerationPrompt(params: {
  skill: string;
  tripContext: string;
}): string {
  return `<planning_rules>
${params.skill}
</planning_rules>

<trip_context>
${params.tripContext}
</trip_context>

${GENERATION_INSTRUCTION}`;
}
