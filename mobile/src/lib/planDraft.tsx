import { createContext, useContext, useMemo, useState } from 'react';

import type {
  GenerateRequest,
  PlanDraft,
  TravelerProfile,
  TripLogistics,
  UserAnswers,
} from '@/api/types';
import { closestTier, tripDays } from '@/lib/tiers';

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

function emptyDraft(): PlanDraft {
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

/** Toggle a tag in a list. Used by both interest and dietary grids. */
export const toggleTag = (list: string[], tag: string) =>
  list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag];

/**
 * Star an interest, capped, and never starred without also being selected.
 *
 * Order is preserved because the order is the weighting: the server reads the first three.
 */
export function toggleStar(draft: PlanDraft, tag: string): Partial<PlanDraft> {
  if (draft.starredInterests.includes(tag)) {
    return { starredInterests: draft.starredInterests.filter((t) => t !== tag) };
  }
  if (draft.starredInterests.length >= MAX_STARRED) return {};
  return {
    starredInterests: [...draft.starredInterests, tag],
    interests: draft.interests.includes(tag) ? draft.interests : [...draft.interests, tag],
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
