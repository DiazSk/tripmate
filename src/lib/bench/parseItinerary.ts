/**
 * Parses the markdown the itinerary-planner skill specifies (§6 Output Format) into a structure
 * the scorers can measure. Deterministic and offline — no LLM anywhere in this file.
 *
 * The parser is deliberately lenient about surface variation (en/em dashes, 12h vs 24h clocks,
 * `->` for `→`) and strict about structure (day headings, the three slot blocks, `Stay near:`).
 * That split is the point: `format_adherence` should fail a model that skipped the Evening block,
 * not one that wrote "9:00 AM" instead of "09:00". Anything it genuinely can't read comes back as
 * `null`, and every scorer reports how much it could actually measure alongside its score.
 */

export type Slot = "Morning" | "Afternoon" | "Evening";

export const SLOTS: Slot[] = ["Morning", "Afternoon", "Evening"];

export interface TimeWindow {
  /** Minutes from local midnight. */
  startMin: number;
  endMin: number;
}

export interface ParsedTransport {
  /** Normalized to the app's TransportMode vocabulary where possible, else the raw word. */
  mode: string;
  minutes: number | null;
  raw: string;
}

export interface ParsedEntry {
  raw: string;
  /** Text before the first dash separator — a POI name, or an area for area-level entries. */
  name: string;
  window: TimeWindow | null;
  durationMin: number | null;
  /** The `→ ...` line following this entry, if any. */
  transport: ParsedTransport | null;
  /** §3b area-level entry (a meal/coffee/stroll given as a district rather than a venue). */
  areaLevel: boolean;
  slot: Slot;
}

export interface ParsedDay {
  headingRaw: string;
  /** ISO `YYYY-MM-DD` when the heading carried one, else null. */
  date: string | null;
  dayOfWeek: string | null;
  theme: string | null;
  entriesBySlot: Record<Slot, ParsedEntry[]>;
  stayNear: string | null;
  note: string | null;
}

export interface ParsedItinerary {
  days: ParsedDay[];
  /** Text before the first day heading — the skill allows a short assumptions preamble. */
  preamble: string;
  /** Model wrapped its output in a code fence, which §6 forbids. */
  hadCodeFence: boolean;
}

const DASH = /\s+[—–-]\s+/;

const MEAL_WORDS =
  /\b(breakfast|brunch|lunch|dinner|supper|coffee|drinks|snack|meal|market|stroll|browse|shopping|rest|break)\b/i;

/** Word for a transport mode → the app's own TransportMode vocabulary. */
const MODE_WORDS: Record<string, string> = {
  walk: "walk",
  walking: "walk",
  foot: "walk",
  stroll: "walk",
  transit: "transit",
  metro: "transit",
  subway: "transit",
  underground: "transit",
  tube: "transit",
  train: "transit",
  bus: "transit",
  tram: "transit",
  streetcar: "transit",
  ferry: "transit",
  drive: "drive",
  driving: "drive",
  car: "drive",
  taxi: "drive",
  cab: "drive",
  rideshare: "drive",
};

/** "9:30", "09:30", "9:30 AM", "9 PM" → minutes from midnight. Null when unreadable. */
export function parseClock(raw: string): number | null {
  const m = raw.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i);
  if (!m) return null;
  let hour = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const suffix = m[3]?.toLowerCase().replace(/\./g, "");
  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  if (hour > 23 || min > 59) return null;
  return hour * 60 + min;
}

export function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** First "HH:MM–HH:MM"-shaped span in the line. */
export function parseTimeWindow(line: string): TimeWindow | null {
  const m = line.match(
    /(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)\s*(?:[–—-]|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)/i
  );
  if (!m) return null;
  const startMin = parseClock(m[1]);
  let endMin = parseClock(m[2]);
  if (startMin === null || endMin === null) return null;
  // "21:00–00:30" crosses midnight; keep the span positive so duration math stays sane.
  if (endMin < startMin) endMin += 24 * 60;
  return { startMin, endMin };
}

/** "(~2h)", "(90 min)", "(1.5 hrs)" → minutes. */
export function parseDuration(line: string): number | null {
  const m = line.match(
    /\(\s*(?:~|approx\.?\s*|about\s*)?(\d+(?:\.\d+)?)\s*(min|mins|minutes|h|hr|hrs|hour|hours)\b[^)]*\)/i
  );
  if (!m) return null;
  const value = Number(m[1]);
  return /^h/i.test(m[2]) ? Math.round(value * 60) : Math.round(value);
}

