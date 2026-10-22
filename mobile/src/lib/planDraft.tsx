import { createContext, useContext, useMemo, useState } from 'react';

import { IDEA_INTERESTS } from '@shared/ideaRead';
import { legacyExplorerStyle } from '@shared/userAnswers';

import type {
  CrowdPreference,
  DiscoveryPreference,
  EnergyLevel,
  PacePreference,
  GenerateRequest,
  GroupType,
  PartyCounts,
  PlanDraft,
  TravelerProfile,
  TripLogistics,
  UserAnswers,
} from '@/api/types';
import { closestTier, perPersonBudget, tripDays } from '@/lib/tiers';

/**
 * The four option vocabularies, in one place.
 *
 * They were written twice — as `{value,label}[]` in the plan wizard and as `Record<T, string>`
 * label maps on the Profile tab — which is two chances for the same enum to be described two ways
 * to the same person. Both screens now read these, and the label maps are gone.
 */
export const GROUPS: { value: GroupType; label: string }[] = [
  { value: 'solo', label: 'Solo' },
  { value: 'couple', label: 'Couple' },
  { value: 'family_with_kids', label: 'Family with kids' },
  { value: 'other', label: 'Friends / group' },
];

/**
 * The counters a preset implies, or `null` where it implies none.
 *
 * "Who's travelling" and "Party" were two questions that happened to ask the same thing. Nothing
 * reconciled them — *Solo* could stand over three adults, *Family with kids* over none — and the
 * Review step then printed the counters and dropped the preset on the floor unless it was `other`.
 * So the preset is a shortcut *into* the counters rather than a second answer: picking one fills
 * them in, and they stay editable afterwards.
 *
 * `other` seeds nothing on purpose. It is the one option naming no number — "five college friends"
 * is a headcount nobody can guess — which is exactly why it is the option that reveals the
 * free-text field. `family_with_kids` seeds a child because the label asserts one, and a family
 * preset standing over zero children is the contradiction this exists to remove.
 */
export function partyForGroup(group: GroupType): PartyCounts | null {
  switch (group) {
    case 'solo':
      return { adults: 1, children: 0, infants: 0 };
    case 'couple':
      return { adults: 2, children: 0, infants: 0 };
    case 'family_with_kids':
      return { adults: 2, children: 1, infants: 0 };
    case 'other':
      return null;
  }
}

/**
 * The other direction: the preset the counters now describe, so the two never state different
 * facts. A preset seeds the counters (`partyForGroup`); a counter changed by hand re-derives the
 * preset here, which is what makes "Solo" over three adults unreachable.
 *
 * Any child or infant is a family. One adult is solo. Two is a couple unless the traveller already
 * said "Friends / group", which two friends are. Three or more adults is a group.
 */
export function groupForParty(party: PartyCounts, current: GroupType): GroupType {
  if (party.children + party.infants > 0) return 'family_with_kids';
  if (party.adults <= 1) return 'solo';
  if (party.adults === 2) return current === 'other' ? 'other' : 'couple';
  return 'other';
}

/**
 * Two questions, where there was one.
 *
 * "How you like to explore" offered `packed`, `relaxed`, `offbeat` and `mixed` — the first two
 * about how full a day is, the third about which places fill it, and the fourth silent on which
 * it answered. A packed off-the-beaten-path trip was unsayable, and `offbeat` quietly set a
 * ceiling of three stops a day on the strength of an answer about taste. The server keeps
 * reading the old field for every stored row; see `travelStyleOf`.
 */
export const PACES: { value: PacePreference; label: string }[] = [
  { value: 'relaxed', label: 'A few things, done well' },
  // Not "a comfortable amount": that is already how ENERGY spells `moderate`, and the two
  // sit side by side on the Review step's Pace row, which read "A comfortable amount · A
  // comfortable amount".
  { value: 'balanced', label: 'A balanced day' },
  { value: 'packed', label: 'See as much as possible' },
];

export const DISCOVERIES: { value: DiscoveryPreference; label: string }[] = [
  { value: 'iconic', label: 'The famous things' },
  { value: 'local', label: 'Off the beaten path' },
  { value: 'mix', label: 'A bit of both' },
];

export const ENERGY: { value: EnergyLevel; label: string }[] = [
  { value: 'high', label: 'Happy to walk all day' },
  { value: 'moderate', label: 'A comfortable amount' },
  { value: 'low', label: 'Prefer it gentle' },
];

