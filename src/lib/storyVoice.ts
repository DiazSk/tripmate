import { NARRATION_WPM } from "./storyScript";
// A deliberate cycle, and a safe one: `kokoroVoice` imports this module's *pacing* helpers (pure
// functions, no module-scope side effects) and this module imports its two entry points, which are
// only ever called after a user gesture. ES modules resolve this fine because nothing on either
// side runs at import time. Keeping the seam in one file is worth it — every caller above imports
// `speakOn` and nothing else knows there are two engines.
import { naturalVoiceReady, speakNatural } from "./kokoroVoice";

/**
 * The voice behind Story mode.
 *
 * **Which engine, and why this one.** The narration is spoken by the browser's own
 * `speechSynthesis` — the Web Speech API. It was chosen against Kokoro-82M (via `kokoro-js`, the
 * best free open-weight TTS that runs in a browser) and against the hosted free tiers, on three
 * grounds that are specific to this app rather than general:
 *
 * 1. **No key, no cost, no quota.** Every other data source in this app degrades when its key is
 *    missing (see `dietaryVenues.ts`, `destinationFestivals.ts`); a narration that degrades to
 *    silence is a Play button that does nothing. This one has nothing to configure.
 * 2. **Nothing to download, and nothing to run on the GPU.** Kokoro is a ~90MB ONNX weight file
 *    and wants WebGPU to be quick. This app is already spending the GPU on a 3D map whose frame
 *    cost governs the whole interface (`docs/map-engine-gpu.md`) — and story mode is precisely
 *    when the map is flying. A second GPU tenant, chosen for prettier vowels, is the wrong trade.
 * 3. **It starts instantly.** Play is a gesture, and the first beat has to begin under it.
 *
 * What that costs is honest to state: the voices are the OS's, so a story sounds different on
 * macOS, Windows and Android, and Linux browsers with no speech-dispatcher installed have no voice
 * at all. `speechAvailable()` reports that and the controller falls back to timed beats — the
 * movie plays silently, in step, rather than not playing.
 *
 * **The provider seam.** Everything above this module talks to `speak()` / `cancel()` /
 * `speechAvailable()` and knows nothing else, exactly as `placeSearch.ts` fronts Google Places and
 * Overpass behind one signature. Dropping in a server-rendered voice later means another
 * implementation of that trio, not a change to the controller or the stage.
 */

/** The fields this module reads off a voice. Structural rather than `SpeechSynthesisVoice` so the
 *  ranking below can be unit-tested without a DOM. */
export interface VoiceLike {
  name: string;
  lang: string;
  localService: boolean;
  default?: boolean;
}

/**
 * Voices worth asking for by name, best first.
 *
 * These are the OS voices that sound like a person reading rather than a station announcement:
 * Apple's premium/enhanced English voices, then Microsoft's and Google's neural ones. Matched by
 * substring, since the exact strings carry suffixes that vary by platform and release
 * ("Samantha (Enhanced)", "Microsoft Aria Online (Natural) - English (United States)").
 *
 * A name that is absent costs nothing — the ranking falls through to "any English voice that is
 * not on the deny list below".
 */
const PREFERRED_VOICES = [
  // Apple premium/enhanced — the best free English voices on any platform.
  "Ava",
  "Zoe",
  "Allison",
  "Susan",
  "Tom",
  "Samantha",
  "Serena",
  "Daniel",
  // Microsoft neural.
  "Aria",
  "Jenny",
  "Guy",
  "Ryan",
  "Sonia",
  // Google — networked, and better than most of what is left locally.
  "Google UK English Female",
  "Google UK English Male",
  "Google US English",
];

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
const NOVELTY_VOICES = [
  "albert", "bad news", "bahh", "bells", "boing", "bubbles", "cellos", "deranged", "eddy",
  "flo", "fred", "good news", "grandma", "grandpa", "hysterical", "jester", "junior", "kathy",
  "organ", "princess", "ralph", "reed", "rocko", "sandy", "shelley", "superstar", "trinoids",
  "whisper", "wobble", "zarvox",
];

/** Whether this browser can speak at all. False on the server, and false in a browser whose
 *  platform has no speech engine installed. */
export function speechAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance === "function"
  );
}

/**
 * Pick the voice to narrate in, or null to let the platform choose.
 *
 * English-only, deliberately: the script is written in English by `buildStoryPrompt`, and handing
 * English text to a French voice produces confident nonsense rather than an accent. A device with
 * no English voice gets `null`, which leaves `utterance.voice` unset and lets the platform do
 * whatever it does — still better than choosing wrongly on its behalf.
 *
 * Local voices outrank network ones even when the network one is nicer. A remote voice is a
 * request per beat: it stalls the first line behind a round trip, and it stops working on a plane,
 * which is a place people look at trip plans.
 */
