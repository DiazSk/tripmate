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
  };
}

type Ctx = {
  draft: PlanDraft;
  patch: (changes: Partial<PlanDraft>) => void;
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
    () => ({ draft, patch: (changes) => setDraft((prev) => ({ ...prev, ...changes })) }),
    [draft]
  );
  return <PlanDraftContext.Provider value={value}>{children}</PlanDraftContext.Provider>;
}

export function usePlanDraft(): Ctx {
  const ctx = useContext(PlanDraftContext);
  if (!ctx) throw new Error('usePlanDraft must be used inside the plan layout');
  return ctx;
}

/** Toggle a tag in a list. Used by the dietary grid, and by `toggleInterest` below. */
export const toggleTag = (list: string[], tag: string) =>
  list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag];

/**
 * The interest grid's two rules, over a plain pair of lists.
 *
 * **Lists rather than a `PlanDraft`, because two screens hold the same pair under different
 * names** — the wizard calls them `interests`/`starredInterests`, the Profile tab receives them
 * from the server as `priorities`/`topPriorities`. Keying the rules to one screen's field names is
 * what made the other screen inline its own copy.
 *
 * And they were already drifting: rule one below lived nowhere but a `.filter()` inside the
 * wizard's JSX, which is why it had never been tested.
 */
export type Picks = { selected: string[]; starred: string[] };

/** Tap a chip: select or deselect. **Deselecting takes the star with it** — a starred tag that is
 *  no longer chosen would be weighting a plan by something the traveller just removed. */
export function toggleInterest(picks: Picks, tag: string): Picks {
  const selected = toggleTag(picks.selected, tag);
  return selected.includes(tag)
    ? { selected, starred: picks.starred }
    : { selected, starred: picks.starred.filter((t) => t !== tag) };
}

/**
 * Tap a chosen chip's star: star or unstar.
 *
 * Two rules beyond the obvious. **Starring a tag that was not chosen chooses it too**, so a star
 * is never orphaned. And **the fourth star is a silent no-op, not an eviction** of the oldest —
 * quietly dropping someone's earlier choice to honour their latest is the worse surprise.
 *
 * Order is preserved because the order *is* the weighting: the server reads the first three.
 */
export function toggleStarred(picks: Picks, tag: string): Picks {
  if (picks.starred.includes(tag)) {
    return { selected: picks.selected, starred: picks.starred.filter((t) => t !== tag) };
  }
  if (picks.starred.length >= MAX_STARRED) return picks;
  return {
    selected: picks.selected.includes(tag) ? picks.selected : [...picks.selected, tag],
    starred: [...picks.starred, tag],
  };
}

const hasText = (v?: string) => !!v?.trim();

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
    priorities: draft.interests,
    topPriorities: draft.starredInterests,
    selectedPois: draft.selectedPois.length ? draft.selectedPois : undefined,
    customPois: draft.customPois.length ? draft.customPois : undefined,
    dietary: dietarySaid ? dietary : null,
    accessibility: accessSaid ? accessibility : null,
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
  };
}
