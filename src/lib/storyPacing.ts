import { NARRATION_WPM } from "./storyScript";

/**
 * How a story beat is paced for the ear — shared by every narrator.
 *
 * Moved out of `storyVoice.ts` so the Expo app can import it: that file imports `kokoroVoice`,
 * which builds a browser Worker, and Metro would bundle it to reach a pure function. The web
 * voice re-exports everything here, so the phone and the browser pause in the same places.
 */

/**
 * Voices that must never narrate, however English they claim to be.
 *
 * macOS ships ~25 novelty voices and Chrome exposes every one of them. They are not bad
 * text-to-speech — they are *effects*: "Bad News" and "Good News" sing the text to a melody,
 * "Bells" and "Cellos" play it as notes, "Zarvox" and "Trinoids" are robots, "Bubbles" gargles.
 * The previous ranking's fallback was "any local English voice", which on a Mac with the premium
 * voices not downloaded could and did land on one of these. A deny list is the only fix: there is
 * nothing about their `lang`, `localService` or `default` fields that distinguishes them.
 */
export const NOVELTY_VOICES = [
  "albert", "bad news", "bahh", "bells", "boing", "bubbles", "cellos", "deranged", "eddy",
  "flo", "fred", "good news", "grandma", "grandpa", "hysterical", "jester", "junior", "kathy",
  "organ", "princess", "ralph", "reed", "rocko", "sandy", "shelley", "superstar", "trinoids",
  "whisper", "wobble", "zarvox",
];

// ─────────────────────────────────────────────────────────────────────────────
// Pacing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Why a beat is spoken as several utterances instead of one.
 *
 * A speech synthesiser reads a paragraph at a constant clip. It pauses at a comma and it pauses at
 * a full stop, and the two are nearly the same length — around 150-200ms — which is why handing it
 * four sentences produces a recitation rather than a story. There is no parameter for this: the
 * Web Speech spec allows SSML, and no browser implements `<break>`, so a `time="600ms"` is read
 * out or dropped depending on the engine.
 *
 * The one thing that *is* controllable is where an utterance ends. So each beat is split into
 * sentences and spoken as a queue, with real silence between them — silence this module times, at
 * lengths chosen per boundary rather than by the engine's one default. That is the whole of the
 * "takes pauses" fix, and it works identically on every voice, including a neural one dropped in
 * behind this seam later.
 */

/** Silence after an ordinary sentence. Engines give this about 180ms; a narrator gives it much
 *  more, and the difference is most of what reads as "telling" rather than "reading". */
const SENTENCE_PAUSE_MS = 420;
/** After a beat's **first** sentence, which is the one that names the place the camera is arriving
 *  on. The longest pause in the beat, deliberately: it is the establishing shot's beat of silence,
 *  and it is where the eye leaves the caption and looks at the map. */
const ARRIVAL_PAUSE_MS = 700;
/** After a sentence that trails off. An ellipsis is the author asking for a longer beat. */
const TRAILING_PAUSE_MS = 620;
/** After a question or an exclamation — shorter than a trail-off, longer than a full stop. */
const EMPHATIC_PAUSE_MS = 520;
/** Before the first word of a beat. The camera flight is 2.5s and starts on the same tick, so a
 *  short lead-in lets the move begin before the voice does — the shot pulls, then the narrator
 *  speaks over it. Doubles as the Chromium cancel-then-speak guard the 60ms delay used to be. */
export const LEAD_IN_MS = 360;

/** Narration pace. The default rate reads like a notification; this reads like somebody telling
 *  you about their day. */
const NARRATION_RATE = 0.92;
/** The last sentence of a beat, a shade slower still — the cadence fall a reader gives the end of
 *  a paragraph. Subtle on purpose: a wider gap than this reads as the voice running out of
 *  batteries rather than as a landing. */
const CLOSING_RATE = 0.88;

/** Abbreviations whose full stop does not end a sentence. Without these, "St. George's Castle"
 *  is spoken as two utterances with a 420ms hole after "St." */
const ABBREVIATIONS = /(?:^|\s)(?:mr|mrs|ms|dr|st|mt|ave|rd|blvd|sr|jr|no|vs|etc|approx|[a-z])\.$/i;

