import {
  budgetSegments,
  daySpend,
  daySpendByCategory,
  anyActualSpend,
  spendOf,
  surenessFields,
  surenessOf,
  surenessSplit,
  SURENESS_LABEL,
  tripSpend,
  type BudgetSegment,
  type DaySpend,
  type Sureness,
} from '@shared/itinerary';
import { formatMoney } from '@shared/format';
import { budgetEach } from '@shared/userAnswers';

import type { DayPlan, StopCategory } from '@/api/types';

/**
 * What a plan costs — every figure on a mobile screen, from one place.
 *
 * **The arithmetic is imported, not rewritten.** `src/lib/itinerary.ts`'s money section exists
 * because three independent summations of the same plan once disagreed on screen: two ignored
 * `actualCost`, so entering a real spend moved the overspend banner and not the budget bar. Its
 * docblock is worth reading before adding anything here.
 *
 * This app had quietly become the fourth. `dayTotal()` in `day-page.tsx` summed `stop.cost` and
 * `lodging.cost` and never looked at `actualCost` — which nothing noticed while the day's total
 * was the only money on screen, and which a budget bar beside it would have made visible
 * immediately.
 *
 * **Why this file exists at all**, given it mostly re-exports: it is the single place the
 * `@shared/*` alias is named. Components import from here, so the web/mobile boundary is one
 * file rather than a dozen import lines, and a future divergence in the two type trees has one
 * place to be absorbed.
 *
 * **No cast — and getting to none meant fixing a type rather than papering over it.** `Stop` and
 * `Lodging` match field for field across the two trees, but `DayPlan` did not: `DayWeather`'s five
 * nullable fields were declared optional here and required-and-nullable on the server, so a day
 * from this app could not be handed to any function below — over fields not one of them reads. The
 * repair went into `api/types.ts`, which was simply wrong about the wire; see the note there. A
 * cast would have had to be repeated per function and would have kept asserting the wrong shape.
 *
 * `Itinerary` is still not assignable (`tier` is required there, optional here). Nothing below
 * takes one, so it has not mattered yet — it is the first thing to check if something here does.
 */

export {
  anyActualSpend,
  budgetEach,
  budgetSegments,
  daySpend,
  daySpendByCategory,
  spendOf,
  surenessFields,
  surenessOf,
  surenessSplit,
  SURENESS_LABEL,
  tripSpend,
  formatMoney,
};
export type { BudgetSegment, DaySpend, Sureness };


/** One category's slice of a day. `fraction` draws the band, `percent` is what gets printed. */
export type SpendShare = {
  key: StopCategory | 'stay';
  label: string;
  amount: number;
  /** 0–1, the true proportion. Widths only — never rounded for display. */
  fraction: number;
  /** A whole number. Across a day's shares these sum to exactly 100 — see below. */
  percent: number;
};

/** The five buckets, in the order they are laid out before sorting by amount. */
const LABELS: { key: SpendShare['key']; label: string }[] = [
  { key: 'food', label: 'Food' },
  { key: 'entry', label: 'Entry' },
  { key: 'transit', label: 'Transit' },
  { key: 'other', label: 'Other' },
  { key: 'stay', label: 'Stay' },
];

/**
 * Where a day's money went, largest first.
 *
 * Zero-amount categories are dropped rather than returned at zero: a day with no transit has
 * nothing to say about transit, and a 0% row is a line of furniture. A day costing nothing at
 * all returns `[]`, which the breakdown renders as nothing rather than as five zeroes.
 *
 * **Percentages are apportioned by largest remainder, and that is the whole subtlety.** Rounding
 * each share on its own puts 33.3/33.3/33.3 on screen as three 33s that sum to 99 — a total that
 * is visibly not a total, in a surface whose entire argument is that the figures agree. Largest
 * remainder floors every share, then hands the leftover points out to whoever was closest to
 * rounding up, so the column sums to exactly 100 by construction. The same rule the Swift app
 * uses (`Spend.shares`).
 */
export function spendShares(day: DayPlan): SpendShare[] {
  return sharesOf(daySpendByCategory(day));
}

/** The whole trip's money by category, apportioned the same way as one day's. */
export function tripShares(days: DayPlan[]): SpendShare[] {
  const sums: DaySpend = { food: 0, entry: 0, transit: 0, other: 0, stay: 0, total: 0 };
  for (const day of days) {
    const spend = daySpendByCategory(day);
    for (const key of Object.keys(sums) as (keyof DaySpend)[]) sums[key] += spend[key];
  }
  return sharesOf(sums);
}

function sharesOf(spend: DaySpend): SpendShare[] {
  const present = LABELS.map(({ key, label }) => ({ key, label, amount: spend[key] })).filter(
    (entry) => entry.amount > 0
  );
  if (present.length === 0) return [];

  const total = present.reduce((sum, entry) => sum + entry.amount, 0);
  // Guarded, though `present` being non-empty means every amount is above zero and so is their
  // sum. A division that cannot happen is still a division somebody reads.
  if (!(total > 0)) return [];

  // Descending by amount. A stable sort keeps the declaration order above for ties, so two equal
  // categories always land the same way round rather than by whatever the engine felt like.
  const sorted = [...present].sort((a, b) => b.amount - a.amount);

  const exact = sorted.map((entry) => (entry.amount / total) * 100);
  const floors = exact.map(Math.floor);
  let leftover = 100 - floors.reduce((sum, n) => sum + n, 0);
  // Indices ordered by who lost the most to flooring. `leftover` is at most the number of
  // categories, so this hands out every point and never runs off the end.
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - floors[index] }))
    .sort((a, b) => b.remainder - a.remainder);
  const percents = [...floors];
  for (const { index } of byRemainder) {
    if (leftover <= 0) break;
    percents[index] += 1;
    leftover -= 1;
  }

  return sorted.map((entry, index) => ({
    ...entry,
    fraction: entry.amount / total,
    percent: percents[index],
  }));
}
