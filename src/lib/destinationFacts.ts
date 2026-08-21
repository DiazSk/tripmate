import type { DestinationContext, RawFetch } from "./types";

/**
 * Real, trip-specific facts to show while an itinerary generates.
 *
 * The point of this module is what it *doesn't* do: there is no model call here. A "quick"
 * one wouldn't be quick — `runClaude` spends nearly all of its wall clock on time to first
 * token, so trivia fetched that way would land after the itinerary it was meant to cover.
 * Everything below is derived from data the app has already fetched for other reasons, which
 * also makes it true and specific to this trip rather than generic ("Sep 23 is a public
 * holiday there" beats "Kyoto has many temples").
 *
 * Every import is `import type` so the whole file erases at runtime and
 * destinationFacts.test.mjs can import it directly — see the note in CLAUDE.md about
 * ERR_MODULE_NOT_FOUND. Keep it that way: one value import makes this untestable.
 *
 * Nothing here invents. A fact exists only if the data behind it does, so a destination that
 * geocoded badly or a bundle that never arrived yields fewer facts, or none, rather than
 * filler. The caller decides what to do with a short list.
 */

export type FactFamily = "holiday" | "weather" | "sun" | "poi" | "context" | "wiki" | "calendar" | "trend";

export interface FactInput {
  /** What the user typed. Only the part before the first comma is used in copy. */
  destination: string;
  /** Null when the Step 2a bundle failed or the user outran it — drops every bundle fact. */
  rawFetch: RawFetch | null;
  /** Parsed cache value from /api/destination-context. Model-sourced, so ranked below the
   *  API-sourced families. */
  context?: DestinationContext | null;
  /** Wikipedia REST summary `extract`, via usePlacePhoto(name, "extract"). */
  wikiExtract?: string | null;
  /** `-new Date().getTimezoneOffset()`. Passed in rather than read so this stays pure and
   *  the tests stay deterministic wherever they run. */
  viewerUtcOffsetMinutes?: number | null;
}

interface Fact {
  text: string;
  score: number;
  family: FactFamily;
}

/** Longer than this and the card stops being glanceable. Dropped, never truncated — half a
 *  fact can say something the whole fact didn't. */
const MAX_LEN = 120;
/** The wait runs about 150 seconds and the screen shows a fact every 7, so ~21 slots. The cap is
 *  set above that on purpose: a feed that loops back to fact one while the traveller is still
 *  reading is the thing this number exists to prevent. It is a ceiling, not a target — the pool
 *  is whatever the fetched data genuinely supports, and no fact is invented to reach it. */
const DEFAULT_LIMIT = 30;
/** At most this many from any one family. Was 2, which was tuned for a 12-fact feed and left most
 *  of the fetched material unused — a seven-day forecast contributed two lines and twelve
 *  candidate POIs contributed one. The round-robin interleave below is what actually stops any
 *  family clustering, so the cap can be loose without the feed reading as all-weather. */
const PER_FAMILY = 5;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-23" → "Sep 23". Pure string work: `new Date("2026-09-23")` parses as UTC midnight
 *  and rolls back a day when formatted with local accessors anywhere west of Greenwich, which
 *  has already put a wrong weekday into generated output once (see CLAUDE.md). */
function formatDay(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}` : null;
}

/** "2026-08-14T18:42" → "6:42pm". Slicing only, for a sharper reason than formatDay: these
 *  timestamps are local wall-clock at the *destination* and carry no zone suffix, so handing
 *  them to `new Date()` reinterprets them in the viewer's timezone — a Kyoto sunset would
 *  read back shifted by hours for a traveler planning from London. */
export function formatLocalTime(iso: string | null | undefined): string | null {
  const m = /T(\d{2}):(\d{2})/.exec(iso ?? "");
  if (!m) return null;
  const h24 = Number(m[1]);
  if (h24 > 23) return null;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m[2]}${h24 < 12 ? "am" : "pm"}`;
}

/** Which day of the trip a date falls on, looked up rather than assumed from array position:
 *  a short weather response would otherwise label the wrong day. Null drops the fact. */
function dayNumber(date: string, days: readonly { date: string }[]): number | null {
  const i = days.findIndex((d) => d.date === date);
  return i >= 0 ? i + 1 : null;
}

function shortPlace(destination: string): string {
  return destination.split(",")[0]?.trim() || destination.trim();
}

/** Whole hours the destination runs ahead of / behind the viewer, or null if either side is
 *  unknown. `Intl` is a runtime global, not an import, so the type-only rule above holds. */
