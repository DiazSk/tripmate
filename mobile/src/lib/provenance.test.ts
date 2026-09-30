import type { Stop } from '@/api/types';
import { evidenceTags } from './provenance';

const stop = (over: Partial<Stop> = {}): Stop =>
  ({ name: 'Kiyomizu-dera', time: '9:00 AM', cost: 0, ...over }) as Stop;

/**
 * **These three assertions are the whole point of the file.**
 *
 * `evidenceTags` reads `stopEvidence()`'s output by its `label` strings, which live in root
 * (`src/lib/evidence.ts`) and are not exported as constants. A rename there would make every tag
 * on the day page vanish with no type error and no failing render — the exact class of silent
 * defect this codebase keeps catching by eye. These fail instead.
 */
describe('evidenceTags', () => {
  it('separates the planner’s prose from a listing’s own', () => {
    expect(evidenceTags(stop({ note: 'Busy at sunset' })).detail).toBe("the planner's");
    expect(evidenceTags(stop({ note: 'Open until 18:00', located: 'search' })).detail).toBe(
      'from a listing',
    );
  });

  it('separates a figure the traveller entered from the estimate it replaced', () => {
    expect(evidenceTags(stop({ cost: 15 })).cost).toBe("the planner's");
    expect(evidenceTags(stop({ cost: 15, actualCost: 18 })).cost).toBe('you entered');
    expect(evidenceTags(stop()).cost).toBeUndefined();
  });
});
