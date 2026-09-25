import { createContext, useContext, useMemo, useState } from 'react';

import type {
  CrowdPreference,
  EnergyLevel,
  ExplorerStyle,
  GenerateRequest,
  GroupType,
  PlanDraft,
  TravelerProfile,
  TripLogistics,
  UserAnswers,
} from '@/api/types';
import { closestTier, tripDays } from '@/lib/tiers';

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
  { value: 'other', label: 'Something else' },
];

export const STYLES: { value: ExplorerStyle; label: string }[] = [
  { value: 'packed', label: 'See as much as possible' },
  { value: 'relaxed', label: 'A few things, done well' },
  { value: 'offbeat', label: 'Off the beaten path' },
  { value: 'mixed', label: 'A bit of both' },
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

/** Interests, from `UserAnswers.swift`. */
export const INTERESTS = [
  'Food',
  'Wellness & Fitness',
  'Culture & History',
  'Nightlife',
  'Nature & Outdoors',
  'Shopping',
  'Family-Friendly',
  'Relaxation',
  'Photography',
];

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
    explorerStyle: 'mixed',
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
export function PlanDraftProvider({ children }: { children: React.ReactNode }) {
  const [draft, setDraft] = useState<PlanDraft>(emptyDraft);
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
    explorerStyle: draft.explorerStyle,
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
    tier: closestTier(draft.budget, days),
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
    explorerStyle: draft.explorerStyle,
    energy: draft.energy,
    crowds: draft.crowds,
    priorities: draft.interests,
    topPriorities: draft.starredInterests,
    dietary: draft.dietary,
    accessibility: draft.accessibility,
  };
}