export function pickVoice<T extends VoiceLike>(voices: T[]): T | null {
  const usable = voices.filter(
    (v) =>
      /^en(-|$)/i.test(v.lang) &&
      !NOVELTY_VOICES.some((bad) => v.name.toLowerCase().includes(bad))
  );
  if (usable.length === 0) return null;
  const score = (voice: T): number => {
    const name = voice.name.toLowerCase();
    const preferred = PREFERRED_VOICES.findIndex((n) => name.includes(n.toLowerCase()));
    return (
      // **A named good voice outranks a local one, which is a reversal.** Local used to dominate
      // at +1000, on the argument that a network voice stalls the first line and dies on a plane.
      // Both are true and neither is worth what it cost: it meant a Mac with no premium voices
      // installed narrated in Fred over Google UK English Female, which is the difference between
      // a story and a 1990s screen reader. Locality is now the tiebreaker it should always have
      // been, and the beat's own `START_GUARD_MS` already covers a voice that will not start.
      (preferred >= 0 ? 1000 - preferred * 10 : 0) +
      // "Enhanced" and "Premium" are Apple's downloaded high-quality variants of a voice that also
      // ships in a compact form under the same name — worth more than the base voice by itself.
      (/enhanced|premium|natural|neural/.test(name) ? 120 : 0) +
      (voice.localService ? 40 : 0) +
      (voice.default ? 5 : 0)
    );
  };
  return usable.reduce((best, voice) => (score(voice) > score(best) ? voice : best), usable[0]);
}

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
const LEAD_IN_MS = 360;

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

/**
 * How long a beat waits for the voice to actually *begin* before giving up on it.
 *
 * `speechAvailable()` can only tell you the API exists, and that is not the same as a platform
 * that speaks: a headless Chromium, a Linux desktop with no speech-dispatcher, and a webview with
 * synthesis disabled all present a complete `speechSynthesis` object whose `speak()` silently does
 * nothing. Measured against that case, waiting for the end-of-beat watchdog costs 40 seconds of a
 * film sitting still on one line — so the *start* is what gets the short deadline. A local voice
 * begins in well under 300ms; 2s is slack for a cold engine, and network voices are already
 * outranked by `pickVoice`.
 */
const START_GUARD_MS = 2000;

export interface SpeakHandle {
  /** Silence this beat and guarantee its callbacks never fire afterwards. Idempotent. */
  cancel: () => void;
}

/**
 * Speak one beat, as a queue of sentences with real silence between them — see the Pacing section
 * above for why one utterance per beat cannot sound like storytelling.
 *
 * Three browser realities are handled here, and all three have bitten this API before:
 *
 * - **`cancel()` immediately followed by `speak()` drops the new utterance** in Chromium. So the
 *   cancel happens now and the first chunk goes out on `LEAD_IN_MS`, which the handle can also
 *   clear — that is what makes `next()` during a beat reliable rather than a coin flip.
 * - **A cancelled utterance still fires `onend`** in WebKit. Left alone that would advance the
 *   story a beat every time someone pressed Next, twice. The `done` latch below is what stops it.
 * - **`onend` sometimes never arrives at all**, on long text or after a device sleeps. A narration
 *   waiting on a callback that will not come is a movie frozen on one frame with no error, so a
 *   watchdog at 2.5x the estimate resolves the beat anyway. It is generous on purpose: firing it
 *   early would cut a voice off mid-sentence.
 *
 * And one that `speechSynthesis` cannot report at all: a platform where **nothing ever speaks**.
 * `START_GUARD_MS` catches that by deadline on `onstart` and reports it as an error, which is how
 * the controller learns to fall back to timed beats for the rest of the film.
 */
