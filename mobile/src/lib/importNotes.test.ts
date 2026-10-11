import { importNoteLines, showsHealthOnOpen } from './importNotes';

describe('importNoteLines', () => {
  it('says each thing an import could not do, once', () => {
    expect(importNoteLines({ importNotes: ['hoursUnchecked', 'costsUnestimated'] })).toEqual([
      "Opening hours not checked — the map data couldn't be reached.",
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
