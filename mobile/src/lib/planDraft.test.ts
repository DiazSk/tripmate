import type { PlanDraft } from '@/api/types';

import {
  MAX_STARRED,
  emptyDraft,
  toGenerateRequest,
  toTravelerProfile,
  toUserAnswers,
  cycleInterest,
  partyForGroup,
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
    anchors: [],
    mustInclude: '',
    avoid: '',
    constraintsNote: '',
    ...overrides,
  };
}

test('toggleTag adds then removes', () => {
  expect(toggleTag([], 'Food')).toEqual(['Food']);
  expect(toggleTag(['Food', 'Nightlife'], 'Food')).toEqual(['Nightlife']);
});

const picks = (selected: string[] = [], starred: string[] = []) => ({ selected, starred });

// Every tap advances the same chip and the third gets you back where you started. This is the
// whole interaction: there is no second gesture, so anything unreachable here is unreachable.
test('a chip cycles off, chosen, starred, off again', () => {
  let p = picks();
  p = cycleInterest(p, 'Food');
  expect(p).toEqual(picks(['Food']));
  p = cycleInterest(p, 'Food');
  expect(p).toEqual(picks(['Food'], ['Food']));
  p = cycleInterest(p, 'Food');
  expect(p).toEqual(picks());
});

// A starred tag that is no longer chosen would weight a plan by something just removed.
test('clearing a chip takes its star with it', () => {
  expect(cycleInterest(picks(['Food', 'Nightlife'], ['Food']), 'Food')).toEqual(
    picks(['Nightlife'], [])
  );
});

// The bug this whole rule exists for: with the stars full, a tap on a chosen-but-unstarred chip
// could neither star nor clear, so it did nothing and said nothing. The middle rung is skipped.
test('with the stars full a chosen chip clears instead of stalling', () => {
  const full = picks(['A', 'B', 'C', 'D'], ['A', 'B', 'C']);
  expect(full.starred).toHaveLength(MAX_STARRED);
  const after = cycleInterest(full, 'D');
  expect(after).not.toEqual(full);
  expect(after).toEqual(picks(['A', 'B', 'C'], ['A', 'B', 'C']));
});

// The cap is still never an eviction — it is simply unreachable until you clear one yourself.
test('a fourth star cannot be reached by tapping', () => {
  const full = picks(['A', 'B', 'C', 'D'], ['A', 'B', 'C']);
  expect(cycleInterest(full, 'D').starred).toEqual(['A', 'B', 'C']);
});

// The order is the weighting — the server reads the first three — so it must be preserved.
test('stars keep the order they were added in', () => {
  let p = picks(['Food', 'Nightlife', 'Shopping']);
  for (const tag of ['Shopping', 'Food']) p = cycleInterest(p, tag);
  expect(p.starred).toEqual(['Shopping', 'Food']);
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

test('anchors are sent only when the traveler gathered at least one', () => {
  expect(toUserAnswers(draft()).anchors).toBeUndefined();
  const withAnchor = draft({
    anchors: [{ name: 'Louvre', lat: 48.86, lng: 2.33, priority: 'must' as const }],
  });
  expect(toUserAnswers(withAnchor).anchors).toEqual([
    { name: 'Louvre', lat: 48.86, lng: 2.33, priority: 'must' },
  ]);
});

test('named requirements reach the payload as lists, and blanks drop out', () => {
  const draft = { ...emptyDraft(), mustInclude: 'Louvre Museum, Versailles', avoid: '', constraintsNote: '  ' };
  const answers = toUserAnswers(draft);
  expect(answers.mustInclude).toEqual(['Louvre Museum', 'Versailles']);
  expect(answers.avoid).toBeUndefined();
  expect(answers.constraintsNote).toBeUndefined();
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
    // Durable like dietary: a wheelchair user should not restate it on every trip.
    accessibility: { stepFreeRequired: false, limitStairs: false, note: '' },
  });
  expect(Object.keys(profile)).not.toContain('startDate');
  expect(Object.keys(profile)).not.toContain('budget');
});

// The defect this rule removes: the preset and the counters were two answers to one question, so
// "Solo" could stand over three adults and "Family with kids" over none.
test('a preset seeds the counters it names, and seeds nothing when it names no number', () => {
  expect(partyForGroup('solo')).toEqual({ adults: 1, children: 0, infants: 0 });
  expect(partyForGroup('couple')).toEqual({ adults: 2, children: 0, infants: 0 });
  // The label asserts a child; a family over zero children is the contradiction being removed.
  expect(partyForGroup('family_with_kids')?.children).toBeGreaterThan(0);
  // "Friends / group" is the one option naming no headcount, which is why it asks in words.
  expect(partyForGroup('other')).toBeNull();
});