export const CROWDS: { value: CrowdPreference; label: string }[] = [
  { value: 'love', label: 'Love the buzz' },
  { value: 'mixed', label: 'Some of each' },
  { value: 'avoid', label: 'Keep it quiet' },
];

/** The label for one value, or the raw value if somebody adds an enum case and forgets the list. */
export const labelOf = <T extends string>(options: { value: T; label: string }[], value: T) =>
  options.find((option) => option.value === value)?.label ?? value;

/** Interests, from `UserAnswers.swift`; the server's idea reader picks from the same list, so it is shared. */
export const INTERESTS: string[] = [...IDEA_INTERESTS];

/**
 * **Starring is what actually discriminates between travellers** — everyone picks four or five
 * tags, so the unstarred set flattens into noise. The server slices to three anyway, so the cap
 * here is about the traveller knowing which three counted.
 */
export const MAX_STARRED = 3;

/** Deliberately short rather than an attempt to enumerate every diet; the note covers the rest. */
export const DIETARY_TAGS = [
  'Vegetarian',
  'Vegan',
  'Pescatarian',
  'Halal',
  'Kosher',
  'Gluten-free',
  'Dairy-free',
  'Nut allergy',
];

/** The starting draft. Exported so the Profile tab can seed a first profile from it rather than
 *  writing a second set of defaults that would drift from these. */
export function emptyDraft(): PlanDraft {
  return {
    destination: '',
    startDate: '',
    endDate: '',
    budget: 0,
    budgetBasis: 'whole_party',
    destinationMissed: false,
    group: 'solo',
    groupOther: '',
    party: { adults: 1, children: 0, infants: 0 },
    logistics: {},
    purpose: '',
    pace: 'balanced',
    discovery: 'mix',
    energy: 'moderate',
    crowds: 'mixed',
    interests: [],
    starredInterests: [],
    dietary: { tags: [], note: '' },
    accessibility: { stepFreeRequired: false, limitStairs: false, note: '' },
    selectedPois: [],
    customPois: [],
    anchors: [],
    mustInclude: '',
    avoid: '',
    constraintsNote: '',
  };
}

