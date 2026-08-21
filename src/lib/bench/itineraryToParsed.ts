import type { DayPlan, Itinerary, Stop } from "../types";
import {
  emptySlots,
  parseClock,
  parseDuration,
  parseTransport,
  slotForStart,
  weekdayFromIso,
} from "./parseItinerary";
import type { ParsedDay, ParsedEntry, ParsedItinerary } from "./parseItinerary";

/**
 * Lets the twelve generation scorers grade a patched itinerary.
 *
 * The scorers were written against `ParsedItinerary`, the output of the §11 *markdown* parser, and
 * the refine path returns a JSON patch instead. Rather than a second scorer family, this maps the
 * app's own `Itinerary` onto the parser's shape — `ParsedEntry` is close to 1:1 with `Stop`.
 *
 * Every derived field goes through the helpers `parseItinerary.ts` already exports, NOT the
 * same-named ones in `src/lib/itinerary.ts`. Two parsers disagreeing about what "1.5 hours" means
 * would make a delta between a markdown-scored plan and a JSON-scored plan meaningless, and the
 * disagreement would be invisible.
 */
function toEntry(stop: Stop): ParsedEntry {
  const startMin = stop.time ? parseClock(stop.time) : null;
  const durationMin = stop.durationLabel ? parseDuration(stop.durationLabel) : null;

  return {
    // Reconstructed rather than captured: `scoreLexical` reads the raw text, so it needs something
    // representative of what the model wrote, and a JSON patch has no source line.
    raw: [stop.time, stop.name, stop.why, stop.note].filter(Boolean).join(" — "),
    name: stop.name,
    window: startMin === null ? null : { startMin, endMin: startMin + (durationMin ?? 0) },
    durationMin,
    category: stop.category ?? null,
    costUsd: stop.cost,
    lat: stop.lat,
    lng: stop.lng,
    why: stop.why ?? null,
    note: stop.note || null,
    transport: parseTransport(stop.note || null),
    // §3b's area-level idea has no representation in `Stop` — the app always stores a named place
    // with coordinates. Claiming otherwise would let `scoreGrounding` excuse stops it should count.
    areaLevel: false,
    slot: slotForStart(startMin),
  };
}

function toDay(day: DayPlan): ParsedDay {
  const entriesBySlot = emptySlots();
  for (const stop of day.stops) {
    const entry = toEntry(stop);
    entriesBySlot[entry.slot].push(entry);
  }

  return {
    headingRaw: `## ${day.date}`,
    date: day.date,
    dayOfWeek: weekdayFromIso(day.date),
    theme: day.summary?.trim() || null,
    weather: day.weather || null,
    lodging: day.lodging
      ? { name: day.lodging.name, costUsd: day.lodging.cost, note: day.lodging.note || null }
      : null,
    entriesBySlot,
    stayNear: day.lodging?.name ?? null,
    note: null,
  };
}

export function itineraryToParsed(itinerary: Itinerary): ParsedItinerary {
  return {
    days: itinerary.days.map(toDay),
    // Structural faults of a *markdown* response. A JSON patch cannot express either, so asserting
    // them clean is honest rather than flattering.
    preamble: "",
    hadCodeFence: false,
  };
}