/**
 * Whether a chunk is a *fragment* rather than a short sentence, and so should be spoken together
 * with what follows instead of earning its own pause.
 *
 * The distinction matters and a character-length threshold does not draw it. A fallback beat opens
 * with a bare clock time ("9:00 AM.") which is 8 characters and plainly not a sentence, while
 * "Questions?" is 10 and plainly is one. So: a full stop, and at most two words.
 *
 * Word count, not characters, and no "contains a digit" clause — that was tried and it compounds.
 * Gluing "9:00 AM." onto "Morning coffee in Principe Real." produces a chunk that still contains a
 * digit and still ends in a full stop, so the *next* sentence glued on too, and a three-sentence
 * beat collapsed into one utterance with no pauses at all. Anything ending in "?" or "!" is a
 * complete sentence at any length.
 */
function isFragment(chunk: string): boolean {
  if (!/\.["')\]]*$/.test(chunk)) return false;
  return chunk.split(/\s+/).filter(Boolean).length <= 2;
}

/**
 * Split one beat into the utterances it will actually be spoken as.
 *
 * Sentence boundaries only — no clause splitting. Engines already pause at commas, and cutting an
 * utterance mid-sentence loses the intonation contour that carries the sentence's meaning, which
 * is the opposite of the goal. Text with no terminal punctuation comes back as a single chunk.
 */
export function splitForSpeech(text: string): string[] {
  const normalised = text.replace(/\s+/g, " ").trim();
  if (!normalised) return [];
  // Terminator run, then any closing quote/bracket, then whitespace. The lookahead requires the
  // next sentence to start with a non-lowercase character, which rules out "approx. 3km".
  const raw = normalised.match(/[^.!?…]+(?:[.!?…]+["')\]]*|$)(?:\s+(?=[^a-z])|$)/g);
  if (!raw) return [normalised];

  const chunks: string[] = [];
  for (const piece of raw) {
    const chunk = piece.trim();
    if (!chunk) continue;
    const previous = chunks[chunks.length - 1];
    // Glue on when the *previous* chunk was an abbreviation or a fragment. Checking the previous
    // rather than the current is what makes this work: it is "St." that must not be followed by
    // silence, and the fix is to say it together with what comes after it.
    if (previous && (ABBREVIATIONS.test(previous) || isFragment(previous))) {
      chunks[chunks.length - 1] = `${previous} ${chunk}`;
    } else {
      chunks.push(chunk);
    }
  }
  return chunks.length > 0 ? chunks : [normalised];
}

/**
 * Silence to leave after a given chunk, in ms. Zero after the last one — the gap between beats
 * belongs to the controller, which is also waiting on the next camera flight.
 */
export function pauseAfter(chunk: string, index: number, total: number): number {
  if (index >= total - 1) return 0;
  // Both spellings: the prompt asks for "..." and models emit either that or the single "…".
  if (/(?:\.\.\.|…)["')\]]*\s*$/.test(chunk)) return TRAILING_PAUSE_MS;
  if (index === 0) return ARRIVAL_PAUSE_MS;
  if (/[!?]["')\]]*\s*$/.test(chunk)) return EMPHATIC_PAUSE_MS;
  return SENTENCE_PAUSE_MS;
}

/** Speaking rate for a chunk — see `CLOSING_RATE`. */
export function rateFor(index: number, total: number): number {
  return total > 1 && index === total - 1 ? CLOSING_RATE : NARRATION_RATE;
}

/**
 * How long a beat should be held on screen when nothing can measure it — either because there is
 * no voice, or because the traveler muted it.
 *
 * Sums the same chunks and the same silences the spoken path uses, so a muted film is paced like
 * the narrated one rather than like a different feature. `NARRATION_WPM` is shared with the
 * prompt's own length guidance, so the two describe one budget, and the rate the chunks are
 * actually spoken at is divided back out.
 *
 * The floor exists because a three-word beat still needs long enough for the camera to arrive
 * (`flyTo` is a 2.5s flight) and for the eye to find the line that just lit up.
 */
export function estimateDurationMs(text: string): number {
  const chunks = splitForSpeech(text);
  const spoken = chunks.reduce((total, chunk, index) => {
    const words = chunk.split(/\s+/).filter(Boolean).length;
    return (
      total +
      (words / NARRATION_WPM) * 60_000 / rateFor(index, chunks.length) +
      pauseAfter(chunk, index, chunks.length)
    );
  }, LEAD_IN_MS);
  return Math.max(3200, Math.round(spoken) + 300);
}
