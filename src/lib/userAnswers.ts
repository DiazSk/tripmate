import type {
  CrowdBias,
  CrowdPreference,
  EnergyLevel,
  ExplorerStyle,
  FamilyRules,
  GroupType,
  MobilityProfile,
  Pace,
  ResolvedFlags,
  UserAnswers,
} from "./types";

// --- Tunable weights -------------------------------------------------------------------------
// Deliberately named constants rather than inline numbers: these are a sane default, not a law,
// and they're the first thing anyone will want to adjust after reading a few real itineraries.

/** Ceiling only. What the traveler *aspires* to, before their own constraints reduce it. */
export const PACE_CEILING_BY_STYLE: Record<ExplorerStyle, number> = {
  packed: 5,
  mixed: 4,
  relaxed: 3,
  offbeat: 3,
};

/** Energy is the strongest step-down: it's the one answer about physical capacity. */
export const PACE_STEP_BY_ENERGY: Record<EnergyLevel, number> = {
  high: 0,
  moderate: -1,
  low: -2,
};

/** Travelling with kids costs a stop: breaks, slower transitions, shorter attention. */
export const PACE_STEP_FAMILY = -1;

/** Below this a "day plan" stops being a plan. */
export const PACE_FLOOR = 2;

export const PACE_LABEL_THRESHOLDS = { slowAtOrBelow: 2, moderateAt: 3 } as const;

/** How many priorities the traveler may star. */
export const MAX_STARRED_PRIORITIES = 3;

// --- Derivation ------------------------------------------------------------------------------

export function derivePaceSpotsPerDay(
  explorerStyle: ExplorerStyle,
  group: GroupType,
  energy: EnergyLevel
): number {
  const ceiling = PACE_CEILING_BY_STYLE[explorerStyle];
  const stepped =
    ceiling + PACE_STEP_BY_ENERGY[energy] + (group === "family_with_kids" ? PACE_STEP_FAMILY : 0);
  return Math.max(stepped, PACE_FLOOR);
}

export function labelPace(spotsPerDay: number): Pace {
  if (spotsPerDay <= PACE_LABEL_THRESHOLDS.slowAtOrBelow) return "slow";
  if (spotsPerDay === PACE_LABEL_THRESHOLDS.moderateAt) return "moderate";
  return "fast";
}

/** Energy alone decides this. Someone who says they'd rather keep it easy gets tighter walking
 *  legs, fewer stairs and built-in rests regardless of anything else they picked. */
export function deriveMobilityProfile(energy: EnergyLevel): MobilityProfile {
  const constrained = energy === "low";
  return {
    walkLegCap: constrained ? "tight" : "normal",
    minimizeStairs: constrained,
    restBreaks: constrained,
    preferTransitOverLongWalks: constrained,
  };
}

export function deriveCrowdBias(crowds: CrowdPreference): CrowdBias {
  return {
    preferOffpeakTiming: crowds === "avoid",
    boostOffbeatPois: crowds === "avoid",
    scheduleIconsAtOffpeak: crowds === "avoid",
    marketsAndLivelyOk: crowds === "love",
    peakTimingOk: crowds === "love",
  };
}

/** Starred tags drive POI weighting and day themes; everything else only breaks ties. */
export function derivePrioritiesRanked(
  priorities: string[],
  topPriorities: string[]
): ResolvedFlags["prioritiesRanked"] {
  const primary = topPriorities.slice(0, MAX_STARRED_PRIORITIES);
  return {
    primary,
    tiebreakers: priorities.filter((p) => !primary.includes(p)),
  };
}

export function deriveFamilyRules(group: GroupType): FamilyRules | null {
  if (group !== "family_with_kids") return null;
  return { kidFriendlyBias: true, noLateNight: true, shortTravelLegs: true };
}

/**
 * The whole Part C contract in one call. Deterministic, no LLM, no network — given the same
 * answers it always produces the same flags. Lives here (and is invoked from the reconcile step)
 * rather than in the UI, so there is exactly one place these weights are applied.
 */
export function deriveFlags(answers: UserAnswers): ResolvedFlags {
  const paceSpotsPerDay = derivePaceSpotsPerDay(
    answers.explorerStyle,
    answers.group,
    answers.energy
  );
  return {
    paceSpotsPerDay,
    paceResolved: labelPace(paceSpotsPerDay),
    mobilityProfile: deriveMobilityProfile(answers.energy),
    crowdBias: deriveCrowdBias(answers.crowds),
    prioritiesRanked: derivePrioritiesRanked(answers.priorities, answers.topPriorities),
    familyRules: deriveFamilyRules(answers.group),
  };
}
