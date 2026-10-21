import { fromUtcDay, toUtcDay } from './utcDay';

// West of Greenwich, where the day was lost: picking the 21st in PDT set the 20th. Node applies a
// change to TZ from the next Date call on.
process.env.TZ = 'America/Los_Angeles';

test('a day the Android dialog returns at UTC midnight reads back as that local day', () => {
  const picked = new Date(Date.UTC(2026, 10, 21));
  expect(picked.getDate()).toBe(20); // the bug: read locally, it is the evening before
  expect(fromUtcDay(picked).getDate()).toBe(21);
});

test('a local day goes into the dialog as that day at UTC midnight', () => {
  expect(toUtcDay(new Date(2026, 10, 26)).toISOString()).toBe('2026-11-26T00:00:00.000Z');
});
