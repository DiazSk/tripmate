import { authGap, crossFieldProblem, planGap } from './formGap';

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
      reason: 'Add a budget — the plan stays inside it.',
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
      reason: "Trips over 30 days aren't supported — please choose a shorter date range.",
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
    expect(authGap('traveller@example.com', 'eight-or-more')).toBeNull();
  });

  it('asks for the email first', () => {
    expect(authGap('  ', 'short')).toEqual({ field: 'email', reason: 'Add your email address.' });
  });

  it('asks for a longer password', () => {
    expect(authGap('traveller@example.com', 'short')).toEqual({
      field: 'password',
      reason: 'Passwords are at least 8 characters.',
    });
  });

  it('accepts a password of exactly eight characters', () => {
    expect(authGap('traveller@example.com', '12345678')).toBeNull();
  });
});

describe('crossFieldProblem', () => {
  it('says nothing while either date is unset, so a half-filled form is not scolded', () => {
    expect(crossFieldProblem('', '2026-11-06')).toBeUndefined();
  });
});
