import { runComposioTool } from "./composio";

const TOOL_SLUG = "COMPOSIO_SEARCH_GOOGLE_MAPS";

/** Real, looked-up facts about one named place. Every field is independently nullable: a place
 *  can have hours but no admission, or accessibility but no rating, and a caller must be able to
 *  act on whichever it got. */
export interface PlaceFacts {
  /** Lowercase weekday → the day's hours as published ("9 AM–6 PM", "Closed", or a multi-range
   *  string like "9–11 AM, 12–3 PM, 5–8 PM"). Deliberately kept as the published text rather than
   *  parsed into times — see `placeConflicts.ts` for why. */
  hoursByDay: Record<string, string> | null;
  admissionUsd: number | null;
  accessibility: string[];
  /** Google's own "Getting tickets in advance recommended" signal — §14c asks the plan to flag
   *  what needs booking ahead, and this is the only non-invented source for it. */
  bookAhead: boolean;
  rating: number | null;
  /** The listing's own title, kept so the caller can reject a confident mismatch. */
  title: string | null;
  /** Lowercase weekday → hourly busyness (0-100, Google's own scale), from `popular_times`.
   *  Rides along in the SAME response `hoursByDay`/`admissionUsd` come from — no extra call. */
  crowdByDay: Record<string, { time: string; busyness: number | null }[]> | null;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/**
 * The same data arrives in two incompatible shapes and the field names differ, so both are
 * handled here rather than at call sites:
 *
 * - a *search* query ("vegetarian restaurant Gion") → `results.local_results[]`, with
 *   `operating_hours` as an **object** keyed by weekday;
 * - a *named place* query ("Louvre Museum Paris") → `results.place_results`, with `hours` as an
 *   **array of single-key objects** (`[{tuesday: "Closed"}, …]`).
 *
 * Enriching a generated stop is always the second case. A distiller that knew only the first
 * returned no hours at all while looking like the place simply had none published.
 */
function normalizeHours(value: unknown): Record<string, string> | null {
  const out: Record<string, string> = {};

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!entry || typeof entry !== "object") continue;
      for (const [day, hours] of Object.entries(entry as Record<string, unknown>)) {
        if (WEEKDAYS.includes(day.toLowerCase()) && typeof hours === "string") {
          out[day.toLowerCase()] = hours;
        }
      }
    }
  } else if (value && typeof value === "object") {
    for (const [day, hours] of Object.entries(value as Record<string, unknown>)) {
      if (WEEKDAYS.includes(day.toLowerCase()) && typeof hours === "string") {
        out[day.toLowerCase()] = hours;
      }
    }
  }

  return Object.keys(out).length > 0 ? out : null;
}

/** `extensions` is an array of single-key objects — `[{accessibility: [...]}, {planning: [...]}]`
 *  — in both response shapes. */
function extensionValues(extensions: unknown, key: string): string[] {
  if (!Array.isArray(extensions)) return [];
  return extensions.flatMap((entry) => {
    const value = (entry as Record<string, unknown> | null)?.[key];
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  });
}

/**
 * Admission comes back per provider: the venue's own listing plus resellers, each with several
 * ticket types at different prices. **Only the official listing is trusted.**
 *
 * The cheapest-reseller fallback this used to have was wrong in a way that looked right: the free
 * Jardin du Luxembourg has no official admission but several resellers hawking guided walks, so it
 * came back as $11.10 and got pinned onto a stop that costs nothing to enter. A reseller's
 * "with Seine River Cruise" bundle is not what entry costs either. Where there is no official
 * price, the honest answer is no price — the model's own estimate stands.
 */
function pickAdmission(admission: unknown): number | null {
  if (!Array.isArray(admission)) return null;
  const options = admission.flatMap((provider) => {
    const opts = (provider as Record<string, unknown> | null)?.options;
    return Array.isArray(opts) ? (opts as Record<string, unknown>[]) : [];
  });

  const priced = options
    .map((o) => ({
      price: typeof o.extracted_price === "number" ? o.extracted_price : null,
      official: o.official_site === true,
    }))
    .filter((o): o is { price: number; official: boolean } => o.price !== null && o.price > 0);

  return priced.find((o) => o.official)?.price ?? null;
}

/** `popular_times.graph_results` is keyed by weekday, each an array of `{time, busyness_score}`.
 *  Verified live: Eiffel Tower Tuesday includes `{time:"9 AM", busyness_score:20, info:"Usually
 *  not too busy"}`. Absent for many places (museums especially) — that's a real "not tracked"
 *  answer, not a failure, so it degrades to `null` per-day rather than a guessed number. */
