import { estimateDurationMs, LEAD_IN_MS, NOVELTY_VOICES, pauseAfter, rateFor, splitForSpeech } from '@shared/storyPacing';

/**
 * The voice behind the film on the phone — the counterpart of the web's `speakOn`.
 *
 * Nothing above this knows which engine speaks: `speech` is injected, so the real one
 * (`narratorEngine.ts`, `expo-speech`) can be swapped for a natural voice later without touching
 * the player, and jest drives this with a fake.
 *
 * A beat is spoken as sentences with timed silence between them, from the same `storyPacing` the
 * web uses — a synthesiser pauses the same 180ms at a comma as at a full stop, so one utterance
 * per beat is a recitation.
 */

export interface SpeakOptions {
  rate: number;
  voice?: string;
  onStart?: () => void;
  onDone?: () => void;
  onStopped?: () => void;
  /** A word is about to be spoken (`expo-speech`'s `onBoundary`). Not every engine fires it. */
  onBoundary?: () => void;
  onError?: (error: unknown) => void;
}

export interface SpeechLike {
  speak(text: string, options: SpeakOptions): void;
  stop(): void;
}

export interface NarratorVoice {
  identifier: string;
  name: string;
  language: string;
  quality: string;
}

/** A voice that has not begun within this is treated as broken, so the film replays the beat on a
 *  timer instead of sitting on one line until the watchdog — the web's `START_GUARD_MS`. */
export const START_GUARD_MS = 2000;

/** A started sentence whose `onDone` never arrives is ended here, the web's 2.5x watchdog. */
function watchdogMs(sentence: string): number {
  return estimateDurationMs(sentence) * 2.5 + 4000;
}

/**
 * **The resume point.** Pause, mute and a trip to the background used to say the beat again from its
 * first word: most beats are one or two long sentences, so to the ear the film started over. It
 * re-enters on the sentence it stopped in, one word back so it starts on a word already heard, and
 * never past the sentence's last word. Exported so the subtitle is placed there before the voice
 * starts, instead of showing the sentence unlit (and the clock a sentence behind) until it does.
 */
export function resumeStart(text: string, from?: { sentence: number; words: number }): { sentence: number; skip: number } {
  if (!from) return { sentence: 0, skip: 0 };
  const chunks = splitForSpeech(text);
  const sentence = Math.max(0, Math.min(chunks.length - 1, from.sentence));
  const words = chunks[sentence]?.split(' ').length ?? 1;
  return { sentence, skip: Math.max(0, Math.min(words - 1, from.words - 1)) };
}

export function speakBeat(
  text: string,
  handlers: {
    onEnd: () => void;
    onError: () => void;
    onWord?: () => void;
    /** A sentence is about to be said: the subtitle shows one at a time. `startWord` is how many of
     *  its words were already heard, when a resume re-enters it part-way. */
    onSentence?: (index: number, count: number, startWord: number) => void;
  },
  options: {
    speech: SpeechLike;
    voice?: string;
    /** Where a paused or muted beat picks up: the sentence, and how many of its words were heard. */
    from?: { sentence: number; words: number };
  },
): { cancel(): void } {
  const { speech, voice, from } = options;
  const chunks = splitForSpeech(text);
  let done = false;
  let started = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // **The latch.** `Speech.stop()` fires `onStopped`, and a stale `onDone` can still arrive after
  // a cancel; without this, Next would advance twice.
  const finish = (report: () => void) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    report();
  };
  // **A failed beat silences the engine too.** A first utterance that begins just after the start
  // guard gave up (an older phone, an Enhanced voice) would otherwise read over a film that has
  // already switched to text — and `cancel()` can no longer reach it, because `done` is set.
  const fail = () =>
    finish(() => {
      speech.stop();
      handlers.onError();
    });

  const speakChunk = (index: number, skip = 0) => {
    if (done) return;
    if (index >= chunks.length) return finish(handlers.onEnd);
    const chunk = chunks[index];
    handlers.onSentence?.(index, chunks.length, skip);
    // A resumed sentence says only its unheard words, but keeps its own pace and pause after.
    const said = skip > 0 ? chunk.split(' ').slice(skip).join(' ') : chunk;
    let settled = false;
    const next = () => {
      if (done || settled) return;
      settled = true;
      clearTimeout(timer);
      if (index + 1 >= chunks.length) return finish(handlers.onEnd);
      timer = setTimeout(() => speakChunk(index + 1), pauseAfter(chunk, index, chunks.length));
    };

    timer = started
      ? setTimeout(next, watchdogMs(said))
      : setTimeout(fail, START_GUARD_MS);
    speech.speak(said, {
      rate: rateFor(index, chunks.length),
      voice,
      onStart: () => {
        if (done || settled || started) return;
        started = true;
        clearTimeout(timer);
        timer = setTimeout(next, watchdogMs(said));
      },
      onDone: next,
      // Meri's speaking pulse. Dropped by the same latch as everything else after a cancel.
      onBoundary: () => {
        if (!done) handlers.onWord?.();
      },
      onError: fail,
    });
  };

  const start = resumeStart(text, from);
  // The lead-in lets the camera begin its move before the narrator speaks over it. A resume has no
  // move to wait for, and a pause of silence there reads as the film catching up.
  timer = setTimeout(() => speakChunk(start.sentence, start.skip), from ? 0 : LEAD_IN_MS);

  return {
    cancel() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      speech.stop();
    },
  };
}

/**
 * The voice to narrate in, or `undefined` for the system default.
 *
 * English only: the script is written in English, and English text in a French voice is
 * confident nonsense. Enhanced (Apple's downloaded voices) beats Default, the phone's own English
 * breaks ties, and the novelty voices — `Bad News` sings the text to a funeral march — are refused
 * by the same list the web uses, because nothing in a voice's fields marks them.
 */
export function pickNarrator(voices: NarratorVoice[], locale: string): string | undefined {
  const norm = (tag: string) => tag.toLowerCase().replace('_', '-');
  const usable = voices.filter(
    (v) => /^en(-|$)/.test(norm(v.language)) && !NOVELTY_VOICES.some((bad) => v.name.toLowerCase().includes(bad)),
  );
  if (usable.length === 0) return undefined;
  const score = (v: NarratorVoice) => (v.quality === 'Enhanced' ? 100 : 0) + (norm(v.language) === norm(locale) ? 10 : 0);
  return usable.reduce((best, v) => (score(v) > score(best) ? v : best), usable[0]).identifier;
}

/**
 * A voice that says nothing, at the narrator's pace: each sentence lasts its `estimateDurationMs`,
 * its words are reported evenly across it, and it starts at once.
 *
 * What a muted film and a film whose voice failed are spoken with. Through `speakBeat` like the real
 * engine, so the pauses between sentences, the subtitle's sentence-at-a-time and the lighting of
 * each word all come from one code path rather than a second, timed one that could drift from it.
 */
export function silentSpeech(): SpeechLike {
  let timers: ReturnType<typeof setTimeout>[] = [];
  return {
    speak(text, options) {
      const words = text.split(/\s+/).filter(Boolean);
      const ms = estimateDurationMs(text);
      timers.push(setTimeout(() => options.onStart?.(), 0));
      words.forEach((_, i) => timers.push(setTimeout(() => options.onBoundary?.(), (ms * i) / words.length)));
      timers.push(setTimeout(() => options.onDone?.(), ms));
    },
    stop() {
      timers.forEach(clearTimeout);
      timers = [];
    },
  };
}