export function speak(
  text: string,
  handlers: { onEnd?: () => void; onError?: () => void } = {}
): SpeakHandle {
  if (!speechAvailable()) {
    const timer = setTimeout(() => handlers.onError?.(), 0);
    return { cancel: () => clearTimeout(timer) };
  }

  const synth = window.speechSynthesis;
  const chunks = splitForSpeech(text);
  if (chunks.length === 0) {
    const timer = setTimeout(() => handlers.onEnd?.(), 0);
    return { cancel: () => clearTimeout(timer) };
  }

  let done = false;
  let index = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let startGuard: ReturnType<typeof setTimeout> | undefined;

  const settle = (outcome: "end" | "error") => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    clearTimeout(watchdog);
    clearTimeout(startGuard);
    if (outcome === "end") handlers.onEnd?.();
    else handlers.onError?.();
  };

  /** Speak `chunks[index]`, then wait out its pause and recurse. The queue is driven off `onend`
   *  rather than pre-scheduled off estimates, so the silence is measured from when the voice
   *  actually stopped talking — the only way the gaps stay the length they are meant to be when a
   *  voice runs faster or slower than the estimate. */
  const speakChunk = () => {
    if (done) return;
    const chunk = chunks[index];
    const utterance = new SpeechSynthesisUtterance(chunk);
    const voice = pickVoice(synth.getVoices());
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    utterance.rate = rateFor(index, chunks.length);
    utterance.pitch = 1;

    // The start guard applies to the first chunk only. Once a voice has spoken once it is not
    // going to turn out to be mute, and re-arming it per sentence would risk cancelling a live
    // narration over a slow queue hand-off between utterances.
    if (index === 0) {
      utterance.onstart = () => clearTimeout(startGuard);
      startGuard = setTimeout(() => {
        synth.cancel();
        settle("error");
      }, START_GUARD_MS);
    }

    utterance.onerror = () => settle("error");
    utterance.onend = () => {
      if (done) return;
      clearTimeout(watchdog);
      const pause = pauseAfter(chunk, index, chunks.length);
      index += 1;
      if (index >= chunks.length) {
        settle("end");
        return;
      }
      timer = setTimeout(speakChunk, pause);
    };

    // Per chunk rather than per beat, so a stalled sentence resolves in seconds instead of after
    // the whole beat's allowance. Generous still: firing early cuts a voice off mid-sentence.
    watchdog = setTimeout(() => settle("end"), estimateDurationMs(chunk) * 2.5 + 4000);
    synth.speak(utterance);
  };

  synth.cancel();
  timer = setTimeout(speakChunk, LEAD_IN_MS);

  return {
    cancel: () => {
      done = true;
      clearTimeout(timer);
      clearTimeout(watchdog);
      clearTimeout(startGuard);
      if (speechAvailable()) window.speechSynthesis.cancel();
    },
  };
}

/**
 * Nudge the platform into loading its voice list.
 *
 * Chromium populates `getVoices()` asynchronously and returns `[]` on the first call, so a story
 * that starts within a second of the page settling would narrate in the default voice and every
 * later beat in the chosen one. Calling it once when the controller mounts means the list is warm
 * by the time Play is pressed. Cheap, synchronous, and safe to call repeatedly.
 */
export function warmVoices(): void {
  if (!speechAvailable()) return;
  window.speechSynthesis.getVoices();
}

/** Stop whatever is being said, from anywhere — the exit path, and unmount. */
export function silence(): void {
  if (speechAvailable()) window.speechSynthesis.cancel();
}

// ─────────────────────────────────────────────────────────────────────────────
// The seam
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which narrator is speaking.
 *
 * `browser` is the platform's `speechSynthesis` — free, instant, offline, and it sounds like an OS
 * voice. `natural` is Kokoro-82M in the browser (`kokoroVoice.ts`) — genuinely natural, also free,
 * at the cost of an 88MB first-load.
 *
 * **Nobody chooses any more.** This was a stored preference behind a toggle in the stage, with
 * `browser` as the default because it is the one that always works. That framing had it backwards:
 * "the one that always works" is what a *fallback* is for, and there already is one at every level
 * — the film narrates in `browser` for the whole download, a browser that cannot run the model
 * stays on `browser` forever, and a single sentence that errors or misses
 * `SYNTHESIS_DEADLINE_MS` is handed to `browser` mid-beat. With all of that in place the
 * preference only ever offered somebody the worse narrator. `storyMode` now asks for the natural
 * one on every film and lets this seam sort out which actually speaks.
 */
export type VoiceEngine = "browser" | "natural";

/**
 * Speak a beat on whichever engine is asked for — the one function everything above this file
 * calls.
 *
 * Falls back to the browser voice whenever the natural one is asked for but not actually loaded,
 * which is the ordinary case for the whole first minute after the toggle is flipped. The caller
 * does not have to sequence the load against the film; it flips a preference and the narration
 * upgrades itself when the model arrives.
 */
export function speakOn(
  engine: VoiceEngine,
  text: string,
  handlers: { onEnd?: () => void; onError?: () => void } = {}
): SpeakHandle {
  if (engine !== "natural" || !naturalVoiceReady()) return speak(text, handlers);

  /**
   * The natural voice, with the platform voice underneath it.
   *
   * A neural voice can fail per *sentence* — a synthesis error, or a device that misses
   * `SYNTHESIS_DEADLINE_MS` — and the failure is not the film's fault and must not be the film's
   * problem. So the same beat is handed to `speechSynthesis` from here, mid-beat, and the caller
   * above never learns it happened: it gets one `onEnd` either way. That is the whole reason this
   * dispatcher exists rather than the controller branching on an engine.
   *
   * The handle tracks whichever provider is live, so a Next press during the handover cancels the
   * right one.
   */
  const live: { handle: SpeakHandle | null } = { handle: null };
  live.handle = speakNatural(text, {
    onEnd: handlers.onEnd,
    onError: () => {
      live.handle = speak(text, handlers);
    },
  });
  return { cancel: () => live.handle?.cancel() };
}
