import type { PlanDraft } from '@/api/types';

import { MAX_STARRED, toGenerateRequest, toTravelerProfile, toUserAnswers, toggleStar, toggleTag } from './planDraft';

function draft(overrides: Partial<PlanDraft> = {}): PlanDraft {
  return {
    destination: 'Lisbon, Portugal',
    startDate: '2026-10-22',
    endDate: '2026-10-28',
    budget: 1800,
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
    ...overrides,
  };
}

test('toggleTag adds then removes', () => {
  expect(toggleTag([], 'Food')).toEqual(['Food']);
  expect(toggleTag(['Food', 'Nightlife'], 'Food')).toEqual(['Nightlife']);
});

test('starring selects the tag too, so a star is never orphaned', () => {
  const d = draft();
  expect(toggleStar(d, 'Food')).toEqual({ starredInterests: ['Food'], interests: ['Food'] });
});

// The order is the weighting — the server reads the first three — so it must be preserved.
test('stars keep the order they were added in', () => {
  let d = draft({ interests: ['Food', 'Nightlife', 'Shopping'] });
  for (const tag of ['Shopping', 'Food']) d = { ...d, ...toggleStar(d, tag) };
  expect(d.starredInterests).toEqual(['Shopping', 'Food']);
});

test('the fourth star is refused rather than silently replacing one', () => {
  const full = draft({ starredInterests: ['A', 'B', 'C'], interests: ['A', 'B', 'C', 'D'] });
  expect(full.starredInterests).toHaveLength(MAX_STARRED);
  expect(toggleStar(full, 'D')).toEqual({});
});

test('unstarring leaves the tag selected', () => {
  const d = draft({ interests: ['Food'], starredInterests: ['Food'] });
  expect(toggleStar(d, 'Food')).toEqual({ starredInterests: [] });
});

// A shape full of blanks is not the same as saying nothing, and the prompt reads them differently.
test('untouched optional blocks are sent as null, not as empty shapes', () => {
  const answers = toUserAnswers(draft());
  expect(answers.logistics).toBeNull();
  expect(answers.dietary).toBeNull();
  expect(answers.accessibility).toBeNull();
  expect(answers.purpose).toBeUndefined();
  expect(answers.selectedPois).toBeUndefined();
});

test('a single answered field is enough to send its block', () => {
  expect(toUserAnswers(draft({ logistics: { stayBooked: 'Hotel Lisboa' } })).logistics).toEqual({
    stayBooked: 'Hotel Lisboa',
  });
  expect(toUserAnswers(draft({ dietary: { tags: [], note: 'No shellfish' } })).dietary).toEqual({
    tags: [],
    note: 'No shellfish',
  });
  expect(
    toUserAnswers(draft({ accessibility: { stepFreeRequired: true, limitStairs: false, note: '' } }))
      .accessibility
  ).toEqual({ stepFreeRequired: true, limitStairs: false, note: '' });
});

test('whitespace-only text does not count as an answer', () => {
  const answers = toUserAnswers(draft({ purpose: '   ', groupOther: '  ' }));
  expect(answers.purpose).toBeUndefined();
  expect(answers.groupOther).toBeUndefined();
});

test('the generate request derives its tier and carries the answers', () => {
  const request = toGenerateRequest(draft({ interests: ['Food'] }));
  // 7 days at $1800: mid-range's estimate is the nearest.
  expect(request.tier).toBe('midrange');
  expect(request.preferences).toEqual({ tags: ['Food'] });
  expect(request.userAnswers).toBeDefined();
});

// A business trip and an anniversary are the same person: only the durable half carries over.
test('the traveler profile excludes dates, budget and pinned places', () => {
  const profile = toTravelerProfile(
    draft({ interests: ['Food'], starredInterests: ['Food'], customPois: ['Somewhere'] })
  );
  expect(profile).toEqual({
    group: 'solo',
    explorerStyle: 'mixed',
    energy: 'moderate',
    crowds: 'mixed',
    priorities: ['Food'],
    topPriorities: ['Food'],
    dietary: { tags: [], note: '' },
  });
  expect(Object.keys(profile)).not.toContain('startDate');
  expect(Object.keys(profile)).not.toContain('budget');
});
