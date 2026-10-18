import { parseJsonResponse } from "./claude";
import type { ExtractSource } from "./importExtract";
import {
  MAX_STOPS_PER_DAY,
  realDate,
  type ImportedDay,
  type ImportedPlan,
  type ImportedStop,
} from "./importedPlan";
import { formatClock, parseClock } from "./itinerary";
import { SCOPE_BLOCK, fenceUserText } from "./promptScope";

/**
 * The read: a traveller's own plan, as days of stops, in their order. The model copies; it
 * doesn't plan. Everything it might add — a time, a date, a hotel — the prompt forbids, and
 * `parsePlanRead` keeps only the fields asked for, so an invented one is dropped on the way in.
 */
export function buildPlanReadPrompt(
  sources: ExtractSource[],
  imageIndices: number[],
  destination: string | null
): string {
  const listed = sources.map((s) => `Item ${s.index} (${s.kind}): ${s.text.slice(0, 4000)}`).join("\n");
  const images = imageIndices.length
    ? `The attached images are, in order, items ${imageIndices.join(", ")}. They are usually screenshots of a plan in notes, a message or a social post.\n`
    : "";
  return `${SCOPE_BLOCK}

A traveller already has a plan for a trip${destination ? ` to ${destination}` : ""} and wants to bring it in exactly as it is. Read it into days and stops.

${images}<traveler_text>
${fenceUserText(listed)}
</traveler_text>

Rules:
- Copy only what is there. Never add a stop, a time, a date or a hotel the material doesn't state, and never reorder anything.
- A day is a block the plan treats as one day ("Day 2", "Saturday", a date heading). Keep the days and the stops in the order they appear.
- "time": the stop's time as 24-hour "HH:MM" when the plan gives one, otherwise null.
- "date": "YYYY-MM-DD" only when the plan states the full date, otherwise null.
- "lodging": where they sleep that night, when the plan says, otherwise null.
- "note": the traveller's own words about that stop, copied, otherwise null.
- Use each place's own name as it would appear on a map.
- If the material is a list of places rather than a day-by-day plan, set "isPlan" to false, leave "days" empty and put the place names in "places".
- "destinationGuess": the city or region most of it is in, as "City, Country", or null.

Respond with ONLY valid JSON, no code fences, in exactly this shape:
{"isPlan":true,"destinationGuess":"City, Country","days":[{"date":null,"lodging":null,"stops":[{"name":"place name","time":"14:00","note":null}]}],"places":[]}`;
}

const text = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

/** The app's clock ("2:00 PM"), or undefined for anything `parseClock` can't read. */
function clock(v: unknown): string | undefined {
  const s = text(v);
  const minutes = s ? parseClock(s) : null;
  return minutes === null ? undefined : formatClock(minutes);
}

export function parsePlanRead(raw: string): ImportedPlan | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = parseJsonResponse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (!Array.isArray(parsed.days) && !Array.isArray(parsed.places)) return null;

  const guess = text(parsed.destinationGuess) ?? null;
  const notes: string[] = [];
  const days: ImportedDay[] = [];
  for (const [i, rawDay] of (Array.isArray(parsed.days) ? parsed.days : []).entries()) {
    const d = (rawDay ?? {}) as Record<string, unknown>;
    const stops: ImportedStop[] = [];
    for (const rawStop of Array.isArray(d.stops) ? d.stops : []) {
      const s = (rawStop ?? {}) as Record<string, unknown>;
      const name = text(s.name);
      if (!name) continue;
      const time = clock(s.time);
      const note = text(s.note);
      stops.push({ name, ...(time ? { time } : {}), ...(note ? { note } : {}) });
    }
    if (stops.length > MAX_STOPS_PER_DAY) {
      notes.push(
        `Day ${i + 1} listed ${stops.length} stops; the last ${stops.length - MAX_STOPS_PER_DAY} were left out.`
      );
      stops.length = MAX_STOPS_PER_DAY;
    }
    const date = realDate(d.date);
    const lodging = text(d.lodging);
    days.push({ stops, ...(date ? { date } : {}), ...(lodging ? { lodging } : {}) });
  }

  const places = (Array.isArray(parsed.places) ? parsed.places : [])
    .map(text)
    .filter((p): p is string => Boolean(p));
  const hasStops = days.some((d) => d.stops.length > 0);
  if (parsed.isPlan === false || !hasStops) {
    const loose = [...places, ...days.flatMap((d) => d.stops.map((s) => s.name))];
    return { destinationGuess: guess, isPlan: false, days: [], loose: [...new Set(loose)], notes: [], unread: [] };
  }
  return { destinationGuess: guess, isPlan: true, days, loose: [], notes, unread: [] };
}
