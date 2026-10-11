import type { StoryScript } from '@shared/storyScript';

import type { FilmState } from '@/lib/storyFilm';

/**
 * Meri's decisions, as pure functions — what each state moves, and which state each surface is in.
 * `meridian.tsx` only draws what these return.
 *
 * **Meri only shows a state the app is actually in.** Nothing here invents "thinking"; every state
 * comes from a flag the film or the chat already holds. The body never changes colour by state, so
 * no state is told by colour alone — the host says it in words too.
 */

export type MeridianState =
  | 'idle'
  | 'thinking'
  | 'streaming'
  | 'speaking'
  | 'paused'
  | 'success'
  | 'error'
  | 'offline';

export interface MeridianMotion {
  /** One full breath, in ms, or null for no breathing. */
  breatheMs: number | null;
  blink: boolean;
  /** One full eye drift, in ms, or null. */
  driftMs: number | null;
  /** Speaking's squash-and-stretch loop. */
  squash: boolean;
  /** One lift on entering the state. */
  lift: boolean;
  /** Eye height as a fraction of open. */
  eyes: number;
}

const STILL: MeridianMotion = { breatheMs: null, blink: false, driftMs: null, squash: false, lift: false, eyes: 1 };

const MOTION: Record<MeridianState, MeridianMotion> = {
  idle: { ...STILL, breatheMs: 3200, blink: true },
  thinking: { ...STILL, breatheMs: 1400, blink: true },
  streaming: { ...STILL, breatheMs: 3200, blink: true, driftMs: 2400 },
  speaking: { ...STILL, blink: true, squash: true },
  paused: { ...STILL, eyes: 0.8 },
  success: { ...STILL, breatheMs: 3200, blink: true, lift: true },
  error: STILL,
  offline: STILL,
};

/** Reduce Motion stills every state completely; the eyes keep their shape. */
export function meridianMotion(state: MeridianState, reducedMotion: boolean): MeridianMotion {
  const motion = MOTION[state];
  return reducedMotion ? { ...STILL, eyes: motion.eyes } : motion;
}

/** The narration film. The end of a day is a success even if the voice failed on the way. */
export function meriForFilm(state: FilmState): MeridianState {
  if (state.phase === 'ended') return 'success';
  if (state.phase === 'loading') return 'thinking';
  if (state.voiceBroken) return 'error';
  return state.phase === 'playing' ? 'speaking' : 'paused';
}

/** The chat sheet. A failed turn outranks a reply that just landed. */
export function meriForChat(chat: { replying: boolean; failure: string | null; justReplied: boolean }): MeridianState {
  if (chat.replying) return 'thinking';
  if (chat.failure) return 'error';
  return chat.justReplied ? 'success' : 'idle';
}

/** The panel's title: the day's own, or "A day in {city}". */
export function filmTitle(day: { title?: string } | undefined, destination: string): string {
  const own = day?.title?.trim();
  return own || `A day in ${destination.split(',')[0].trim()}`;
}

/** A quiet line under the title, only when it is true. A broken voice wins. */
export function filmSubtitle(script: StoryScript | null, state: FilmState): string | null {
  if (state.voiceBroken) return 'Voice unavailable';
  return script?.source === 'fallback' ? 'Read from your plan' : null;
}
