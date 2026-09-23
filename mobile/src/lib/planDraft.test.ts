import type { PlanDraft } from '@/api/types';

import {
  MAX_STARRED,
  toGenerateRequest,
  toTravelerProfile,
  toUserAnswers,
  toggleInterest,
  toggleStarred,
  toggleTag,
} from './planDraft';

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

const picks = (selected: string[] = [], starred: string[] = []) => ({ selected, starred });

test('tapping a chip selects it, and tapping again deselects it', () => {
  expect(toggleInterest(picks(), 'Food')).toEqual(picks(['Food']));
  expect(toggleInterest(picks(['Food', 'Nightlife']), 'Food')).toEqual(picks(['Nightlife']));
});

// This rule used to live in the wizard's JSX, where no test could reach it. A starred tag that is
// no longer chosen would weight a plan by something the traveller had just removed.
test('deselecting an interest takes its star with it', () => {
  expect(toggleInterest(picks(['Food', 'Nightlife'], ['Food']), 'Food')).toEqual(
    picks(['Nightlife'], [])
  );
});

test('starring selects the tag too, so a star is never orphaned', () => {
  expect(toggleStarred(picks(), 'Food')).toEqual(picks(['Food'], ['Food']));
});

// The order is the weighting — the server reads the first three — so it must be preserved.
test('stars keep the order they were added in', () => {
  let p = picks(['Food', 'Nightlife', 'Shopping']);
  for (const tag of ['Shopping', 'Food']) p = toggleStarred(p, tag);
  expect(p.starred).toEqual(['Shopping', 'Food']);
});

// Silently dropping an earlier choice to honour the latest is the worse surprise, so the cap
// refuses rather than evicting.
test('the fourth star is refused rather than silently replacing one', () => {
  const full = picks(['A', 'B', 'C', 'D'], ['A', 'B', 'C']);
  expect(full.starred).toHaveLength(MAX_STARRED);
  expect(toggleStarred(full, 'D')).toEqual(full);
});

test('unstarring leaves the tag selected', () => {
  expect(toggleStarred(picks(['Food'], ['Food']), 'Food')).toEqual(picks(['Food'], []));
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
