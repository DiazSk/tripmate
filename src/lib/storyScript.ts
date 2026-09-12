import type { DayPlan, Stop } from "./types";

/**
 * The narration script behind Story mode — the itinerary a day already contains, re-voiced as
 * something that can be *said* while the camera flies through it.
 *
 * This module is the whole of the contract and none of the plumbing: the shape of a script, the
 * ask that produces one, the parse that accepts one, and the script the app falls back to when no
 * model answers. It touches neither the network nor the database, and is imported by both sides —
 * `/api/trip-story` builds and parses with it, `storyMode.tsx` renders and speaks from it — so it
 * must stay free of `node:` imports. The cache key is deliberately *not* here for that reason;
 * the route hashes `compactDay()` with node crypto instead.
 *
 * The governing separation is the one the staged pipeline already draws: the **facts** come from
 * the day (`compactDay`), the **ask** is fixed prose (`buildStoryPrompt`), and no planning rules
 * appear in either — a narration call must never be able to re-plan the day it is describing.
 */

/**
 * What a beat is pointed at, which is also what the camera does while it plays.
 *
 * `opening` frames the whole day, `stop` flies to one place, `closing` pulls back out. The kind is
 * an explicit field rather than inferred from a nullable `stopIndex`, because an opening and a
 * closing would otherwise be indistinguishable — both are "a beat about no particular stop" — and
 * the difference decides whether the camera arrives or leaves.
 */
export type StoryBeatKind = "opening" | "stop" | "closing";

export interface StoryBeat {
  kind: StoryBeatKind;
  /** Index into the day's own `stops` array. Present on — and only on — a `stop` beat. */
  stopIndex?: number;
  /** The line as it will be spoken and, simultaneously, displayed. Two to four sentences. */
  text: string;
}

export interface StoryScript {
  /** 0-based, and the day this script belongs to. Carried so a script that outlives a day switch
   *  can be rejected rather than narrated over the wrong stops. */
  dayIndex: number;
  beats: StoryBeat[];
  /**
   * Whether a model wrote this or the app assembled it from the day's own fields.
   *
   * Surfaced to the UI, not just logged: a fallback script reads like an itinerary read aloud,
   * because that is exactly what it is, and the traveller is owed the difference.
   */
  source: "model" | "fallback";
}

/** Words per minute the narration is paced at when nothing better is measurable — see
 *  `estimateDurationMs` in storyVoice.ts, which shares it. Kept here because the prompt's
 *  sentence-count guidance and this number describe the same budget. */
export const NARRATION_WPM = 160;

/**
 * Bump this whenever `buildStoryPrompt` changes in a way that should produce a different script.
 *
 * It goes into the cache key, and without it a prompt improvement is invisible on every day that
 * already has a script: the fingerprint hashes the *day*, so a better prompt against an unchanged
 * day is a cache hit and the old narration plays forever. Found the hard way — the "writing for
 * the ear" rewrite landed and a cached Lisbon day kept reading its old flat script back.
 *
 * v1: first version. v2: the spoken-cadence rewrite (short naming first sentence, varied lengths,
 * no em-dashes, numbers as words) that `splitForSpeech`'s sentence pauses depend on.
 */
export const STORY_PROMPT_VERSION = 2;

// ─────────────────────────────────────────────────────────────────────────────
// Facts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One day of the plan, as the flat text the prompt shows and the cache key hashes.
 *
 * Both uses want the same property: it changes exactly when something the narration can *see*
 * changes. An edit to a stop's note is a different day to narrate, so it must invalidate the
 * cached script; a lodging cost the narrator never mentions is not, and correctly does not.
 * (`actualCost` is therefore left out — it moves after the trip, when nobody is watching a movie
 * of it.)
 */
