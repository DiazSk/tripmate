import {
  estimateDurationMs,
  LEAD_IN_MS,
  NOVELTY_VOICES,
  pauseAfter,
  rateFor,
  sentenceTimings,
  splitForSpeech,
} from "./storyPacing";
// `kokoroVoice` takes its pacing from `storyPacing` and only a type from here, so there is no
// runtime cycle. Keeping the seam in one file is worth it — every caller above imports `speakOn`
// and nothing else knows there are two engines.
import { naturalVoiceReady, setNaturalVolume, speakNatural } from "./kokoroVoice";

// Re-exported so the web's callers (and `storyVoice.test.mjs`) keep importing pacing from here.
export { estimateDurationMs, pauseAfter, rateFor, splitForSpeech };

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
 * What a beat reports back. `onEnd` fires exactly once when the beat is over, `onError` instead of
 * it when the voice could not speak, and `onSentence` each time a sentence (an index into
 * `splitForSpeech(text)`) actually *starts* being heard, with the `performance.now()` it started at.
 * The controller tracks the sentence from these, which is what lets a beat be picked up at the
 * sentence it was on rather than from its top.
 */
export interface SpeakHandlers {
  onEnd?: () => void;
  onError?: () => void;
  onSentence?: (index: number, startedAt: number) => void;
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
/** The narration's volume, 0 to 1, for both voices: the player bar's slider, and 0 for mute. Module
 *  state rather than an argument, so a drag changes the voice that is talking without restarting its
 *  beat. The platform voice takes it at the next sentence (an utterance's volume is fixed once
 *  spoken, which is why the controller mutes that voice by moving to `speakSilently` instead); the
 *  natural voice at once, through its gain. */
let narrationVolume = 1;
export function setNarrationVolume(volume: number): void {
  narrationVolume = Math.max(0, Math.min(1, volume));
  setNaturalVolume(narrationVolume);
}

export function speak(text: string, handlers: SpeakHandlers = {}, from = 0): SpeakHandle {
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

  // `from` picks the beat up at a sentence: a resume, an unmute, or the natural voice handing a
  // sentence back. Pacing still reads the absolute index, so the closing sentence still lands slower.
  const first = Math.max(0, Math.min(from, chunks.length));
  if (first >= chunks.length) {
    const timer = setTimeout(() => handlers.onEnd?.(), 0);
    return { cancel: () => clearTimeout(timer) };
  }

  let done = false;
  let index = first;
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
    utterance.volume = narrationVolume;

    // The start guard applies to the first chunk spoken only. Once a voice has spoken once it is
    // not going to turn out to be mute, and re-arming it per sentence would risk cancelling a live
    // narration over a slow queue hand-off between utterances.
    const at = index;
    utterance.onstart = () => {
      if (done) return;
      clearTimeout(startGuard);
      handlers.onSentence?.(at, performance.now());
    };
    if (index === first) {
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
 * A beat that says nothing, on the same estimate a spoken one is paced by: what a muted film and a
 * voiceless platform are "spoken" with, so the subtitle follows the same sentence events either way
 * (mobile's `silentSpeech` is the same idea). Same contract as `speak`: `onSentence` per sentence,
 * one `onEnd` at the beat's estimated length, nothing after `cancel`.
 *
 * `intoMs` continues mid-sentence, for a mute: the voice stops, the words keep lighting from where
 * they were, and no lead-in is spent. Without it a resume starts sentence `from` after `LEAD_IN_MS`,
 * as the voice would.
 */
export function speakSilently(text: string, handlers: SpeakHandlers = {}, from = 0, intoMs = 0): SpeakHandle {
  const { chunks, startMs, spokenMs, totalMs } = sentenceTimings(text);
  const first = Math.max(0, Math.min(from, chunks.length));
  const timers: ReturnType<typeof setTimeout>[] = [];
  let done = false;
  // The point in the beat's own estimated timeline that "now" corresponds to.
  const into = Math.max(0, Math.min(intoMs, spokenMs[first] ?? 0));
  const origin = first >= chunks.length ? totalMs : into > 0 ? startMs[first] + into : startMs[first] - LEAD_IN_MS;
  for (let i = first; i < chunks.length; i++) {
    const at = i;
    timers.push(
      setTimeout(() => {
        if (!done) handlers.onSentence?.(at, performance.now() - (at === first ? into : 0));
      }, Math.max(0, startMs[i] - origin))
    );
  }
  timers.push(
    setTimeout(() => {
      if (done) return;
      done = true;
      handlers.onEnd?.();
    }, Math.max(0, totalMs - origin))
  );
  return {
    cancel: () => {
      done = true;
      timers.forEach(clearTimeout);
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
export function speakOn(engine: VoiceEngine, text: string, handlers: SpeakHandlers = {}, from = 0): SpeakHandle {
  if (engine !== "natural" || !naturalVoiceReady()) return speak(text, handlers, from);

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
   * right one. The handover picks up at the sentence that failed (`at`), not the beat's top.
   */
  const live: { handle: SpeakHandle | null } = { handle: null };
  live.handle = speakNatural(
    text,
    {
      onEnd: handlers.onEnd,
      onSentence: handlers.onSentence,
      onError: (at) => {
        live.handle = speak(text, handlers, at);
      },
    },
    from
  );
  return { cancel: () => live.handle?.cancel() };
}
