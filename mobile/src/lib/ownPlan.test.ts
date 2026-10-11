import type { ImportedPlan } from '@/api/types';
import { forgetPlaces, isFound, looseAnchors, ownPlanGap, renameStop, suggestedStart } from './ownPlan';

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
