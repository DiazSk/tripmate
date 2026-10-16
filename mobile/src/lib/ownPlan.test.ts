import type { ImportedPlan } from '@/api/types';
import { dayDate, forgetPlaces, isFound, looseAnchors, ownPlanGap, renameStop, sourceLines, suggestedStart } from './ownPlan';

const plan = (days: ImportedPlan['days']): ImportedPlan => ({
  destinationGuess: 'Lisbon, Portugal',
  isPlan: true,
  days,
  loose: [],
  notes: [],
  unread: [],
});

describe('suggestedStart', () => {
  it("prefills the plan's own first date when every day has one", () => {
    expect(suggestedStart(plan([{ date: '2026-11-02', stops: [] }, { date: '2026-11-03', stops: [] }]))).toBe('2026-11-02');
  });
  it('leaves it to the traveller when any day is undated', () => {
    expect(suggestedStart(plan([{ date: '2026-11-02', stops: [] }, { stops: [] }]))).toBe('');
  });
});

describe('forgetPlaces', () => {
  it('forgets where every stop was found, so a corrected destination is looked up again', () => {
    // The read geocoded near its own guess; after "Where" changes those pins may sit on the wrong
    // continent, and the build only looks up stops that have no coordinates.
    const found = plan([{ stops: [{ name: 'A', time: '10:00 AM', note: 'n', lat: 1, lng: 2 }, { name: 'B', lat: 3, lng: 4 }] }]);
    const out = forgetPlaces(found);
    expect(out.days[0].stops).toEqual([{ name: 'A', time: '10:00 AM', note: 'n' }, { name: 'B' }]);
    expect(found.days[0].stops[0].lat).toBe(1);
  });
});

describe('ownPlanGap', () => {
  const undated = plan([{ stops: [{ name: 'Torre de Belém' }] }]);
  it('asks for a start date even on a dated plan, which the screen prefills', () => {
    expect(ownPlanGap(plan([{ date: '2026-11-02', stops: [{ name: 'A' }] }]), 'Lisbon', '')).toBe('Pick the day your trip starts.');
  });
  it('asks for what is missing in screen order', () => {
    expect(ownPlanGap(undated, ' ', '')).toBe('Add where this trip is.');
    expect(ownPlanGap(undated, 'Lisbon', '')).toBe('Pick the day your trip starts.');
    expect(ownPlanGap(undated, 'Lisbon', '2026-11-02')).toBeNull();
  });
  it('refuses a stop with no name', () => {
    expect(ownPlanGap(plan([{ date: '2026-11-02', stops: [{ name: '  ' }] }]), 'Lisbon', '2026-11-02')).toBe(
      'Every stop needs a name.',
    );
  });
});

describe('renameStop', () => {
  it("forgets where the old name was found, so the build looks the new one up", () => {
    const found = plan([{ stops: [{ name: 'Belem Towr', time: '10:00 AM', note: 'early', lat: 1, lng: 2 }] }]);
    const renamed = renameStop(found, 0, 0, 'Torre de Belém');
    expect(renamed.days[0].stops[0]).toEqual({ name: 'Torre de Belém', time: '10:00 AM', note: 'early' });
    expect(isFound(renamed.days[0].stops[0])).toBe(false);
    expect(found.days[0].stops[0].name).toBe('Belem Towr');
  });
});

describe('looseAnchors', () => {
  it('hands the wizard the places as imported wants', () => {
    const list: ImportedPlan = { ...plan([]), isPlan: false, loose: ['LX Factory'] };
    expect(looseAnchors(list)).toEqual([{ name: 'LX Factory', lat: null, lng: null, priority: 'want', source: 'import' }]);
  });
});

describe('sourceLines', () => {
  const text = `Lisbon, Oct 22 to 24

Thu
9:30 Jerónimos Monastery
lunch at Time Out Market

Fri
Tram 28 up to the castle
Castelo de Sao Jorge
lunch at the market again

Sat
Sintra day trip: Pena Palace, then Quinta da Regaleira`;
  const read = plan([
    { stops: [{ name: 'Jeronimos Monastery' }, { name: 'Time Out Market' }] },
    { stops: [{ name: 'Tram 28' }, { name: 'Castelo de São Jorge' }, { name: 'Lunch, Time Out Market' }] },
    { stops: [{ name: 'Pena Palace' }, { name: 'Quinta da Regaleira' }, { name: 'Cabo da Roca' }] },
  ]);
  it('finds each stop by its name, ignoring accents and punctuation, in reading order', () => {
    expect(sourceLines(text, read)).toEqual([
      [3, 4],
      // The second lunch is matched by its words, and from day 2 onward rather than day 1's line.
      [7, 8, 9],
      // Two stops can come from one line; a stop in no line of the text gets no tag.
      [12, 12, null],
    ]);
  });
  it('says nothing for a plan read only from screenshots', () => {
    expect(sourceLines('', read)).toEqual([[null, null], [null, null, null], [null, null, null]]);
  });
});

describe('dayDate', () => {
  it("uses the plan's own date, else counts on from the chosen start", () => {
    expect(dayDate({ date: '2026-10-22' }, 0, '')).toBe('Thu 22 Oct');
    expect(dayDate({}, 2, '2026-10-22')).toBe('Sat 24 Oct');
    expect(dayDate({}, 0, '')).toBe('');
  });
});