function hoursAhead(
  timeZone: string | null,
  onDate: string | null,
  viewerOffsetMinutes: number | null | undefined
): number | null {
  if (!timeZone || !onDate || viewerOffsetMinutes == null) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
      .formatToParts(new Date(`${onDate}T12:00:00Z`));
    const label = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    if (label === "GMT" || label === "UTC") return Math.round(-viewerOffsetMinutes / 60);
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(label);
    if (!m) return null;
    const target = (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
    return Math.round((target - viewerOffsetMinutes) / 60);
  } catch {
    return null;
  }
}

/** Abbreviations common in place descriptions, where the period is not a sentence end. */
const ABBREVIATIONS = new Set(["St", "Mt", "Ft", "Dr", "Mr", "Mrs", "Ms", "Jr", "Sr", "approx", "est", "c"]);

/** Shortest run of prose worth showing as a fact. Below this it is a fragment, not a fact. */
const MIN_SENTENCE = 20;

/** First sentence of a Wikipedia extract.
 *
 *  Walks the ". " candidates and skips any preceded by a known abbreviation, rather than the
 *  cheaper trick of only looking past character 40 — that dodges "Mt. Fuji" but also swallows
 *  a legitimately short opener like "Kyoto is a city in Japan." and returns two sentences. */
/**
 * Split a Wikipedia extract into sentences, respecting `ABBREVIATIONS` so "St. Peter's" does not
 * become two. Length is deliberately *not* filtered here — `push` enforces `MAX_LEN` against the
 * finished string with its attribution attached, which is the only length that matters.
 */
function sentences(extract: string): string[] {
  const trimmed = extract.trim();
  const out: string[] = [];
  let start = 0;
  let from = 0;
  for (;;) {
    const cut = trimmed.indexOf(". ", from);
    if (cut === -1) break;
    const precedingWord = /(\S+)$/.exec(trimmed.slice(0, cut))?.[1] ?? "";
    if (ABBREVIATIONS.has(precedingWord)) {
      from = cut + 2;
      continue;
    }
    out.push(trimmed.slice(start, cut + 1).trim());
    start = cut + 2;
    from = start;
  }
  const tail = trimmed.slice(start).trim();
  if (tail) out.push(tail);
  return out.filter((sentence) => sentence.length >= MIN_SENTENCE);
}

