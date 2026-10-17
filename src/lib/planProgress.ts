/** One way to say how long a trip is, and how far a plan being written has got. The writing screen
 * and the capsule both read the trip's length from its dates; counting the days streamed so far
 * made one say "7 days" and the other "6" while day 7 was still on its way. */
type DraftDays = readonly { stops: readonly unknown[] }[] | null | undefined;

export const daysLabel = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/** "Day 6 of 7", never "Day 8 of 7". */
export const dayOfLabel = (written: number, total: number) => `Day ${written} of ${Math.max(total, written)}`;

/** The 1-based last day that has a stop; 0 for none. A `sketch` frame fills the draft with every day
 * and no stops, so the draft's length is not how far the writing has got. */
export const writtenDays = (days: DraftDays) => (days?.findLastIndex((d) => d.stops.length > 0) ?? -1) + 1;

/** The trip's length: its dates', unless the stream has already gone past them (or there are none). */
export const tripLength = (fromDates: number | null | undefined, streamed: number) => Math.max(fromDates ?? 0, streamed, 1);

/** What the capsule carries: while the plan streams, its length from the dates and how far the
 * writing has got (no step until a stop exists); once it is whole, its days and the day in focus. */
export function capsuleDays({
  days,
  streaming,
  tripDays,
  activeDayIndex,
}: {
  days: DraftDays;
  streaming: boolean;
  tripDays: number | null;
  activeDayIndex: number;
}): { subtitle: string | undefined; step: string | undefined } {
  const n = days?.length ?? 0;
  if (!n) return { subtitle: undefined, step: undefined };
  if (!streaming) return { subtitle: daysLabel(n), step: `Day ${activeDayIndex + 1}` };
  const total = tripLength(tripDays, n);
  const written = writtenDays(days);
  return { subtitle: daysLabel(total), step: written ? dayOfLabel(written, total) : undefined };
}
