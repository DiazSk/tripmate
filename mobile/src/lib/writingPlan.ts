import type { SketchEvent, Stop, StreamedStop } from '@/api/types';
import { STAGE_SECONDS, STEP_GROUPS, stepGroupState, type StageProgress, type StepState } from '@shared/generationStages';
import type { RawFetch } from '@shared/types';

/**
 * The pure half of the plan-writing screen (`components/writing-the-plan.tsx`), the phone's
 * "Live map, writing the plan · C Monument": the days as the stream has drawn them, the line under
 * the instruments, the four step ticks, the forecast and the monument's size. Mirrors what
 * `src/components/polar/WritingThePlan.tsx` derives on the web, so the two say the same things.
 */

export type PlanDay = { theme: string | null; date: string; stops: Stop[] };
/** `day-coords` frames: corrected positions by day, keyed by the stop's trimmed name. */
export type DayCoords = Record<number, Record<string, { lat: number; lon: number }>>;

/**
 * The days as they stand: the sketch's themes, the streamed stops in order, and Overpass's
 * correction laid over each stop whose day has one. The model writes coordinates from memory and
 * has been measured 11km out, so a corrected stop moves to where it really is.
 *
 * At least `tripDays` long, so a chip stands for every day before the sketch lands.
 */
export function assembleDays(sketch: SketchEvent['days'], stops: StreamedStop[], coords: DayCoords, tripDays: number): PlanDay[] {
  const count = Math.max(tripDays, sketch.length, ...stops.map((s) => s.dayIndex + 1), 1);
  const days: PlanDay[] = Array.from({ length: count }, (_, i) => ({ theme: sketch[i]?.theme || null, date: sketch[i]?.date ?? '', stops: [] }));
  for (const s of [...stops].sort((a, b) => a.dayIndex - b.dayIndex || a.stopIndex - b.stopIndex)) {
    const fixed = coords[s.dayIndex]?.[s.stop.name.trim()];
    days[s.dayIndex].stops.push(fixed ? { ...s.stop, lat: fixed.lat, lng: fixed.lon } : s.stop);
    if (!days[s.dayIndex].date) days[s.dayIndex].date = s.date;
  }
  return days;
}

/** The last stop written, and its day: the one the camera frames and the arrival card names. */
export function latestStop(days: PlanDay[]): { dayIndex: number; stop: Stop; first: boolean } | null {
  for (let i = days.length - 1; i >= 0; i--) {
    const stops = days[i].stops;
    if (stops.length) return { dayIndex: i, stop: stops[stops.length - 1], first: stops.length === 1 };
  }
  return null;
}

/** The line under the instruments: where the stream is, in words. */
export function nowLine(days: PlanDay[], activeLabel: string | null): string {
  const latest = latestStop(days);
  if (latest) {
    const theme = days[latest.dayIndex].theme;
    return `Day ${latest.dayIndex + 1} of ${days.length}${theme ? ` · ${theme}` : ''}`;
  }
  if (days.some((d) => d.theme)) return 'The days are sketched';
  return activeLabel ?? 'Starting';
}

/**
 * Each step group's share of the bar, filled: done and failed are whole, waiting is empty, and the
 * running group fills by how far the whole-run fraction `progress` (`generationProgress`) has come
 * through its own weight. Weighted by `STAGE_SECONDS`, the bar's own weights, so the ticks and the
 * bar the web draws agree about how far along a run is.
 */
export function groupFills(stages: readonly StageProgress[], progress: number): { state: StepState; fill: number }[] {
  const weight = (g: (typeof STEP_GROUPS)[number]) =>
    g.stages.reduce((sum, id) => sum + (stages.find((s) => s.stage === id)?.status === 'skipped' ? 0 : STAGE_SECONDS[id]), 0);
  const total = STEP_GROUPS.reduce((sum, g) => sum + weight(g), 0) || 1;
  let start = 0;
  return STEP_GROUPS.map((g) => {
    const share = weight(g) / total;
    const state = stepGroupState(g, stages);
    const fill = state === 'done' || state === 'failed' ? 1 : state === 'waiting' || share === 0 ? 0 : Math.min(1, Math.max(0, (progress - start) / share));
    start += share;
    return { state, fill };
  });
}

/** "Tue 3"; calendar dates parse as UTC midnight and are read back in UTC, or they slip a day. */
function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })} ${d.getUTCDate()}`;
}

/** The first three days' range, "Tue 3 14 to 19º", against the trip's own calendar. */
export function forecastLine(raw: RawFetch | null): string | null {
  if (!raw?.weather.available || !raw.weather.days.length) return null;
  const calendar = raw.dateContext.days;
  const line = raw.weather.days
    .slice(0, 3)
    .map((d, i) => `${dayLabel(calendar[i]?.date ?? d.date)} ${Math.round(d.tempMinC)} to ${Math.round(d.tempMaxC)}º`)
    .join(' · ');
  return raw.weather.historical ? `${line} · same dates last year` : line;
}

function dms(v: number, pos: string, neg: string) {
  const a = Math.abs(v);
  const d = Math.floor(a);
  const m = Math.floor((a - d) * 60);
  const s = Math.round(((a - d) * 60 - m) * 60);
  return `${d}º ${String(m).padStart(2, '0')}’ ${String(s).padStart(2, '0')}” ${v >= 0 ? pos : neg}`;
}
export function coordLine(lat: number, lon: number): string {
  return `[ ${dms(lat, 'N', 'S')}, ${dms(lon, 'E', 'W')} ]`;
}

/** "14:00" → "2:00 PM"; anything else (a model's "Late morning") is shown as written. */
export function time12(t: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return t;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * The monument's point size: the word across the measure, capped by the screen's height. Oswald's
 * capitals run about 0.476em each (measured on the canvas, same font files), so `2.1` letters per
 * em fills the width; a short word stops at four letters' worth rather than towering.
 */
export function monumentSize(word: string, width: number, height: number, pad: number): number {
  return Math.min(height * 0.17, ((width - pad * 2) * 2.1) / Math.max(word.length, 4));
}
