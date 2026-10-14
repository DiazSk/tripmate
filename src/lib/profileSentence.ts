import type { TravelerProfile } from "./travelerProfile";
import { travelStyleOf } from "./userAnswers";

const WHO = {
  solo: "You travel solo",
  couple: "You travel as a couple",
  family_with_kids: "You travel as a family with kids",
  other: "You travel in your own kind of group",
} as const;
const PACE = { relaxed: "a relaxed pace", balanced: "a balanced pace", packed: "a packed pace" } as const;
const SEE = {
  iconic: "the headline sights",
  local: "local spots over the headline ones",
  mix: "a mix of the iconic and the local",
} as const;
const WALK = { high: "happy to walk all day", moderate: "walking a moderate amount", low: "keeping the walking easy" } as const;
const CROWDS = { love: "glad of a crowd", mixed: "either way on crowds", avoid: "away from the crowds" } as const;

/**
 * The profile said back as one sentence, so `/profile` shows what the planner will read rather than
 * eight separate answers. Only what was answered: no starred interests, no dietary line.
 */
export function profileSentence(
  p: Pick<TravelerProfile, "group" | "explorerStyle" | "pace" | "discovery" | "energy" | "crowds" | "topPriorities" | "dietary" | "homeCity">
): string {
  const { pace, discovery } = travelStyleOf(p);
  const stars = p.topPriorities.length ? ` What matters most: ${p.topPriorities.join(", ")}.` : "";
  const diet = p.dietary.tags.length ? ` Every food stop is ${p.dietary.tags.join(", ").toLowerCase()}.` : "";
  const home = p.homeCity ? ` You set off from ${p.homeCity.name}.` : "";
  return `${WHO[p.group]}, at ${PACE[pace]}, for ${SEE[discovery]}, ${WALK[p.energy]}, ${CROWDS[p.crowds]}.${stars}${diet}${home}`;
}
