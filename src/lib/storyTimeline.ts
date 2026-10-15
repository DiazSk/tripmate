import { estimateDurationMs, splitForSpeech } from "./storyPacing";

/**
 * The story film as a timeline, for the player bar's scrubber: how long each beat runs, how far
 * into the day's film the current moment is, and which beat a point on the bar falls in.
 *
 * **Estimated, and the bar says so by behaving rather than by a label.** The beat is the clock (see
 * `storyMode.tsx`): a beat ends when its sentence has been spoken, which is known only when the voice
 * reports it. So durations here are `estimateDurationMs`, the same estimate the controller already
 * uses to time a muted or voiceless beat, and the bar snaps to the true boundary whenever a beat
 * actually advances. A beat that runs long simply holds the bar at its end until it does.
 *
 * Pure, so `npm test` can reach the arithmetic the scrubber's position and its seeks depend on.
 */

/** Each beat's estimated length in ms, in beat order. */
export function beatDurations(beats: readonly { text: string }[]): number[] {
  return beats.map((beat) => estimateDurationMs(beat.text));
}

/** Where the film is, in ms from its start. `withinMs` is clamped to the beat's own length. */
export function elapsedMs(durations: readonly number[], beatIndex: number, withinMs: number, ended = false): number {
  const total = durations.reduce((sum, d) => sum + d, 0);
  if (ended || beatIndex >= durations.length) return total;
  const before = durations.slice(0, Math.max(0, beatIndex)).reduce((sum, d) => sum + d, 0);
  return before + Math.max(0, Math.min(withinMs, durations[beatIndex] ?? 0));
}

/** The beat a point on the bar (0 to 1) falls in. A seek lands on a beat's start, because a beat
 *  is spoken from its beginning: there is no resuming a sentence halfway through. */
export function beatAt(durations: readonly number[], fraction: number): number {
  if (durations.length === 0) return 0;
  const total = durations.reduce((sum, d) => sum + d, 0);
  let at = Math.max(0, Math.min(1, fraction)) * total;
  for (let i = 0; i < durations.length; i++) {
    if (at < durations[i]) return i;
    at -= durations[i];
  }
  return durations.length - 1;
}

/** Where each beat after the first begins, as a fraction of the bar, for its ticks. */
export function beatTicks(durations: readonly number[]): number[] {
  const total = durations.reduce((sum, d) => sum + d, 0);
  if (total <= 0) return [];
  const out: number[] = [];
  let at = 0;
  for (let i = 0; i < durations.length - 1; i++) {
    at += durations[i];
    out.push(at / total);
  }
  return out;
}

/** "1:07". The bar's elapsed and total figures, rounded to the second. */
export function clockLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The subtitle at a point in a beat: the sentence being said, and how many of its words have been.
 *
 * A beat is spoken as a queue of sentences (`splitForSpeech`), so a subtitle shows one at a time,
 * as a film's does, rather than the whole paragraph. Each sentence takes its share of the beat by
 * its own estimated length, the same estimate the bar runs on, and within it the words light in
 * order. Estimated like the bar: a voice slower than the estimate leaves the line fully lit until
 * the beat advances, which reads as the sentence finishing rather than as a fault.
 */
export function subtitleAt(text: string, fraction: number): { sentence: string; words: string[]; said: number; index: number; count: number } {
  const sentences = splitForSpeech(text);
  if (sentences.length === 0) return { sentence: "", words: [], said: 0, index: 0, count: 0 };
  const weights = sentences.map((s) => estimateDurationMs(s));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let at = Math.max(0, Math.min(1, fraction)) * total;
  let index = 0;
  while (index < sentences.length - 1 && at >= weights[index]) at -= weights[index++];
  const words = sentences[index].split(" ");
  const local = weights[index] > 0 ? Math.min(1, at / weights[index]) : 1;
  return { sentence: sentences[index], words, said: Math.round(local * words.length), index, count: sentences.length };
}
