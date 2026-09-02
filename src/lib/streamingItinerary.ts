import type { Stop } from "./types";

export interface StreamedStop {
  dayIndex: number;
  stopIndex: number;
  stop: Stop;
}

export interface FeedResult {
  /** Stops that became complete during this feed, in document order, each reported once. */
  stops: StreamedStop[];
  /** Day indices whose object closed during this feed — the signal to resolve that day's
   *  coordinates, since `stops` is the last field of a day in the requested shape. */
  closedDays: number[];
}

const CLOSER: Record<string, string> = { "{": "}", "[": "]" };

/**
 * Whether a parsed value carries everything needed to render a stop.
 *
 * `category` is deliberately part of the test and is the field that actually gates emission:
 * it is the LAST field of a stop in the shape `itineraryPrompt.ts` asks for, so an object
 * that has one is an object that has all of them. Checking the cheap final field beats
 * brace-counting the buffer, and it degrades correctly if the model ever reorders — a
 * reordered stop is simply held back until it is genuinely complete, never emitted half-written.
 */
function isRenderableStop(value: unknown): value is Stop {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.name === "string" &&
    s.name.length > 0 &&
    Number.isFinite(s.lat) &&
    Number.isFinite(s.lng) &&
    typeof s.time === "string" &&
    typeof s.category === "string" &&
    s.category.length > 0
  );
}

/**
 * Reads a `{"days":[…]}` itinerary out of a model's token stream while it is still being written.
 *
 * The approach is deliberately not a hand-written JSON state machine. It scans only for the
 * structural facts it needs — where the last complete value ended, and which brackets are still
 * open there — then hands a repaired slice to `JSON.parse`, which does the actual parsing. That
 * keeps the only novel logic here to "how much of this text is safe to parse", which is a much
 * smaller thing to get right than a parser.
 *
 * **The scan is incremental and must stay that way.** It resumes at the first byte that arrived
 * this feed rather than re-reading the buffer, so a 20KB response costs O(n) across the whole
 * stream instead of O(n²). Re-scanning from zero on each token is the obvious refactor and it is
 * the wrong one — deltas arrive thousands of times per generation.
 */
export class StreamingItineraryParser {
  /** Everything received so far. Needed whole, because a parse candidate is a slice of it. */
  private buf = "";
  /** Closing brackets owed, innermost last. */
  private stack: string[] = [];
  private inString = false;
  private escaped = false;
  /** Offset of the opening `{` of the root object, or -1 before it has been seen. Skipping to
   *  it is what tolerates a ```json fence the prompt asked the model not to emit but which it
   *  sometimes emits anyway — the same allowance `parseJsonResponse` makes. */
  private rootStart = -1;
  /** Offset immediately after the last *complete* value, at any depth. Slicing here is what
   *  guarantees the candidate never ends mid-token — the one thing appending brackets cannot fix. */
  private safeIndex = 0;
  /** The bracket stack as it stood at `safeIndex`, which is what the candidate must close. */
  private safeStack: string[] = [];
  /** Stops already reported, per day index. */
  private emitted: number[] = [];
  private daysClosed = 0;
  private daysReported = 0;

  feed(delta: string): FeedResult {
    const start = this.buf.length;
    this.buf += delta;
    let sawClose = false;

    for (let i = start; i < this.buf.length; i++) {
      const ch = this.buf[i];

      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (ch === "\\") this.escaped = true;
        else if (ch === '"') {
          this.inString = false;
          this.mark(i + 1);
        }
        continue;
      }

      if (ch === '"') {
        this.inString = true;
      } else if (ch === "{" || ch === "[") {
        if (this.rootStart < 0 && ch === "{") this.rootStart = i;
        this.stack.push(CLOSER[ch]);
      } else if (ch === "}" || ch === "]") {
        this.stack.pop();
        this.mark(i + 1);
        sawClose = true;
        // Back to [root object, days array] means the container that just closed was a day.
        // A lodging object pops back to depth 3 and a stop object to depth 4, so neither
        // can be mistaken for one.
        if (ch === "}" && this.stack.length === 2) this.daysClosed++;
      }
    }

    // Nothing closed, so nothing can have become complete. Skipping the parse here is what
    // keeps the per-token cost near zero for the ~90% of deltas that are mid-value text.
    if (!sawClose) return { stops: [], closedDays: [] };
    if (this.rootStart < 0 || this.safeIndex <= this.rootStart) return { stops: [], closedDays: [] };

    const candidate =
      this.buf.slice(this.rootStart, this.safeIndex) + [...this.safeStack].reverse().join("");

    let parsed: { days?: unknown };
    try {
      parsed = JSON.parse(candidate) as { days?: unknown };
    } catch {
      // Expected and routine, not an error: a safe point can land after a *key*'s closing
      // quote, which repairs to `{"days"}`. Wait for more input.
      return { stops: [], closedDays: [] };
    }

    const days = Array.isArray(parsed?.days) ? (parsed.days as Record<string, unknown>[]) : [];
    const stops: StreamedStop[] = [];
    for (let d = 0; d < days.length; d++) {
      const dayStops = Array.isArray(days[d]?.stops) ? (days[d].stops as unknown[]) : [];
      let next = this.emitted[d] ?? 0;
      for (let s = next; s < dayStops.length; s++) {
        // `break`, never `continue`: stops must reach the map in the order the model wrote
        // them, and skipping past an incomplete one would both reorder the day and strand
        // that stop permanently, since `emitted` would have moved beyond it.
        const candidate = dayStops[s];
        if (!isRenderableStop(candidate)) break;
        stops.push({ dayIndex: d, stopIndex: s, stop: candidate });
        next = s + 1;
      }
      this.emitted[d] = next;
    }

    const closedDays: number[] = [];
    while (this.daysReported < this.daysClosed) closedDays.push(this.daysReported++);

    return { stops, closedDays };
  }

  private mark(index: number): void {
    this.safeIndex = index;
    this.safeStack = [...this.stack];
  }
}
