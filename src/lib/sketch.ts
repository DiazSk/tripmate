import { parseJsonResponse } from "./claude";
import { formatAnchors, formatWeather } from "./itineraryPrompt";
import type { Anchor } from "./types";
import type { DayWeather } from "./weather";

/**
 * The ~20s sketch: a theme and an area per day, and which of the traveler's places go where.
 *
 * Not a throwaway preview — it is handed to the generate prompt as the shape to keep, so what the
 * traveler sees at second twenty is what they get at minute six. A sketch the plan contradicted
 * would cost the trust this exists to build.
 */

export interface SketchDay {
  date: string;
  theme: string;
  area: string;
  anchors: string[];
}

export function buildSketchPrompt(p: {
  destination: string;
  dates: string[];
  anchors: Anchor[];
  priorities: string[];
  weather: DayWeather[];
}): string {
  return `Sketch a ${p.dates.length}-day trip to ${p.destination} — only the shape, not the stops.
Days: ${p.dates.join(", ")}
${p.priorities.length ? `What matters to them: ${p.priorities.join(", ")}\n` : ""}${p.weather.length ? `Weather:\n${formatWeather(p.weather)}\n` : ""}${formatAnchors(p.anchors)}
For each day give: a "theme" of 2-5 evocative words (e.g. "Old Tokyo, slowly"), the one "area" the day centres on, and the traveler's places ("anchors", exact names from the list) that belong on that day. Group places that are near each other; put outdoor places on the better-weather days.

Respond with ONLY valid JSON, no code fences:
{"days":[{"date":"YYYY-MM-DD","theme":"2-5 words","area":"neighbourhood or town","anchors":["exact name"]}]}`;
}

export function parseSketch(raw: string, dates: string[]): SketchDay[] | null {
  let parsed: { days?: unknown };
  try {
    parsed = parseJsonResponse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed?.days)) return null;
  const byDate = new Map<string, SketchDay>();
  for (const d of parsed.days as Record<string, unknown>[]) {
    if (typeof d?.date !== "string" || typeof d.theme !== "string" || !d.theme.trim()) continue;
    byDate.set(d.date, {
      date: d.date,
      theme: d.theme.trim(),
      area: typeof d.area === "string" ? d.area.trim() : "",
      anchors: Array.isArray(d.anchors) ? d.anchors.filter((a): a is string => typeof a === "string") : [],
    });
  }
  const days = dates.flatMap((date) => byDate.get(date) ?? []);
  return days.length > 0 ? days : null;
}

export function formatSketchForGenerate(days: SketchDay[] | null): string {
  if (!days?.length) return "";
  const lines = days.map(
    (d) => `- ${d.date}: "${d.theme}" — ${d.area}${d.anchors.length ? ` — ${d.anchors.join(", ")}` : ""}`
  );
  return `\nThe traveler has already seen this sketch of the days. Keep this shape — each day's theme (copy it into that day's "theme" field), area and places — unless it conflicts with opening hours, weather or the rules above:\n${lines.join("\n")}\n`;
}