function normalizeCrowd(value: unknown): Record<string, { time: string; busyness: number | null }[]> | null {
  if (!value || typeof value !== "object") return null;
  const graph = (value as Record<string, unknown>).graph_results;
  if (!graph || typeof graph !== "object") return null;

  const out: Record<string, { time: string; busyness: number | null }[]> = {};
  for (const [day, hours] of Object.entries(graph as Record<string, unknown>)) {
    if (!WEEKDAYS.includes(day.toLowerCase()) || !Array.isArray(hours)) continue;
    const slots = hours
      .map((h) => {
        const entry = h as Record<string, unknown> | null;
        const time = typeof entry?.time === "string" ? entry.time : null;
        if (!time) return null;
        return {
          time,
          busyness: typeof entry?.busyness_score === "number" ? entry.busyness_score : null,
        };
      })
      .filter((s): s is { time: string; busyness: number | null } => s !== null);
    if (slots.length > 0) out[day.toLowerCase()] = slots;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Pure. Returns `null` when the payload carries nothing usable, so a malformed reply is
 *  indistinguishable from a failed lookup — both degrade the same way. */
export function distilPlaceFacts(raw: unknown): PlaceFacts | null {
  const results = (raw as { results?: Record<string, unknown> } | null)?.results;
  if (!results || typeof results !== "object") return null;

  const place = results.place_results as Record<string, unknown> | undefined;
  const first = Array.isArray(results.local_results)
    ? (results.local_results[0] as Record<string, unknown> | undefined)
    : undefined;
  const source = place ?? first;
  if (!source) return null;

  const facts: PlaceFacts = {
    // Normalize each candidate and take the first that yields a real map — never pick a field by
    // priority. `local_results[]` carries BOTH `hours` as a *status string*
    // ("Closed · Opens 9 AM Mon") AND `operating_hours` as the real weekday map, so a `??` chain
    // takes the non-null string, fails to parse it, and silently drops the hours that were right
    // there. Same field name, two different meanings across the two shapes.
    hoursByDay: normalizeHours(source.hours) ?? normalizeHours(source.operating_hours),
    admissionUsd: pickAdmission(source.admission),
    accessibility: extensionValues(source.extensions, "accessibility"),
    bookAhead: extensionValues(source.extensions, "planning").some((p) =>
      /advance|ahead|book/i.test(p)
    ),
    rating: typeof source.rating === "number" ? source.rating : null,
    title: typeof source.title === "string" ? source.title : null,
    crowdByDay: normalizeCrowd(source.popular_times),
  };

  const empty =
    facts.hoursByDay === null &&
    facts.admissionUsd === null &&
    facts.accessibility.length === 0 &&
    facts.crowdByDay === null &&
    !facts.bookAhead &&
    facts.rating === null;
  return empty ? null : facts;
}

/** Look up one named stop. Scoped by destination because a bare stop name is ambiguous across
 *  cities ("Central Park", "Chinatown"). Resolves `null` on any failure, per the house
 *  convention — the caller leaves the model's own values in place. */
export async function fetchPlaceFacts(name: string, destination: string): Promise<PlaceFacts | null> {
  const data = await runComposioTool(TOOL_SLUG, { q: `${name} ${destination}` });
  if (data === null) return null;
  const facts = distilPlaceFacts(data);
  return facts && titleMatches(name, facts.title) ? facts : null;
}

/**
 * Reject a listing whose name has nothing to do with the stop.
 *
 * The search is fuzzy and will happily return a *nearby business*: probing "Louvre Museum Private
 * Tour" anchored at the Louvre's coordinates returned "Explore Paris Tours", a tour operator, with
 * its own opening hours. Attaching those to a Louvre visit produces a confidently wrong closure —
 * strictly worse than having no hours at all, because the plan then looks verified.
 *
 * Containment in either direction, matching `matchLodgingOption`'s rule: the model decorates stop
 * names ("Louvre Museum Private Tour", "Eiffel Tower Summit"), so the listing title is usually a
 * substring of the stop name rather than equal to it.
 */
export function titleMatches(stopName: string, title: string | null): boolean {
  if (!title) return false;
  const a = normalizeForMatch(stopName);
  const b = normalizeForMatch(title);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
