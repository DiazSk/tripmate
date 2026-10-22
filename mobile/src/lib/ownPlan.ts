import type { Anchor, ImportedPlan } from '@/api/types';

/**
 * The confirm screen of bring-your-own-itinerary, as logic it can be tested without. There is no
 * renderer in this repo's mobile tests — see `authGate.ts` — so what the screen decides lives here.
 */

/**
 * The start date to prefill: the plan's own first date when every day has one, otherwise empty.
 * Always editable — a friend's plan or a reel carries their dates, and picking a different start
 * moves every day (the server shifts trusted dates; see `datesFor`).
 */
export function suggestedStart(plan: ImportedPlan): string {
  return plan.days.length > 0 && plan.days.every((d) => d.date) ? (plan.days[0].date as string) : '';
}

/**
 * Every stop forgets where it was found. The read geocoded near its own guess at the destination;
 * once the traveller corrects "Where", those pins may be on the wrong continent, and the build only
 * looks up stops that have no coordinates.
 */
export function forgetPlaces(plan: ImportedPlan): ImportedPlan {
  return {
    ...plan,
    days: plan.days.map((day) => ({
      ...day,
      stops: day.stops.map((stop) => ({
        name: stop.name,
        ...(stop.time ? { time: stop.time } : {}),
        ...(stop.note ? { note: stop.note } : {}),
      })),
    })),
  };
}

/** What the screen still needs before building, in the order it appears on screen. */
export function ownPlanGap(plan: ImportedPlan, destination: string, startDate: string): string | null {
  if (!destination.trim()) return 'Add where this trip is.';
  if (!startDate) return 'Pick the day your trip starts.';
  if (plan.days.some((d) => d.stops.some((s) => !s.name.trim()))) return 'Every stop needs a name.';
  return null;
}

/** A renamed stop forgets where it was found, so the build looks the new name up instead of pinning it to the old place. */
export function renameStop(plan: ImportedPlan, dayIndex: number, stopIndex: number, name: string): ImportedPlan {
  return {
    ...plan,
    days: plan.days.map((day, d) =>
      d !== dayIndex
        ? day
        : {
            ...day,
            stops: day.stops.map((stop, s) =>
              s !== stopIndex
                ? stop
                : { name, ...(stop.time ? { time: stop.time } : {}), ...(stop.note ? { note: stop.note } : {}) },
            ),
          },
    ),
  };
}

/** A list of places, not a plan: what the wizard gets instead. */
export function looseAnchors(plan: ImportedPlan): Anchor[] {
  return plan.loose.map((name) => ({ name, lat: null, lng: null, priority: 'want', source: 'import' }));
}

export const isFound = (stop: { lat?: number; lng?: number }) =>
  typeof stop.lat === 'number' && typeof stop.lng === 'number';

/** Lowercase, accents off, punctuation to spaces: "Jerónimos, Monastery!" and "jeronimos monastery" are one. */
export const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Which line of the pasted text each stop was read from, or null when it cannot be said.
 *
 * **Worked out here, because the read does not report it.** `/api/import-plan` returns stops, not
 * where in the input it found them, so the screen matches each name back to the text: the line that
 * contains it whole, else the line sharing the most of its words, at least two of them (one, for a
 * one-word name). Both searches look forward from the last match first, since a plan is read in
 * order and day 2's lunch should not land on day 1's lunch line.
 *
 * A stop read from a screenshot is in no line of the text and gets null, which the screen shows as
 * no tag at all rather than a guess. Worked out once, at read time, so a renamed stop keeps
 * pointing at the line it came from.
 */
export function sourceLines(text: string, plan: ImportedPlan): (number | null)[][] {
  const lines = text.split('\n').map(fold);
  let cursor = 0;
  const find = (name: string): number | null => {
    const want = fold(name);
    if (!want) return null;
    const order = [...lines.keys()].slice(cursor).concat([...lines.keys()].slice(0, cursor));
    const whole = order.find((i) => lines[i].includes(want));
    if (whole !== undefined) return whole;
    const words = want.split(' ').filter((w) => w.length >= 3);
    const needed = words.length === 1 ? 1 : 2;
    // The best line ahead of the last match, and only if there is none, the best line behind it.
    const bestIn = (range: number[]) => {
      let best: number | null = null;
      let bestHits = 0;
      for (const i of range) {
        const have = new Set(lines[i].split(' '));
        const hits = words.filter((w) => have.has(w)).length;
        if (hits >= needed && hits > bestHits) {
          best = i;
          bestHits = hits;
        }
      }
      return best;
    };
    const keys = [...lines.keys()];
    return bestIn(keys.slice(cursor)) ?? bestIn(keys.slice(0, cursor));
  };
  return plan.days.map((day) =>
    day.stops.map((stop) => {
      const line = find(stop.name);
      if (line !== null) cursor = line;
      return line;
    }),
  );
}

/**
 * "Thu 22 Oct" for a day: its own date when the plan stated one, else counted on from the start
 * date chosen on screen, which is what the build will give it. Empty when neither is known.
 */
export function dayDate(day: { date?: string }, index: number, startDate: string): string {
  const iso = day.date ?? (startDate ? new Date(Date.parse(`${startDate}T00:00:00Z`) + index * 86_400_000).toISOString().slice(0, 10) : '');
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const month = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${weekday} ${d.getUTCDate()} ${month}`;
}
