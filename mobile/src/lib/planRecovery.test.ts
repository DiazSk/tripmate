import { RECOVERY_GIVE_UP_MS, recoveryStep } from './planRecovery';

const START = 1_000_000;

describe('recoveryStep', () => {
  it('opens the trip the server saved while the phone was away', () => {
    expect(recoveryStep({ status: 'ready', tripId: 't-1' }, START, START + 90_000)).toEqual({ action: 'open', tripId: 't-1' });
  });
  it('keeps waiting while the plan is still being written, or while the check itself failed', () => {
    expect(recoveryStep({ status: 'writing' }, START, START + 60_000)).toEqual({ action: 'wait' });
    expect(recoveryStep(null, START, START + 60_000)).toEqual({ action: 'wait' });
  });
  it('fails a run the server says failed, or does not know', () => {
    expect(recoveryStep({ status: 'failed' }, START, START + 60_000).action).toBe('fail');
    expect(recoveryStep({ status: 'unknown' }, START, START + 60_000).action).toBe('fail');
  });
  it('stops waiting once a plan has taken far longer than any plan takes', () => {
    expect(recoveryStep({ status: 'writing' }, START, START + RECOVERY_GIVE_UP_MS - 1)).toEqual({ action: 'wait' });
    expect(recoveryStep({ status: 'writing' }, START, START + RECOVERY_GIVE_UP_MS + 1).action).toBe('fail');
    expect(recoveryStep(null, START, START + RECOVERY_GIVE_UP_MS + 1).action).toBe('fail');
  });
  it('says the failure in the planner’s own words, never a code', () => {
    const step = recoveryStep({ status: 'failed' }, START, START + 1);
    expect(step.action === 'fail' && step.message).toMatch(/Try generating again/);
  });
});