export function compactDay(day: DayPlan, dayIndex: number): string {
  const lines: string[] = [];
  lines.push(`Day ${dayIndex + 1} — ${day.date}${day.title ? ` — ${day.title}` : ""}`);
  if (day.weather) lines.push(`Weather: ${day.weather}`);
  if (day.summary) lines.push(`Day theme: ${day.summary}`);
  if (day.lodging) {
    lines.push(
      `Staying at: ${day.lodging.name}${day.lodging.note ? ` — ${day.lodging.note}` : ""}`
    );
  }
  day.stops.forEach((stop, i) => {
    lines.push(
      `Stop ${i}: ${stop.name}` +
        [
          stop.time && `at ${stop.time}`,
          stop.durationLabel && `for ${stop.durationLabel}`,
          stop.category && `(${stop.category})`,
        ]
          .filter(Boolean)
          .map((part) => `, ${part}`)
          .join("")
    );
    if (stop.why) lines.push(`  Why it suits them: ${stop.why}`);
    if (stop.note) lines.push(`  Practical detail: ${stop.note}`);
  });
  return lines.join("\n");
}

/**
 * The key a fetched script is remembered under in the browser, for the session.
 *
 * **It is every input the prompt sees, and nothing else** — which is the only property that makes
 * it correct in both directions: the key changes when the narration would change, and does not
 * change when it would not. `compactDay` is that input, so this is built from it rather than from
 * a hand-picked list of stop fields. The list was the bug: the session cache keyed on
 * `[name, time, why, note]` alone, so renaming a day, re-reading its weather or changing its
 * lodging invalidated the *server's* cache and not this one, and the old script kept playing.
 *
 * Deliberately **no trip id.** Three call sites ask for the same day under three different ones —
 * a real id, the `"preview"` placeholder, and nothing at all — so a key that carried it made them
 * miss each other and pay twice for one script. The trip id in `trip_stories`' primary key is a
 * row scope, not a content scope; the server's own discriminator is the fingerprint, same as here.
 * Two trips that collide have byte-identical prompt input and therefore one correct script.
 *
 * This mirrors the fingerprint `/api/trip-story` hashes — same `STORY_PROMPT_VERSION`, same
 * `compactDay` — so the two caches now invalidate on exactly the same events. The module note
 * above says the cache key is deliberately not here; that is still true of the *hash*, which needs
 * node crypto and stays in the route. This is the plain string it hashes, and it has to live
 * beside `compactDay` for the two to be kept in step.
 */
