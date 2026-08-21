/**
 * Parses the markdown the itinerary-planner skill specifies (§11 Output Format) into a structure
 * the scorers can measure. Deterministic and offline — no LLM anywhere in this file.
 *
 * Rewritten from the old §6 reader. That version required `**Morning**`/`**Afternoon**`/
 * `**Evening**` blocks and a `**Stay near:**` line, neither of which §11 emits — so it scored
 * `format_adherence` at zero for every run regardless of the model, and it had no way to read a
 * cost, which is why the budget rule went unmeasured for as long as it did.
 *
 * Two decisions carried over from the old parser, because they were right:
 * - **Lenient about surface, strict about structure.** En/em dashes, 12h vs 24h clocks, `$1,200`
 *   vs `$1200` are all absorbed; a missing field is a finding, not something to paper over.
 * - **Anything genuinely unreadable comes back `null`**, and every scorer reports how much it could
 *   actually measure alongside its score.
 *
 * Slots are now *derived from each stop's start time* rather than read from a heading. The scorers
 * (and the radar chart) are built around the three-part day, and deriving it keeps all of that
 * working without asking the model for redundant structure it would drift on.
 */

export type Slot = "Morning" | "Afternoon" | "Evening";

export const SLOTS: Slot[] = ["Morning", "Afternoon", "Evening"];

/** Slot boundaries, in minutes from local midnight. Afternoon starts at noon; evening at 17:00. */
export const SLOT_BOUNDARIES = { afternoonFrom: 12 * 60, eveningFrom: 17 * 60 } as const;

export function slotForStart(startMin: number | null): Slot {
  if (startMin === null) return "Morning";
  const inDay = startMin % (24 * 60);
  if (inDay >= SLOT_BOUNDARIES.eveningFrom) return "Evening";
  if (inDay >= SLOT_BOUNDARIES.afternoonFrom) return "Afternoon";
  return "Morning";
}

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

export interface ParsedLodging {
  name: string;
  /** Null when no `$n` was written — distinct from a stated 0 (an already-booked stay). */
  costUsd: number | null;
  note: string | null;
}

export interface ParsedEntry {
  raw: string;
  /** The stop name, with the leading time and the surrounding bold markers stripped. */
  name: string;
  window: TimeWindow | null;
  durationMin: number | null;
  /** §11's category field, when it's one of the four the skill allows. */
  category: "food" | "entry" | "transit" | "other" | null;
  costUsd: number | null;
  lat: number | null;
  lng: number | null;
  why: string | null;
  note: string | null;
  /** §3c puts the leg from the previous stop in the note, so that's where this is read from —
   *  there is no longer a separate `→` line to parse. */
  transport: ParsedTransport | null;
  /** §3b area-level entry (a meal/coffee/stroll given as a district rather than a venue). */
  areaLevel: boolean;
  slot: Slot;
}

export interface ParsedDay {
  headingRaw: string;
  /** ISO `YYYY-MM-DD` when the heading carried one, else null. */
  date: string | null;
  /** Derived from `date` when the heading has one — §11's heading carries no weekday. */
  dayOfWeek: string | null;
  /** §11's italic one-or-two-sentence narrative line. */
  theme: string | null;
  weather: string | null;
  lodging: ParsedLodging | null;
  entriesBySlot: Record<Slot, ParsedEntry[]>;
  /** The lodging name, kept under the old field name so callers reading a day's base still work. */
  stayNear: string | null;
  note: string | null;
}

