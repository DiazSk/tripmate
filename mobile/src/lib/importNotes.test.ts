import { emptyDayFindings, importNoteLines, showsHealthOnOpen } from './importNotes';

describe('importNoteLines', () => {
  it('says each thing an import could not do, once', () => {
    expect(importNoteLines({ importNotes: ['hoursUnchecked', 'costsUnestimated'] })).toEqual([
      "Opening hours not checked. The map data couldn't be reached.",
      "Couldn't estimate costs, so the budget check is off for this trip.",
    ]);
  });

  it('says nothing for a plan with no notes', () => {
    expect(importNoteLines({})).toEqual([]);
  });
});

describe('showsHealthOnOpen', () => {
  it('opens on health for a plan TripMate is checking, not one it wrote', () => {
    expect(showsHealthOnOpen({ origin: 'imported' })).toBe(true);
    expect(showsHealthOnOpen({ origin: 'generated' })).toBe(false);
    expect(showsHealthOnOpen({})).toBe(false);
  });
});

describe('emptyDayFindings', () => {
  const empty = { rule: 'empty' as const, dayIndex: 2, message: 'Nothing is planned on day 3 yet.' };
  const pace = { rule: 'pace' as const, dayIndex: 2, message: 'A long day.' };

  it('gives an empty day its own finding, so "Fix this" has somewhere to live', () => {
    expect(emptyDayFindings({ stops: [] }, [empty, pace])).toEqual([empty]);
  });

  it('gives a day with stops nothing — its findings already sit on its rows', () => {
    expect(emptyDayFindings({ stops: [{}] }, [empty])).toEqual([]);
  });
});