export function buildDestinationFacts(input: FactInput, limit: number = DEFAULT_LIMIT): string[] {
  const facts: Fact[] = [];
  const push = (family: FactFamily, score: number, text: string) => {
    if (text.length <= MAX_LEN) facts.push({ family, score, text });
  };

  const place = shortPlace(input.destination || "");
  const raw = input.rawFetch;

  if (raw) {
    const { dateContext, destination, weather, holidays, candidatePois } = raw;

    // --- Holidays: the family most likely to change what the traveler actually does ------
    if (holidays.available && holidays.events.length > 0) {
      const inWindow = holidays.events.filter((e) => dayNumber(e.date, dateContext.days) !== null);
      if (inWindow.length === 1) {
        const e = inWindow[0];
        const day = formatDay(e.date);
        const local = e.localName && e.localName !== e.name ? ` (${e.localName})` : "";
        if (day) push("holiday", 95, `${day} is a public holiday there — ${e.name}${local}.`);
      } else if (inWindow.length > 1) {
        const days = inWindow.map((e) => formatDay(e.date)).filter(Boolean);
        if (days.length > 1) {
          push("holiday", 95, `Two public holidays land inside your dates — ${days.join(" and ")}.`);
        }
      }
    }

    // --- Weather ------------------------------------------------------------------------
    // The split matters. Beyond a ~16-day horizon the app silently falls back to the same
    // calendar dates last year, and calling that a forecast would be a lie the traveler
    // can't detect. Every string below the `historical` branch says which one it is.
    const days = weather.days;
    if (weather.available && days.length > 0) {
      if (weather.historical) {
        const lo = Math.min(...days.map((d) => d.tempMinC));
        const hi = Math.max(...days.map((d) => d.tempMaxC));
        // Deliberately avoids the words "forecast"/"expect"/"will be" outright rather than
        // disclaiming one — the test asserts on those words, and a rule that has to reason
        // about whether a sentence is claiming or denying is a rule that eventually lets a
        // claim through.
        push(
          "weather",
          70,
          `These dates are far enough out that we're going on last year: ${Math.round(lo)}–${Math.round(hi)}°C then.`
        );
      } else {
        const wettest = [...days].sort(
          (a, b) => (b.precipitationProbability ?? -1) - (a.precipitationProbability ?? -1)
        )[0];
        const wetChance = wettest?.precipitationProbability ?? null;
        if (wetChance != null && wetChance >= 60) {
          const n = dayNumber(wettest.date, dateContext.days);
          if (n) push("weather", 90, `Day ${n} carries a ${Math.round(wetChance)}% chance of rain — worth an indoor morning.`);
        } else if (
          days.length >= 3 &&
          days.every((d) => d.precipitationProbability != null && d.precipitationProbability <= 20)
        ) {
          push("weather", 88, `Not one day above a 20% chance of rain across the whole trip.`);
        }

        const first = days[0];
        const swing = first ? first.tempMaxC - first.tempMinC : 0;
        if (first && swing >= 10) {
          push(
            "weather",
            55,
            `Day 1 swings from ${Math.round(first.tempMinC)}°C at dawn to ${Math.round(first.tempMaxC)}°C — pack a layer.`
          );
        }

        const humid = days.map((d) => d.humidity).filter((h): h is number => h != null);
        if (humid.length > 0) {
          const mean = humid.reduce((a, b) => a + b, 0) / humid.length;
          const warm = Math.max(...days.map((d) => d.tempMaxC));
          if (mean >= 70) {
            push("weather", 45, `Humidity sits near ${Math.round(mean)}% — ${Math.round(warm)}°C will feel warmer than it reads.`);
          }
        }
      }

      // Warmest day works on both paths; the wording carries the tense.
      if (days.length >= 3) {
        const warmest = [...days].sort((a, b) => b.tempMaxC - a.tempMaxC)[0];
        const spread = warmest.tempMaxC - Math.min(...days.map((d) => d.tempMaxC));
        const n = dayNumber(warmest.date, dateContext.days);
        if (n && spread >= 4) {
          push(
            "weather",
            60,
            weather.historical
              ? `Day ${n} was the warmest of these dates last year, around ${Math.round(warmest.tempMaxC)}°C.`
              : `Day ${n} looks like the warmest of the trip, around ${Math.round(warmest.tempMaxC)}°C.`
          );
        }
      }

      // --- Sun: astronomical, so it's on both endpoints and needs no forecast caveat -----
      const first = days[0];
      const sunset = formatLocalTime(first?.sunset);
      const sunrise = formatLocalTime(first?.sunrise);
      if (sunset) {
        push("sun", 65, `The sun sets around ${sunset} on your first day — plan the viewpoint before that.`);
      }
      if (sunrise && sunset && first?.sunrise && first?.sunset) {
        const rh = Number(first.sunrise.slice(11, 13)) + Number(first.sunrise.slice(14, 16)) / 60;
        const sh = Number(first.sunset.slice(11, 13)) + Number(first.sunset.slice(14, 16)) / 60;
        const span = sh - rh;
        if (span >= 14 || (span > 0 && span <= 10)) {
          push("sun", 50, `About ${Math.round(span)} hours of daylight on day 1 — sunrise ${sunrise}, sunset ${sunset}.`);
        }
      }
    }

    // --- POIs ---------------------------------------------------------------------------
    if (candidatePois.available && candidatePois.pois.length > 0) {
      const names = candidatePois.pois.map((p) => p.name).filter(Boolean);
      if (names.length >= 3) {
        const three = `${names[0]}, ${names[1]} and ${names[2]} are all in range`;
        push(
          "poi",
          80,
          // "three of the 3" reads as a bug, because it is one. Only count when there is
          // genuinely more behind the three being named.
          names.length > 3
            ? `${three} — three of the ${names.length} we're weighing.`
            : `${three}, and the plan is picking between them.`
        );
        // Everything past the first three used to go unmentioned: twelve fetched places produced
        // one line. They are named in trios now, scored below the first so the headline trio
        // still leads, and capped by PER_FAMILY like everything else.
        for (let i = 3; i + 2 < names.length; i += 3) {
          push("poi", 50 - i, `${names[i]}, ${names[i + 1]} and ${names[i + 2]} are on the shortlist too.`);
        }
        const tail = names.length % 3;
        if (names.length > 5 && tail === 2) {
          push("poi", 30, `${names[names.length - 2]} and ${names[names.length - 1]} round out the list.`);
        } else if (names.length > 4 && tail === 1) {
          push("poi", 30, `${names[names.length - 1]} is on the list as well.`);
        }
      } else if (names.length > 0) {
        push("poi", 35, `${names.length} rated sight${names.length === 1 ? "" : "s"} sit near ${place}, and the plan is picking from those.`);
      }
    }

    // --- Calendar and geography: the filler tier, only surfaces when little else does ----
    if (dateContext.season && destination.region) {
      push("calendar", 25, `${dateContext.tripDays} days in ${destination.region} — ${dateContext.season}, by the calendar.`);
    }
    const weekendDays = dateContext.days.filter(
      (d) => d.dayOfWeek === "Saturday" || d.dayOfWeek === "Sunday"
    ).length;
    if (weekendDays > 0) {
      push(
        "calendar",
        25,
        `${weekendDays} of your ${dateContext.tripDays} days fall${weekendDays === 1 ? "s" : ""} on a weekend.`
      );
    }
    const ahead = hoursAhead(destination.timezone, dateContext.days[0]?.date ?? null, input.viewerUtcOffsetMinutes);
    if (ahead != null && Math.abs(ahead) >= 3) {
      push(
        "calendar",
        45,
        `${place} runs ${Math.abs(ahead)} hours ${ahead > 0 ? "ahead of" : "behind"} your clock — the first morning will feel odd.`
      );
    }
  }

  // --- Destination context: model-sourced, so ranked under everything fetched from an API -
  // `festivals[].dates` is free text ("late October"), never parsed — the copy is worded so
  // it never claims an overlap with the trip window that the data can't actually support.
  const ctx = input.context;
  if (ctx) {
    // Every festival and every shopping area, not just the first of each. The model returns
    // several of both and only index 0 was ever read.
    (ctx.festivals ?? []).forEach((festival, i) => {
      if (!festival?.name || !festival.dates) return;
      push("context", 75 - i, `${festival.name}, around ${festival.dates} — an event we're checking against your dates.`);
    });
    (ctx.shopping ?? []).forEach((shop, i) => {
      if (!shop?.name || !shop.area) return;
      push("context", 40 - i, `${shop.name} sits in ${shop.area} — a shopping stop on the shortlist.`);
    });

    // Trends are new here and get their own family so they interleave rather than competing with
    // festivals for the context cap. The prompt asks for "popular new spots, seasonal crowds",
    // which is exactly the register this screen wants.
    //
    // Safety notes stay excluded, and that is a decision rather than an omission: "pickpockets in
    // crowds" is useful inside a plan and a sour thing to read while waiting for a holiday to be
    // written. The model still receives them — see `formatContextBlock` in itineraryPrompt.ts.
    (ctx.trends ?? []).forEach((trend, i) => {
      const note = trend?.note?.trim();
      if (note) push("trend", 35 - i, note.endsWith(".") ? note : `${note}.`);
    });
  }

  // --- Wikipedia: verbatim CC BY-SA prose, so it carries attribution. Unattributed it reads
  // as something TripMate asserted rather than quoted.
  if (input.wikiExtract) {
    // Every sentence that fits, not just the first. The old version took `firstSentence` and gave
    // up if it was too long — and Kyoto's opening sentence is 146 characters, over `MAX_LEN` once
    // attribution is attached, so the *richest* extracts contributed zero facts while thin ones
    // contributed theirs. Measured against the live Kyoto extract: 0 facts before, 3 after.
    // `85 - i` keeps them in document order; `PER_FAMILY` caps how many actually ship.
    sentences(input.wikiExtract).forEach((sentence, i) => push("wiki", 85 - i, `${sentence} — Wikipedia`));
  }

  return rank(facts, limit);
}

/**
 * Cap per family, then interleave round-robin by family so the first few facts come from
 * different sources. Deterministic throughout — no shuffle, no `Math.random()` — so a
 * re-render can't reorder the feed mid-wait and the tests can assert real output.
 */
function rank(facts: Fact[], limit: number): string[] {
  const seen = new Set<string>();
  const byFamily = new Map<FactFamily, Fact[]>();
  for (const f of [...facts].sort((a, b) => b.score - a.score)) {
    if (seen.has(f.text)) continue;
    seen.add(f.text);
    const bucket = byFamily.get(f.family) ?? [];
    if (bucket.length >= PER_FAMILY) continue;
    bucket.push(f);
    byFamily.set(f.family, bucket);
  }

  const queues = [...byFamily.values()].sort((a, b) => b[0].score - a[0].score);
  const out: string[] = [];
  for (let round = 0; out.length < limit; round++) {
    let added = false;
    for (const q of queues) {
      if (round >= q.length) continue;
      out.push(q[round].text);
      added = true;
      if (out.length >= limit) break;
    }
    if (!added) break;
  }
  return out;
}
