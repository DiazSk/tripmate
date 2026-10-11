import type { ImportedPlan } from '@/api/types';
import { isFound, looseAnchors, needsStartDate, ownPlanGap, renameStop } from './ownPlan';

const plan = (days: ImportedPlan['days']): ImportedPlan => ({
  destinationGuess: 'Lisbon, Portugal',
  isPlan: true,
  days,
  loose: [],
  notes: [],
  unread: [],
});

describe('needsStartDate', () => {
  it('asks when any day has no date, as the server does', () => {
    expect(needsStartDate(plan([{ date: '2026-11-02', stops: [] }, { stops: [] }]))).toBe(true);
    expect(needsStartDate(plan([{ date: '2026-11-02', stops: [] }]))).toBe(false);
  });
});

describe('ownPlanGap', () => {
  const undated = plan([{ stops: [{ name: 'Torre de Belém' }] }]);
  it('asks for what is missing in screen order', () => {
    expect(ownPlanGap(undated, ' ', '')).toBe('Add where this trip is.');
    expect(ownPlanGap(undated, 'Lisbon', '')).toBe('Pick the day your trip starts.');
    expect(ownPlanGap(undated, 'Lisbon', '2026-11-02')).toBeNull();
  });
  it('refuses a stop with no name', () => {
    expect(ownPlanGap(plan([{ date: '2026-11-02', stops: [{ name: '  ' }] }]), 'Lisbon', '')).toBe(
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
