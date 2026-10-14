import { authGap, crossFieldProblem, gapSentence, hasImportContent, planGap } from './formGap';

const complete = {
  destination: 'Kyoto, Japan',
  startDate: '2026-10-31',
  endDate: '2026-11-06',
  budget: 2600,
};

describe('planGap', () => {
  it('finds nothing to ask for when the form is complete', () => {
    expect(planGap(complete)).toBeNull();
  });

  it('asks for the destination first, in the order the fields appear on screen', () => {
    // Both the destination and the dates are wrong here. The reader is sent to the destination
    // because it is the field nearest the top, not because it is the louder problem — a blocked
    // press should walk down the form rather than around it.
    const gap = planGap({ ...complete, destination: '   ', startDate: '2026-11-06', endDate: '2026-10-31' });
    expect(gap).toEqual({ field: 'destination', reason: "Add where you're going first." });
  });

  it('asks for the budget once the destination is there', () => {
    expect(planGap({ ...complete, budget: 0 })).toEqual({
      field: 'budget',
      reason: 'Add a budget. The plan stays inside it.',
    });
  });

  it('reports a range that ends before it starts, in crossFieldProblem’s own words', () => {
    expect(planGap({ ...complete, startDate: '2026-11-06', endDate: '2026-10-31' })).toEqual({
      field: 'dates',
      reason: 'End date must be on or after the start date.',
    });
  });

  it('reports a trip over 30 days', () => {
    expect(planGap({ ...complete, startDate: '2026-01-01', endDate: '2026-03-01' })).toEqual({
      field: 'dates',
      reason: "Trips over 30 days aren't supported. Please choose a shorter date range.",
    });
  });

  it('asks for dates that are not set at all', () => {
    expect(planGap({ ...complete, startDate: '', endDate: '' })).toEqual({
      field: 'dates',
      reason: 'Pick your arrival and departure dates.',
    });
  });
});

describe('authGap', () => {
  it('finds nothing to ask for when both fields are ready', () => {
    expect(authGap('traveller@example.com', 'fifteen-or-longer')).toBeNull();
  });

  it('asks for the email first', () => {
    expect(authGap('  ', 'short')).toEqual({ field: 'email', reason: 'Add your email address.' });
  });

  it('asks for a longer password', () => {
    expect(authGap('traveller@example.com', 'short')).toEqual({
      field: 'password',
      reason: 'Passwords are at least 15 characters.',
    });
  });

  it('accepts a password of exactly fifteen characters', () => {
    expect(authGap('traveller@example.com', '123456789012345')).toBeNull();
  });

  it('still asks at fourteen', () => {
    expect(authGap('traveller@example.com', '12345678901234')?.field).toBe('password');
  });
});

describe('crossFieldProblem', () => {
  it('says nothing while either date is unset, so a half-filled form is not scolded', () => {
    expect(crossFieldProblem('', '2026-11-06')).toBeUndefined();
  });
});

describe('hasImportContent', () => {
  it('is false for an empty box with no screenshots', () => {
    expect(hasImportContent('', 0)).toBe(false);
  });

  it('is false for whitespace only, so a press focuses the box instead of posting nothing', () => {
    expect(hasImportContent('   \n  ', 0)).toBe(false);
  });

  it('is true for a pasted line', () => {
    expect(hasImportContent('https://example.com/place', 0)).toBe(true);
  });

  it('is true for screenshots with an empty box', () => {
    expect(hasImportContent('', 2)).toBe(true);
  });
});

describe('gapSentence', () => {
  const dates = planGap({ ...complete, startDate: '2026-11-06', endDate: '2026-10-31' });

  it('says nothing when the screen is already showing that exact sentence', () => {
    // The date rules feed two things: the coral note the screen renders the moment a range goes
    // wrong, and the dates gap's own reason. They are the same string, so a blocked press used
    // to print it a second time in muted directly under the coral one — and since the dates gap
    // focuses nothing, that duplicate was the *entire* response to the press.
    expect(gapSentence(dates, 'End date must be on or after the start date.')).toBeNull();
  });

  it('says the gap when the screen is showing a different note', () => {
    expect(gapSentence(dates, "We couldn't find that place, but the plan will still work.")).toBe(
      'End date must be on or after the start date.',
    );
  });

  it('says the gap when the screen is showing nothing', () => {
    expect(gapSentence(planGap({ ...complete, budget: 0 }), undefined)).toBe(
      'Add a budget. The plan stays inside it.',
    );
  });

  it('says nothing when there is no gap', () => {
    expect(gapSentence(null, undefined)).toBeNull();
  });
});