/** The `→ 15 min metro to the next stop` line. */
export function parseTransport(line: string): ParsedTransport | null {
  const body = line.replace(/^\s*(?:→|->|➔)\s*/, "");
  if (body === line.trim()) return null;

  const minutesMatch = body.match(/(\d+)(?:\s*[–—-]\s*\d+)?\s*(?:min|mins|minutes)\b/i);
  const hourMatch = body.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/i);
  const minutes = minutesMatch
    ? Number(minutesMatch[1])
    : hourMatch
      ? Math.round(Number(hourMatch[1]) * 60)
      : null;

  const lower = body.toLowerCase();
  const word = Object.keys(MODE_WORDS).find((w) => new RegExp(`\\b${w}\\b`).test(lower));
  return { mode: word ? MODE_WORDS[word] : "unknown", minutes, raw: body.trim() };
}

/** Written or ISO date in a day heading → ISO. Parsed as UTC (see the calendar-date gotcha). */
const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

export function parseHeadingDate(heading: string): string | null {
  const iso = heading.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];

  const written = heading.match(
    /\b([A-Z][a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/
  );
  if (written) {
    const monthIndex = MONTHS.indexOf(written[1].toLowerCase());
    if (monthIndex >= 0) {
      const year = written[3] ?? String(new Date().getUTCFullYear());
      return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${written[2].padStart(2, "0")}`;
    }
  }
  return null;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function parseHeadingWeekday(heading: string): string | null {
  const lower = heading.toLowerCase();
  const full = WEEKDAYS.find((d) => lower.includes(d));
  if (full) return full[0].toUpperCase() + full.slice(1, 3);
  const short = lower.match(/\b(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/);
  if (short) {
    const stem = short[1].slice(0, 3);
    return stem[0].toUpperCase() + stem.slice(1);
  }
  return null;
}

function emptySlots(): Record<Slot, ParsedEntry[]> {
  return { Morning: [], Afternoon: [], Evening: [] };
}

function parseEntry(line: string, slot: Slot): ParsedEntry {
  const body = line.replace(/^\s*[-*]\s+/, "").trim();
  const name = body.split(DASH)[0].replace(/\*\*/g, "").trim();
  return {
    raw: body,
    name,
    window: parseTimeWindow(body),
    durationMin: parseDuration(body),
    transport: null,
    // §3b: an entry is area-level when it names a district plus an activity kind rather than a
    // specific venue. "around <area>" is the shape the skill asks for; the meal/activity words and
    // "e.g." examples catch the variants models actually write.
    areaLevel: /\baround\b/i.test(body) || (MEAL_WORDS.test(name) && !/\bat\b/i.test(name)),
    slot,
  };
}

export function parseItinerary(markdown: string): ParsedItinerary {
  const hadCodeFence = /^\s*```/.test(markdown);
  const text = markdown.replace(/^\s*```(?:markdown)?\s*\n/, "").replace(/\n\s*```\s*$/, "");

  const days: ParsedDay[] = [];
  const preambleLines: string[] = [];
  let day: ParsedDay | null = null;
  let slot: Slot | null = null;
  let lastEntry: ParsedEntry | null = null;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();

    const heading = trimmed.match(/^#{2,4}\s+(.*)$/);
    if (heading) {
      const headingText = heading[1].trim();
      day = {
        headingRaw: headingText,
        date: parseHeadingDate(headingText),
        dayOfWeek: parseHeadingWeekday(headingText),
        theme: headingText.split(DASH).slice(1).join(" — ").trim() || null,
        entriesBySlot: emptySlots(),
        stayNear: null,
        note: null,
      };
      days.push(day);
      slot = null;
      lastEntry = null;
      continue;
    }

    if (!day) {
      if (trimmed) preambleLines.push(trimmed);
      continue;
    }

    const slotMatch = trimmed.match(/^\*\*(Morning|Afternoon|Evening)\*\*:?\s*$/i);
    if (slotMatch) {
      const name = slotMatch[1];
      slot = ((name[0].toUpperCase() + name.slice(1).toLowerCase()) as Slot);
      lastEntry = null;
      continue;
    }

    const stay = trimmed.match(/^\*\*Stay near:?\*\*:?\s*(.*)$/i);
    if (stay) {
      day.stayNear = stay[1].trim();
      lastEntry = null;
      continue;
    }

    const note = trimmed.match(/^\*\*Note:?\*\*:?\s*(.*)$/i);
    if (note) {
      day.note = note[1].trim();
      lastEntry = null;
      continue;
    }

    if (/^\s*(?:→|->|➔)/.test(line)) {
      if (lastEntry) lastEntry.transport = parseTransport(line);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line) && slot) {
      const entry = parseEntry(line, slot);
      day.entriesBySlot[slot].push(entry);
      lastEntry = entry;
    }
  }

  return { days, preamble: preambleLines.join("\n"), hadCodeFence };
}

/** Every entry in a day, in Morning → Afternoon → Evening order. */
export function dayEntries(day: ParsedDay): ParsedEntry[] {
  return SLOTS.flatMap((s) => day.entriesBySlot[s]);
}

export function allEntries(itinerary: ParsedItinerary): ParsedEntry[] {
  return itinerary.days.flatMap(dayEntries);
}