export interface ParsedItinerary {
  days: ParsedDay[];
  /** Text before the first day heading — §11 forbids a preamble, so this scores against it. */
  preamble: string;
  /** Model wrapped its output in a code fence, which §11 forbids. */
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

/** First "HH:MM–HH:MM"-shaped span in the line. §11 asks for a single start time, but models still
 *  volunteer ranges, and a stated range beats one derived from a duration label. */
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

/** "2h", "90 min", "1.5 hrs", "45 minutes" → minutes. Parens optional: §11 puts the duration label
 *  inside the field list, where the old format had it in its own bracket. */
export function parseDuration(text: string): number | null {
  const m = text.match(
    /(?:~|approx\.?\s*|about\s*)?(\d+(?:\.\d+)?)\s*(min|mins|minutes|h|hr|hrs|hour|hours)\b/i
  );
  if (!m) return null;
  const value = Number(m[1]);
  return /^h/i.test(m[2]) ? Math.round(value * 60) : Math.round(value);
}

/** "$1,200", "$45", "$0" → number. Null when absent, which is different from a stated 0. */
export function parseCostUsd(text: string): number | null {
  const m = text.match(/\$\s*(\d[\d,]*(?:\.\d+)?)/);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

/** "34.9671/135.7727" or "34.9671, 135.7727". Matched by shape rather than position, since a
 *  comma-separated pair would otherwise split as two of §11's fields. */
export function parseLatLng(text: string): { lat: number; lng: number } | null {
  const m = text.match(/(-?\d{1,2}\.\d{3,})\s*[,/]\s*(-?\d{1,3}\.\d{3,})/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** §11 allows exactly four categories; anything else reads as unstated. */
export function parseCategory(text: string): ParsedEntry["category"] {
  const m = text.toLowerCase().match(/\b(food|entry|transit|other)\b/);
  return m ? (m[1] as NonNullable<ParsedEntry["category"]>) : null;
}

/** The travel leg the note carries under §3c ("10-minute walk from the last stop"). */
export function parseTransport(text: string | null): ParsedTransport | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  const word = Object.keys(MODE_WORDS).find((w) => new RegExp(`\\b${w}\\b`).test(lower));
  if (!word) return null;

  const minutesMatch = text.match(/(\d+)(?:\s*[–—-]\s*\d+)?[\s-]*(?:min|mins|minute|minutes)\b/i);
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/i);
  const minutes = minutesMatch
    ? Number(minutesMatch[1])
    : hourMatch
      ? Math.round(Number(hourMatch[1]) * 60)
      : null;

  return { mode: MODE_WORDS[word], minutes, raw: text.trim() };
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
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

/** §11's heading is `## Day N — YYYY-MM-DD` with no weekday, so it's derived from the date.
 *  `getUTCDay` deliberately — a calendar date read with local accessors rolls back a day west of
 *  Greenwich, which is exactly how a wrong day-of-week reached generated output before. */
export function weekdayFromIso(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : WEEKDAY_SHORT[d.getUTCDay()];
}

function emptySlots(): Record<Slot, ParsedEntry[]> {
  return { Morning: [], Afternoon: [], Evening: [] };
}

/** `**Lodging:** Boutique hotel in Gion — $180 — walkable to tomorrow's cluster` */
export function parseLodgingLine(body: string): ParsedLodging {
  const parts = body.split(DASH).map((p) => p.trim());
  const rest = parts.slice(1).join(" — ");
  return {
    name: parts[0].replace(/\*\*/g, "").trim(),
    costUsd: parseCostUsd(body),
    note: rest.replace(/\$\s*\d[\d,]*(?:\.\d+)?/, "").replace(/^[\s—–-]+/, "").trim() || null,
  };
}

/**
 * One §11 stop line: `- **9:00 AM — Stop name** (category, duration label, $cost, lat/lng)`
 *
 * The parenthesised fields are matched by shape, not by position. A positional split on commas
 * breaks the moment a model writes the coordinate pair as "34.97, 135.77" — which is the more
 * natural way to write it, and which the skill's own `lat/lng` label doesn't forbid.
 */
export function parseEntryLine(line: string): ParsedEntry | null {
  const body = line.replace(/^\s*[-*]\s+/, "").trim();
  if (!body) return null;

  const parenMatch = body.match(/\(([^()]*)\)\s*$/);
  const fields = parenMatch ? parenMatch[1] : "";
  const head = (parenMatch ? body.slice(0, parenMatch.index) : body).replace(/\*\*/g, "").trim();

  // The head is "<time> — <name>"; a model that omits the time leaves the name alone.
  const headParts = head.split(DASH);
  const leadClock = parseClock(headParts[0]);
  const name = (leadClock !== null ? headParts.slice(1).join(" — ") : head).trim();

  const durationMin = parseDuration(fields) ?? parseDuration(body);
  const stated = parseTimeWindow(body);
  const window: TimeWindow | null =
    stated ??
    (leadClock !== null
      ? { startMin: leadClock, endMin: leadClock + (durationMin ?? 0) }
      : null);

  const coords = parseLatLng(fields) ?? parseLatLng(body);

  return {
    raw: body,
    name,
    window,
    durationMin,
    category: parseCategory(fields),
    costUsd: parseCostUsd(fields),
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
    why: null,
    note: null,
    transport: null,
    // §3b: an entry is area-level when it names a district plus an activity kind rather than a
    // specific venue. "around <area>" is the shape the skill asks for; the meal/activity words
    // catch the variants models actually write.
    areaLevel: /\baround\b/i.test(name) || (MEAL_WORDS.test(name) && !/\bat\b/i.test(name)),
    slot: slotForStart(window?.startMin ?? null),
  };
}

export function parseItinerary(markdown: string): ParsedItinerary {
  const hadCodeFence = /^\s*```/.test(markdown);
  const text = markdown.replace(/^\s*```(?:markdown)?\s*\n/, "").replace(/\n\s*```\s*$/, "");

  const days: ParsedDay[] = [];
  const preambleLines: string[] = [];
  let day: ParsedDay | null = null;
  let lastEntry: ParsedEntry | null = null;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();

    const heading = trimmed.match(/^#{2,4}\s+(.*)$/);
    if (heading) {
      const headingText = heading[1].trim();
      const date = parseHeadingDate(headingText);
      day = {
        headingRaw: headingText,
        date,
        dayOfWeek: parseHeadingWeekday(headingText) ?? weekdayFromIso(date),
        theme: null,
        weather: null,
        lodging: null,
        entriesBySlot: emptySlots(),
        stayNear: null,
        note: null,
      };
      days.push(day);
      lastEntry = null;
      continue;
    }

    if (!day) {
      if (trimmed) preambleLines.push(trimmed);
      continue;
    }

    const weather = trimmed.match(/^\*\*Weather:?\*\*:?\s*(.*)$/i);
    if (weather) {
      day.weather = weather[1].trim() || null;
      lastEntry = null;
      continue;
    }

    const lodging = trimmed.match(/^\*\*Lodging:?\*\*:?\s*(.*)$/i);
    if (lodging) {
      day.lodging = parseLodgingLine(lodging[1].trim());
      day.stayNear = day.lodging.name || null;
      lastEntry = null;
      continue;
    }

    // The old format's day-level caveat line. §11 has no such line, but models carry the habit
    // over, and a caveat is worth keeping rather than dropping on the floor.
    const note = trimmed.match(/^\*\*Note:?\*\*:?\s*(.*)$/i);
    if (note) {
      day.note = note[1].trim();
      lastEntry = null;
      continue;
    }

    // §11's two continuation lines. Indented under their stop, so they're attached to whichever
    // entry was last seen rather than to the day.
    const why = trimmed.match(/^(?:[-*]\s*)?\*{0,2}why\*{0,2}\s*:\s*(.*)$/i);
    if (why && lastEntry) {
      lastEntry.why = why[1].trim() || null;
      continue;
    }
    const entryNote = trimmed.match(/^(?:[-*]\s*)?\*{0,2}note\*{0,2}\s*:\s*(.*)$/i);
    if (entryNote && lastEntry) {
      lastEntry.note = entryNote[1].trim() || null;
      lastEntry.transport = parseTransport(lastEntry.note);
      continue;
    }

    // The italic narrative, which §11 puts directly under the heading.
    const narrative = trimmed.match(/^\*([^*].*)\*$/);
    if (narrative && !day.theme && day.entriesBySlot.Morning.length === 0) {
      day.theme = narrative[1].trim();
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const entry = parseEntryLine(line);
      if (entry) {
        day.entriesBySlot[entry.slot].push(entry);
        lastEntry = entry;
      }
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
