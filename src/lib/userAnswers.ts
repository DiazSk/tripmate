import type {
  AccessibilityNeeds,
  CrowdBias,
  CrowdPreference,
  EnergyLevel,
  ExplorerStyle,
  FamilyRules,
  GroupType,
  MobilityProfile,
  Pace,
  PartyCounts,
  ResolvedFlags,
  TripLogistics,
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

/** An infant costs another one on top, and for a different reason: naps and feeds take the middle
 *  of the day whether or not the plan allows for them. */
export const PACE_STEP_INFANT = -1;

/** Bounds for the party steppers. Also the clamp applied to a raw POST — see `sanitizeParty`. */
export const PARTY_MAX_PER_BAND = 9;

/** Free text from the form reaches a prompt verbatim, so it gets a length. Generous enough that no
 *  honest answer is truncated, short enough that a pasted essay can't shift the model's attention. */
export const FREE_TEXT_MAX = 120;

/** Below this a "day plan" stops being a plan. */
export const PACE_FLOOR = 2;

export const PACE_LABEL_THRESHOLDS = { slowAtOrBelow: 2, moderateAt: 3 } as const;

/** How many priorities the traveler may star. */
export const MAX_STARRED_PRIORITIES = 3;

// --- Sanitizing ------------------------------------------------------------------------------
// `POST /api/itinerary` takes `userAnswers` as `unknown` and there is no `parseUserAnswers`, so
// these run inside `deriveFlags` — the single point every path (UI, staged pipeline, raw curl,
// benchmark) routes through. Guarding here rather than at each call site means a malformed party
// can't reach a prompt as `NaN` from any of them.

function clampCount(value: unknown, min: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), PARTY_MAX_PER_BAND);
}

/** Returns null for an absent party — "not asked" is a real state, distinct from a party of one. */
export function sanitizeParty(party: PartyCounts | undefined | null): PartyCounts | null {
  if (!party || typeof party !== "object") return null;
  return {
    adults: clampCount(party.adults, 1),
    children: clampCount(party.children, 0),
    infants: clampCount(party.infants, 0),
  };
}

/** Trims, caps, and collapses an empty string to null so callers test one thing, not two. */
export function sanitizeFreeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, FREE_TEXT_MAX);
  return trimmed.length > 0 ? trimmed : null;
}

/** "HH:MM" 24-hour, which is what `<input type="time">` emits. Anything else becomes null rather
 *  than reaching the model as a time it will dutifully schedule around. */
export function sanitizeClock(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return m ? `${m[1]}:${m[2]}` : null;
}

/** Null when every field is empty — an all-null logistics object would make callers render a
 *  heading with nothing under it. */
export function sanitizeLogistics(
  logistics: TripLogistics | undefined | null
): TripLogistics | null {
  if (!logistics || typeof logistics !== "object") return null;
  const clean: TripLogistics = {
    arrivalTime: sanitizeClock(logistics.arrivalTime),
    arrivalPoint: sanitizeFreeText(logistics.arrivalPoint),
    departureTime: sanitizeClock(logistics.departureTime),
    departurePoint: sanitizeFreeText(logistics.departurePoint),
    stayBooked: sanitizeFreeText(logistics.stayBooked),
    originCity: sanitizeFreeText(logistics.originCity),
  };
  return Object.values(clean).some((v) => v !== null) ? clean : null;
}

/**
 * A copy of the answers with every free-form field normalized: counts clamped, clock times either
 * valid or null, text trimmed and capped.
 *
 * `deriveFlags` sanitizes what it reads, but the answers themselves are also rendered directly into
 * `trip-context.md` and the edit context, so the raw object reaching those would put `NaN adults`
 * or a `25:99` arrival in front of the model. Applying this at each barrier — `reconcileTrip`,
 * `buildEditContext` — means neither has to remember to.
 */
export function sanitizeAnswers(answers: UserAnswers): UserAnswers {
  const party = sanitizeParty(answers.party);
  const logistics = sanitizeLogistics(answers.logistics);
  const groupOther = sanitizeFreeText(answers.groupOther);
  return {
    ...answers,
    ...(party ? { party } : {}),
    ...(groupOther ? { groupOther } : {}),
    logistics,
  };
}

// --- Derivation ------------------------------------------------------------------------------