/** What a link into the wizard may say — the landing's sample plans and its closing form. */
export type PlanPrefillParams = {
  destination?: string;
  start?: string;
  end?: string;
  budget?: string;
  adults?: string;
  children?: string;
  /** A `PACES` value; anything else is ignored. */
  pace?: string;
  /** Places to include, comma-separated, as the Must-include field takes them. */
  must?: string;
  /** `INTERESTS` labels, comma-separated; unknown ones are dropped. */
  into?: string;
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const count = (raw: string | undefined, min: number, max: number) => {
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/**
 * The starting draft, filled from a link where the link speaks for a field.
 *
 * Mirrors the web's `startPlanning`: only what a sample plan or the landing form can honestly say
 * is written — where, when, the budget and the party — and everything else stays `emptyDraft`'s.
 * The group falls out of the party (any children → family, one adult → solo, else couple), the
 * same rule the web uses. A value that does not parse is ignored rather than trusted: these
 * arrive as URL params, which anything can construct.
 */
export function draftFromPrefill(params: PlanPrefillParams): PlanDraft {
  return { ...emptyDraft(), ...prefillPatch(params) };
}

/** Only the fields a link speaks for, and only the ones that parse: `{}` for a link that says nothing. */
export function prefillPatch(params: PlanPrefillParams): Partial<PlanDraft> {
  const patch: Partial<PlanDraft> = {};
  const destination = params.destination?.trim().slice(0, 120);
  if (destination) patch.destination = destination;
  if (params.start && params.end && ISO_DAY.test(params.start) && ISO_DAY.test(params.end) && params.start <= params.end) {
    patch.startDate = params.start;
    patch.endDate = params.end;
  }
  const budget = count(params.budget, 1, 1_000_000);
  if (budget !== null) patch.budget = budget;
  const adults = count(params.adults, 1, 12);
  const children = count(params.children, 0, 12);
  if (adults !== null || children !== null) {
    const a = adults ?? 1;
    const c = children ?? 0;
    patch.party = { adults: a, children: c, infants: 0 };
    patch.group = c > 0 ? 'family_with_kids' : a === 1 ? 'solo' : 'couple';
  }
  if (PACES.some((p) => p.value === params.pace)) patch.pace = params.pace as PacePreference;
  const must = params.must?.trim().slice(0, 1000);
  if (must) patch.mustInclude = must;
  const into = params.into?.split(',').map((s) => s.trim()).filter((s) => INTERESTS.includes(s));
  if (into?.length) patch.interests = into;
  return patch;
}

type Ctx = {
  draft: PlanDraft;
  /** Also accepts an updater, so a caller can merge against the *latest* draft rather than one
   *  closed over at call time — needed wherever a change can land mid-await (e.g. anchors arriving
   *  from an import while a star was tapped). */
  patch: (changes: Partial<PlanDraft> | ((prev: PlanDraft) => Partial<PlanDraft>)) => void;
};

const PlanDraftContext = createContext<Ctx | null>(null);

/**
 * The draft, for the length of the wizard.
 *
 * Basics passed four fields through router params, which was fine; twenty will not fit there.
 * Holding it in the `plan/` layout also scopes its lifetime to the flow — leaving the wizard
 * discards it, which is the behaviour anyway.
 */
export function PlanDraftProvider({
  children,
  prefill,
}: {
  children: React.ReactNode;
  /** Applied once: the wizard starts from it and the traveller's edits win from then on. */
  prefill?: PlanPrefillParams;
}) {
  const [draft, setDraft] = useState<PlanDraft>(() => (prefill ? draftFromPrefill(prefill) : emptyDraft()));
  /**
   * **A deep link's params arrive one render late, so "read at mount" read nothing.** A pushed
   * route (the landing's buttons) has them on the first render. A link from outside the app
   * (`tripmate://plan/basics?destination=…`) does not: the layout first renders with expo-router's
   * own `{ pop, initial, path }` and gets the real params on the next render, by which time the
   * initializer above has built an empty draft. Every prefilled field was silently dropped.
   *
   * So the link's fields are laid over the draft the first time any arrive, once. Over, not
   * instead: Basics has already written its default dates by then, and the link's own dates
   * should replace those, while everything the link does not mention stays as it is. Nobody can
   * have typed in the one render between the two.
   */
  //
  // During render rather than in an effect, React's pattern for state that follows a prop: the
  // corrected draft is in place before anything paints, with no extra commit in between.
  const [applied, setApplied] = useState(() => (prefill ? Object.keys(prefillPatch(prefill)).length > 0 : false));
  if (!applied && prefill) {
    const changes = prefillPatch(prefill);
    if (Object.keys(changes).length > 0) {
      setApplied(true);
      setDraft((prev) => ({ ...prev, ...changes }));
    }
  }
  const value = useMemo<Ctx>(
    () => ({
      draft,
      patch: (changes) =>
        setDraft((prev) => ({ ...prev, ...(typeof changes === 'function' ? changes(prev) : changes) })),
    }),
    [draft]
  );
  return <PlanDraftContext.Provider value={value}>{children}</PlanDraftContext.Provider>;
}

export function usePlanDraft(): Ctx {
  const ctx = useContext(PlanDraftContext);
  if (!ctx) throw new Error('usePlanDraft must be used inside the plan layout');
  return ctx;
}

/** Toggle a tag in a list. Used by the grids that have no starring — dietary, and the POI picker. */
export const toggleTag = (list: string[], tag: string) =>
  list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag];

/**
 * The interest grid's rule, over a plain pair of lists.
 *
 * **Lists rather than a `PlanDraft`, because two screens hold the same pair under different
 * names** — the wizard calls them `interests`/`starredInterests`, the Profile tab receives them
 * from the server as `priorities`/`topPriorities`. Keying the rules to one screen's field names is
 * what made the other screen inline its own copy.
 *
 * It was two rules on two gestures and is now one on one; see `cycleInterest`.
 */
export type Picks = { selected: string[]; starred: string[] };

/**
 * Tap a chip: off → chosen → starred → off.
 *
 * **One rule on one gesture, because the two-gesture version was unusable.** A tap used to mean
 * "choose" on an unchosen chip and "star" on a chosen one, with removal bound to a long-press that
 * nothing on screen mentioned — so the only way to un-choose something was a gesture nobody was
 * told about, and once three tags were starred a tap on a chosen-but-unstarred chip did nothing at
 * all: it could not star (full) and it could not un-choose (wrong gesture). A control that ignores
 * you is worse than one that does the wrong thing, because there is nothing to undo and nothing to
 * learn from.
 *
 * So tapping always advances, and a third tap always gets you back to where you started. **When
 * the stars are full the middle rung is skipped** — a chosen chip goes straight off, rather than
 * stopping on a star it cannot have. That is the one place the cycle is not literal, and it is the
 * whole reason the dead tap existed.
 *
 * Two older rules survive inside it. Clearing a chip **takes its star with it**: a starred tag that
 * is no longer chosen would weight a plan by something the traveller just removed. And a fourth
 * star is still never an eviction — it simply cannot be reached, because you have to clear one
 * yourself first. Order is preserved throughout, since the order *is* the weighting: the server
 * reads the first three.
 */
export function cycleInterest(picks: Picks, tag: string): Picks {
  if (picks.starred.includes(tag)) {
    return {
      selected: picks.selected.filter((t) => t !== tag),
      starred: picks.starred.filter((t) => t !== tag),
    };
  }
  if (!picks.selected.includes(tag)) {
    return { selected: [...picks.selected, tag], starred: picks.starred };
  }
  if (picks.starred.length >= MAX_STARRED) {
    return { selected: picks.selected.filter((t) => t !== tag), starred: picks.starred };
  }
  return { selected: picks.selected, starred: [...picks.starred, tag] };
}

const hasText = (v?: string) => !!v?.trim();

/** Comma-separated as typed, split here. `undefined` for an empty result, never `[]` — the server
 *  and the guardrail both branch on "did they name anything", and an empty array reads as a
 *  demand for nothing rather than as silence. */
const namedList = (raw: string) => {
  const items = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
};

/** Nothing said means the whole object is dropped, rather than sent as a shape full of blanks. */
function logisticsOrNull(l: TripLogistics): TripLogistics | null {
  const any =
    hasText(l.arrivalTime) ||
    hasText(l.arrivalPoint) ||
    hasText(l.departureTime) ||
    hasText(l.departurePoint) ||
    hasText(l.stayBooked);
  return any ? l : null;
}

export function toUserAnswers(draft: PlanDraft): UserAnswers {
  const { dietary, accessibility } = draft;
  const dietarySaid = dietary.tags.length > 0 || hasText(dietary.note);
  const accessSaid =
    accessibility.stepFreeRequired || accessibility.limitStairs || hasText(accessibility.note);
  return {
    purpose: draft.purpose.trim() || undefined,
    // The pair is the answer; the legacy field is written beside it so a reader that only
    // knows the old shape — a stored row, the frozen Swift app — still gets something true.
    pace: draft.pace,
    discovery: draft.discovery,
    explorerStyle: legacyExplorerStyle(draft),
    group: draft.group,
    groupOther: draft.groupOther.trim() || undefined,
    party: draft.party,
    logistics: logisticsOrNull(draft.logistics),
    energy: draft.energy,
    crowds: draft.crowds,
    budget: draft.budget,
    budgetBasis: draft.budgetBasis,
    priorities: draft.interests,
    topPriorities: draft.starredInterests,
    selectedPois: draft.selectedPois.length ? draft.selectedPois : undefined,
    customPois: draft.customPois.length ? draft.customPois : undefined,
    anchors: draft.anchors.length ? draft.anchors : undefined,
    dietary: dietarySaid ? dietary : null,
    accessibility: accessSaid ? accessibility : null,
    mustInclude: namedList(draft.mustInclude),
    avoid: namedList(draft.avoid),
    constraintsNote: draft.constraintsNote.trim() || undefined,
  };
}

export function toGenerateRequest(draft: PlanDraft): GenerateRequest {
  const days = tripDays(draft.startDate, draft.endDate);
  return {
    destination: draft.destination.trim(),
    startDate: draft.startDate,
    endDate: draft.endDate,
    budget: draft.budget,
    tier: closestTier(perPersonBudget(draft.budget, draft.budgetBasis, draft.party), days),
    preferences: { tags: draft.interests },
    userAnswers: toUserAnswers(draft),
    dietary: draft.dietary.tags.length || hasText(draft.dietary.note) ? draft.dietary : null,
  };
}

/**
 * The half of a draft that stays true between trips.
 *
 * Dates, budget and pinned places are deliberately excluded: a business trip and an anniversary
 * are the same person.
 */
export function toTravelerProfile(draft: PlanDraft): TravelerProfile {
  return {
    group: draft.group,
    pace: draft.pace,
    discovery: draft.discovery,
    explorerStyle: legacyExplorerStyle(draft),
    energy: draft.energy,
    crowds: draft.crowds,
    priorities: draft.interests,
    topPriorities: draft.starredInterests,
    dietary: draft.dietary,
    accessibility: draft.accessibility,
  };
}