export function storyCacheKey(params: {
  destination: string;
  dayIndex: number;
  dayCount: number;
  day: DayPlan;
}): string {
  return `${params.destination}|${params.dayCount}|v${STORY_PROMPT_VERSION}\n${compactDay(
    params.day,
    params.dayIndex
  )}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The ask
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The narration ask. Trip data arrives through `compactDay` and nothing else.
 *
 * Three constraints in here are load-bearing rather than stylistic:
 *
 * - **One beat per stop, in order, with `stopIndex`.** The beats are not just audio — the stage
 *   highlights the matching row as each plays and the camera flies to that stop's coordinates. A
 *   script that merged two stops into one beat would leave a row that never lights and a place the
 *   camera never visits.
 * - **No new facts.** The model that wrote the plan had weather, opening hours and a traveler
 *   profile in front of it; this call has a finished day and nothing else, so anything it adds is
 *   invented. "Invented" here means a spoken claim about a real place, which is the worst place in
 *   the product for one.
 * - **Written to be heard**, which is a much longer section than it looks like it should be. A
 *   speech synthesiser reads punctuation and currency badly and there is no second chance to
 *   re-read a sentence — but the load-bearing part is *sentence shape*, because `splitForSpeech`
 *   in storyVoice.ts speaks each beat one sentence at a time with real silence between them. That
 *   makes the model's full stops the narration's breaths: four same-length sentences become a
 *   metronome, a three-clause sentence becomes an unbroken rush, and a short opening sentence
 *   naming the place becomes an arrival the camera lands on. The prompt and the player are one
 *   design here — change either and re-read the other.
 */
export function buildStoryPrompt(params: {
  destination: string;
  dayIndex: number;
  dayCount: number;
  day: DayPlan;
}): string {
  const { destination, dayIndex, dayCount, day } = params;
  const stopCount = day.stops.length;
  return `You are narrating one day of a trip to ${destination} as a short piece of spoken storytelling, played over a map that flies to each place as you describe it.

THE DAY (day ${dayIndex + 1} of ${dayCount}). These are the only facts you have:

${compactDay(day, dayIndex)}

WRITE THE NARRATION.

Voice: second person, present tense, warm and unhurried — "You come up out of the station into..." not "The traveler will visit...". You are walking them through their own day, not reading them a listing.

STRUCTURE

- Exactly ${stopCount + 2} beats: one "opening", then one "stop" beat for each of the ${stopCount} stops in the order given above, then one "closing".
- Every stop beat carries the "stopIndex" of the stop it describes (0 to ${stopCount - 1}). Do not merge, skip or reorder stops.
- 2 to 4 sentences per beat, at most 55 words.
- Each stop beat should carry the traveler *from the previous one* — the walk, the ride, the change of light, the shift in mood. That connective tissue is what makes this a story rather than a list.
- The opening sets the day: where they wake up, what shape the day has, what the weather is doing. The closing lands it — where the day leaves them, and (unless this is the last day) a single sentence of anticipation for tomorrow.

WRITING FOR THE EAR

This is read aloud by a voice, and the listener cannot go back over a sentence. Every rule below is about how it will *sound*:

- **The first sentence of each stop beat is short — eight words or fewer — and names the place.** The map lands on that place as the beat begins, and the narration holds a beat of silence after that sentence, so it works as an arrival: "Then the bamboo closes over you at Arashiyama." Not a long clause with the name buried in the middle.
- **Vary sentence length.** A long one, then a short one. Four sentences of the same length in a row is a metronome, and it is the single thing that makes a synthesised voice sound synthetic.
- **One idea per sentence.** Full stops are where the voice breathes, so a sentence carrying three clauses is read in one unbroken rush. Split it.
- **No em-dashes, semicolons, colons, brackets or ellipses**, except a single "..." when you genuinely want the voice to trail off. Punctuation the engine cannot pronounce is either read out loud or dropped, and both are worse than the comma you should have used.
- **Commas where a person would draw breath**, and nowhere else. They are the only fine-grained pause control there is.
- **Plain prose only**: no markdown, no lists, no emoji, no symbols, no abbreviations. Write numbers, times and money as words — "half past nine", "about twenty euros" — never "9:30" or "$20", which are read as digit strings.
- **Do not open two beats the same way.** No beat after the first may begin with "You" if the one before it did.

TRUTH

- Use only the facts above. Do not invent history, prices, dishes, opening hours, or anything about a place that is not written down here. Where a fact is thin, describe the movement and the feeling instead of adding detail.
- Never say "day ${dayIndex + 1} of ${dayCount}" more than once, and never refer to "stops", "the itinerary", or "the plan" — the traveler is living the day, not reading about it.

Return ONLY this JSON, no prose around it and no code fence:

{"beats":[{"kind":"opening","text":"..."},{"kind":"stop","stopIndex":0,"text":"..."},{"kind":"closing","text":"..."}]}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The parse
// ─────────────────────────────────────────────────────────────────────────────

/** The one field the parse cares about being roughly the right length — a beat that arrives as a
 *  paragraph is a beat the camera sits still through for forty seconds. */
const MAX_BEAT_CHARS = 600;

interface RawBeat {
  kind?: unknown;
  stopIndex?: unknown;
  text?: unknown;
}

/**
 * Accept whatever the model returned and *always* produce a playable script.
 *
 * This is normalisation rather than validation, and the difference is the point: a script is not
 * a plan. A rejected itinerary can be regenerated because the traveler is already waiting for
 * one; a rejected narration would be a Play button that does nothing, having already spent a model
 * call. So every hole is filled from the day itself — a missing opening, a skipped stop, a beat
 * pointed at a stop that does not exist — and the result is a beat list the stage can walk in
 * lockstep with the day's rows.
 *
 * The invariants callers may rely on: exactly one `opening` first, exactly one `stop` beat per
 * stop in the day's own order, at most one `closing` last, and no empty `text`.
 */
export function normaliseScript(
  raw: unknown,
  params: { day: DayPlan; dayIndex: number; dayCount: number; destination: string }
): StoryScript {
  const { day, dayIndex } = params;
  const rawBeats: RawBeat[] = Array.isArray((raw as { beats?: unknown })?.beats)
    ? ((raw as { beats: RawBeat[] }).beats as RawBeat[])
    : [];

  const clean = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const text = value.replace(/\s+/g, " ").trim().slice(0, MAX_BEAT_CHARS);
    return text.length > 0 ? text : null;
  };

  const opening =
    clean(rawBeats.find((b) => b.kind === "opening")?.text) ?? openingFallback(params);

  /** First match wins, so a model that emitted two beats for one stop contributes one. */
  const stopText = (index: number): string =>
    clean(
      rawBeats.find(
        (b) => b.kind === "stop" && typeof b.stopIndex === "number" && b.stopIndex === index
      )?.text
    ) ?? stopFallback(day.stops[index]);

  const beats: StoryBeat[] = [
    { kind: "opening", text: opening },
    ...day.stops.map((_, index) => ({ kind: "stop" as const, stopIndex: index, text: stopText(index) })),
  ];

  // Closing is the one beat with no fallback. A generic "and that was your day" is filler in the
  // one position a listener is guaranteed to be paying attention to, so if the model did not write
  // one the script simply ends on the last place — which is also where the day ends.
  const closing = clean(rawBeats.find((b) => b.kind === "closing")?.text);
  if (closing) beats.push({ kind: "closing", text: closing });

  return { dayIndex, beats, source: "model" };
}