export function derivePaceSpotsPerDay(
  explorerStyle: ExplorerStyle,
  group: GroupType,
  energy: EnergyLevel,
  party: PartyCounts | null = null
): number {
  // `??` fallback: an out-of-enum value (e.g. a raw POST with a bad `explorerStyle`/`energy`)
  // makes the lookup undefined, and undefined + number is NaN — which throws nowhere, so it
  // would otherwise ride silently all the way into the generated prompt.
  const ceiling = PACE_CEILING_BY_STYLE[explorerStyle] ?? PACE_CEILING_BY_STYLE.mixed;
  const energyStep = PACE_STEP_BY_ENERGY[energy] ?? 0;
  const familyStep = travellingWithKids(group, party) ? PACE_STEP_FAMILY : 0;
  // Stacks on the family step rather than replacing it: an infant is an additional cost, not an
  // alternative one. Two steps down from `mixed` is 2 spots/day, which is the floor anyway.
  const infantStep = party && party.infants > 0 ? PACE_STEP_INFANT : 0;
  const stepped = ceiling + energyStep + familyStep + infantStep;
  return Math.max(stepped, PACE_FLOOR);
}

export function labelPace(spotsPerDay: number): Pace {
  if (spotsPerDay <= PACE_LABEL_THRESHOLDS.slowAtOrBelow) return "slow";
  if (spotsPerDay === PACE_LABEL_THRESHOLDS.moderateAt) return "moderate";
  return "fast";
}

/** Energy sets the baseline: someone who says they'd rather keep it easy gets tighter walking legs,
 *  fewer stairs and built-in rests regardless of anything else they picked.
 *
 *  Stated accessibility then overrides it in one direction only — it can tighten the profile, never
 *  loosen it. `energy` answers "how much walking do you want", which is a different question from
 *  "can you manage stairs"; using it as a proxy for both meant a wheelchair user who described
 *  their energy as high got no accommodation at all. `stepFreeRequired` is a hard constraint, so it
 *  pins every field regardless of energy. */
export function deriveMobilityProfile(
  energy: EnergyLevel,
  accessibility?: AccessibilityNeeds | null
): MobilityProfile {
  const constrained = energy === "low";
  const stepFree = accessibility?.stepFreeRequired === true;
  const limitStairs = stepFree || accessibility?.limitStairs === true;
  return {
    walkLegCap: constrained || stepFree ? "tight" : "normal",
    minimizeStairs: constrained || limitStairs,
    restBreaks: constrained || stepFree,
    preferTransitOverLongWalks: constrained || stepFree,
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

/**
 * Kids make a family whatever pill was picked.
 *
 * Gating on `group === "family_with_kids"` alone was fine when that pill was the only way to say
 * there were children. Now that the party counts exist, "Other" with two kids is a family too, and
 * the group arm survives only to keep the pill-only path (and every row written before the counts
 * existed) behaving exactly as it did.
 */
export function travellingWithKids(group: GroupType, party: PartyCounts | null): boolean {
  if (party) return party.children + party.infants > 0 || group === "family_with_kids";
  return group === "family_with_kids";
}

const GROUP_LABELS: Record<GroupType, string> = {
  solo: "solo traveler",
  couple: "couple",
  family_with_kids: "family with kids",
  other: "group",
};

/** The traveler's own words win when they gave any — that is the entire point of the field. */
export function deriveGroupLabel(group: GroupType, groupOther: string | undefined): string {
  const own = sanitizeFreeText(groupOther);
  if (group === "other") return own ?? GROUP_LABELS.other;
  return own ? `${GROUP_LABELS[group] ?? GROUP_LABELS.other} (${own})` : GROUP_LABELS[group] ?? GROUP_LABELS.other;
}

export function deriveFamilyRules(
  group: GroupType,
  party: PartyCounts | null = null
): FamilyRules | null {
  if (!travellingWithKids(group, party)) return null;
  const infants = party ? party.infants > 0 : false;
  return {
    kidFriendlyBias: true,
    noLateNight: true,
    shortTravelLegs: true,
    strollerAccess: infants,
    napWindow: infants,
    // Null, not a guess, when the pill fired the rules and no counts came with it.
    youngestBand: infants ? "infant" : party && party.children > 0 ? "child" : null,
  };
}

/**
 * The whole Part C contract in one call. Deterministic, no LLM, no network — given the same
 * answers it always produces the same flags. Lives here (and is invoked from the reconcile step)
 * rather than in the UI, so there is exactly one place these weights are applied.
 */
export function deriveFlags(answers: UserAnswers): ResolvedFlags {
  const party = sanitizeParty(answers.party);
  const paceSpotsPerDay = derivePaceSpotsPerDay(
    answers.explorerStyle,
    answers.group,
    answers.energy,
    party
  );
  return {
    paceSpotsPerDay,
    paceResolved: labelPace(paceSpotsPerDay),
    mobilityProfile: deriveMobilityProfile(answers.energy, answers.accessibility),
    crowdBias: deriveCrowdBias(answers.crowds),
    prioritiesRanked: derivePrioritiesRanked(answers.priorities, answers.topPriorities),
    familyRules: deriveFamilyRules(answers.group, party),
    partySize: party ? party.adults + party.children + party.infants : null,
    groupLabel: deriveGroupLabel(answers.group, answers.groupOther),
  };
}
