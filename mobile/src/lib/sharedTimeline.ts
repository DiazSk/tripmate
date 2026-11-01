import { parseDurationLabel } from '@shared/daySlotting';
import { clockAfter, formatClock, parseClock } from '@shared/itinerary';
import { travelLegBetween } from '@shared/travelTime';

import type { Stop } from '@/api/types';

/** The leg into a stop: how it is travelled, how long that takes, and whether the plan leaves time
 *  for it. `gap` is null when either clock does not parse, and then nothing is claimed about fit. */
export interface TimelineLeg {
  mode: 'walk' | 'bike' | 'transit' | 'drive';
  minutes: number;
  gap: number | null;
  short: boolean;
}

export interface TimelineRow {
  /** The stop's time as the plan wrote it. */
  start: string;
  /** When it ends, in the same clock style as `start`, or null when the time or length is unknown. */
  end: string | null;
  leg: TimelineLeg | null;
}

/**
 * A day read as a timeline: each stop's start and end, and the leg into it.
 *
 * The leg is `travelLegBetween`, the same arithmetic the trip screen's travel segments and the
 * guardrails use, so "only 40 min between" here can never disagree with a conflict drawn on the
 * owner's own screen. It is measured from where the previous stop *ends*, which is the gap a
 * traveller actually has, not from when it starts.
 */
export function timelineRows(stops: Stop[]): TimelineRow[] {
  return stops.map((stop, i) => {
    const from = parseClock(stop.time ?? '');
    const length = parseDurationLabel(stop.durationLabel);
    const endMin = from !== null && length !== null ? from + length : null;
    const prev = stops[i - 1];
    let leg: TimelineLeg | null = null;
    if (prev && located(prev) && located(stop)) {
      const hop = travelLegBetween({ lat: prev.lat, lon: prev.lng }, { lat: stop.lat, lon: stop.lng });
      const prevFrom = parseClock(prev.time ?? '');
      const prevLength = parseDurationLabel(prev.durationLabel);
      // `clockAfter`: a 1 AM transfer after a 6 PM dinner is the next morning, not a leg 17h short.
      const gap =
        from !== null && prevFrom !== null && prevLength !== null
          ? clockAfter(from, prevFrom) - (prevFrom + prevLength)
          : null;
      leg = { mode: hop.mode as TimelineLeg['mode'], minutes: hop.minutes, gap, short: gap !== null && hop.minutes > gap };
    }
    return { start: stop.time, end: endMin === null ? null : clockLike(stop.time, endMin), leg };
  });
}

/** `09:00` stays a 24-hour clock and `9:00 AM` a 12-hour one, so a row never mixes the two. */
function clockLike(sample: string, minutes: number): string {
  if (/am|pm/i.test(sample)) return formatClock(minutes);
  const total = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** An unplaced stop sits at 0,0; a leg measured to it would cross an ocean. */
const located = (stop: Stop) => !(stop.lat === 0 && stop.lng === 0);