/**
 * The script for when no model answered at all — a timeout, a missing API key, a 500.
 *
 * Deliberately built from the same two fields the panel already shows (`why`, then `note`), which
 * is why it reads as an itinerary rather than as a story: it is one. Story mode still plays, the
 * camera still flies, the rows still light in time, and `source: "fallback"` is what lets the
 * stage say so in a line rather than pretending.
 */
export function fallbackScript(params: {
  day: DayPlan;
  dayIndex: number;
  dayCount: number;
  destination: string;
}): StoryScript {
  const { day, dayIndex } = params;
  return {
    dayIndex,
    beats: [
      { kind: "opening", text: openingFallback(params) },
      ...day.stops.map((stop, index) => ({
        kind: "stop" as const,
        stopIndex: index,
        text: stopFallback(stop),
      })),
    ],
    source: "fallback",
  };
}

function openingFallback(params: {
  day: DayPlan;
  dayIndex: number;
  dayCount: number;
  destination: string;
}): string {
  const { day, dayIndex, dayCount, destination } = params;
  const city = destination.split(",")[0].trim();
  const parts = [`Day ${dayIndex + 1} of ${dayCount} in ${city}.`];
  if (day.title) parts.push(`${day.title}.`);
  if (day.summary) parts.push(day.summary.trim().replace(/\.?$/, "."));
  else if (day.stops.length > 0) parts.push(`${day.stops.length} places, starting with ${day.stops[0].name}.`);
  return parts.join(" ");
}

function stopFallback(stop: Stop | undefined): string {
  if (!stop) return "This place is no longer part of the day.";
  const parts = [stop.time ? `${stop.time}. ${stop.name}.` : `${stop.name}.`];
  if (stop.why) parts.push(stop.why.trim().replace(/\.?$/, "."));
  if (stop.note) parts.push(stop.note.trim().replace(/\.?$/, "."));
  return parts.join(" ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Playback helpers (shared by the stage and the controller)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How faded a beat's row is drawn, given which beat is playing.
 *
 * The Apple Music lyric ramp: the line being spoken is at full weight, the one coming is legible
 * but plainly not it, and everything past that is a suggestion of text rather than text. Behind is
 * dimmer than ahead at the same distance — a line already heard has less claim on the eye than one
 * about to be.
 *
 * Returned as a number rather than a class name because it is applied as an inline `opacity`: the
 * ramp is continuous and a Tailwind opacity utility per step would be five classes describing one
 * curve.
 */
export function beatOpacity(index: number, activeIndex: number): number {
  const distance = index - activeIndex;
  if (distance === 0) return 1;
  if (distance === 1) return 0.34;
  if (distance === 2) return 0.16;
  if (distance > 2) return 0.08;
  if (distance === -1) return 0.22;
  return 0.1;
}
