import { STAGE_ORDER, type StageProgress, type StageStatus } from '@shared/generationStages';

import { STEP_SECONDS, currentStepIndex, planActivityProps, planActivityStaleAt } from './planActivity';
import { type PlanDay } from './writingPlan';

const START = 1_800_000_000_000;
const at = (statuses: Partial<Record<(typeof STAGE_ORDER)[number], StageStatus>>): StageProgress[] =>
  STAGE_ORDER.map((stage) => ({ stage, status: statuses[stage] ?? 'pending' }));
const base = {
  destination: 'Kyoto, Japan',
  dateRange: 'Nov 14 – 18',
  tripDays: 5,
  tierName: 'Mid-range',
  days: [] as PlanDay[],
  facts: ['The Pink City was painted in 1876.', 'Hawa Mahal has 953 windows.'],
  startedAt: START,
  stepStartedAt: START,
  now: START + 5_000,
  phase: 'writing' as const,
  photo: null,
};

describe('planActivityProps', () => {
  it('names the place and the trip the way the writing screen does', () => {
    const p = planActivityProps({ ...base, stages: at({}) });
    expect(p.eyebrow).toBe('Planning Kyoto');
    expect(p.meta).toBe('Nov 14 – 18 · 5 days · Mid-range');
    expect(planActivityProps({ ...base, tripDays: 1, tierName: null, stages: at({}) }).meta).toBe('Nov 14 – 18 · 1 day');
  });
  it('says which of the four steps is running, counting from one', () => {
    const before = planActivityProps({ ...base, stages: at({}) });
    expect([before.title, before.stepIndex, before.stepCount]).toEqual(['Reading the place', 0, 4]);
    const writing = planActivityProps({ ...base, stages: at({ geocode: 'done', context: 'done', generate: 'start' }) });
    expect([writing.title, writing.stepIndex]).toEqual(['Writing the plan', 1]);
    expect(writing.fact).toBe('Hawa Mahal has 953 windows.');
  });
  it('carries the day being written as the detail line', () => {
    const days: PlanDay[] = [
      { theme: 'Temples of the east', date: '2026-11-14', stops: [{ name: 'Kiyomizu-dera', lat: 34.99, lng: 135.78 } as PlanDay['stops'][number]] },
      { theme: null, date: '2026-11-15', stops: [] },
    ];
    const p = planActivityProps({ ...base, days, stages: at({ geocode: 'done', context: 'done', generate: 'start' }) });
    expect(p.sub).toBe('Day 1 of 2 · Temples of the east');
  });
  it('schedules every step from when the running one began, so the bar moves on through checking and placing', () => {
    const total = STEP_SECONDS.reduce((a, b) => a + b, 0) * 1000;
    const first = planActivityProps({ ...base, now: START, stages: at({}) });
    expect(first.segments.map((g) => g.to - g.from)).toEqual(STEP_SECONDS.map((t) => t * 1000));
    expect(first.segments[1].from).toBe(first.segments[0].to);
    expect(first.etaAt).toBe(START + total);
    // Writing began 20s in: the steps before it are done, its slot and the rest follow from there.
    const writing = planActivityProps({ ...base, stepStartedAt: START + 20_000, now: START + 30_000, stages: at({ geocode: 'done', context: 'done', generate: 'start' }) });
    expect(writing.segments[1]).toEqual({ from: START + 20_000, to: START + 20_000 + STEP_SECONDS[1] * 1000 });
    expect(writing.segments[3].to).toBe(writing.etaAt);
  });
  it('never ends the running step in the past, however late it runs', () => {
    const late = START + 600_000;
    const p = planActivityProps({ ...base, stepStartedAt: START + 20_000, now: late, stages: at({ geocode: 'done', context: 'done', generate: 'start' }) });
    expect(p.segments[1].to).toBeGreaterThan(late);
    expect(p.etaAt).toBeGreaterThan(late + (STEP_SECONDS[2] + STEP_SECONDS[3]) * 1000 - 1);
  });
  it("puts the Lock Screen's ring where the estimate was at the last update", () => {
    const total = STEP_SECONDS.reduce((a, b) => a + b, 0) * 1000;
    const p = planActivityProps({ ...base, stepStartedAt: START + 15_000, now: START + 60_000, stages: at({ geocode: 'done', context: 'done', generate: 'start' }) });
    expect(p.etaAt).toBe(START + total);
    expect(p.progress).toBeCloseTo(60_000 / total);
    expect(planActivityProps({ ...base, phase: 'ready', stages: at({}) }).progress).toBe(1);
  });
  it('names the step running, or the next one between steps', () => {
    expect(currentStepIndex(at({}))).toBe(0);
    expect(currentStepIndex(at({ geocode: 'done', context: 'done' }))).toBe(1);
    expect(currentStepIndex(at({ geocode: 'done', context: 'done', generate: 'done', critique: 'start' }))).toBe(2);
  });
  it('says the plan is ready, or did not finish, in the design\'s words', () => {
    const days: PlanDay[] = [{ theme: null, date: '2026-11-14', stops: [{ name: 'A' }, { name: 'B' }] as PlanDay['stops'] }];
    const ready = planActivityProps({ ...base, days, phase: 'ready', stages: at({ geocode: 'done', context: 'done', generate: 'done', critique: 'done', placing: 'done' }) });
    expect([ready.eyebrow, ready.title, ready.sub, ready.fact]).toEqual(['Kyoto is ready', '5 days, 2 stops', 'A draft until you keep it', 'Kyoto, in five days.']);
    const failed = planActivityProps({ ...base, phase: 'failed', stages: at({ generate: 'failed' }) });
    expect([failed.eyebrow, failed.title]).toEqual(['Not finished', "The plan didn't finish"]);
  });
});

describe('planActivityStaleAt', () => {
  it('goes stale a minute after the estimate, so the island stops promising "about a minute" forever', () => {
    const p = planActivityProps({ ...base, stages: at({}) });
    expect(planActivityStaleAt(p).getTime()).toBe(p.etaAt + 60_000);
  });
});
