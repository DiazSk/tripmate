import { emptyDraft } from './planDraft';
import { planTiles } from './planTiles';

const tile = (id: string, draft = emptyDraft()) => planTiles(draft).find((t) => t.id === id)!;

test('a fresh draft has pace answered and nothing else', () => {
  const done = planTiles(emptyDraft()).filter((t) => t.done).map((t) => t.id);
  expect(done).toEqual(['pace']);
});

test('starred interests lead the line; a pick without a star still counts as answered', () => {
  expect(tile('into', { ...emptyDraft(), interests: ['Food', 'Nightlife'], starredInterests: ['Food'] }).value).toBe('Food');
  expect(tile('into', { ...emptyDraft(), interests: ['Food'] }).done).toBe(true);
});

test('already booked counts the stay, the arrival and the departure, one each', () => {
  const draft = { ...emptyDraft(), logistics: { stayBooked: 'Samode Haveli', arrivalTime: '14:00', arrivalPoint: 'JAI' } };
  expect(tile('booked', draft).value).toBe('2 of 3 added');
});

test('must-sees add picked, named and typed places together', () => {
  const draft = {
    ...emptyDraft(),
    customPois: ['Galta Ji'],
    mustInclude: 'Amber Fort, Hawa Mahal',
    avoid: 'Nightclubs',
  };
  expect(tile('must', draft).value).toBe('3 places, some to skip');
});

test('a step-free need alone answers diet and access', () => {
  const draft = { ...emptyDraft(), accessibility: { stepFreeRequired: true, limitStairs: false, note: '' } };
  expect(tile('needs', draft).done).toBe(true);
});
