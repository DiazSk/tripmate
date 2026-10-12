import type { StoryScript } from '@shared/storyScript';
import type { MeridianState } from '@shared/meri';

import type { FilmState } from '@/lib/storyFilm';

/**
 * The phone's Meri decisions that depend on the film. The motion table and the chat mapper are shared
 * with the web and live in `src/lib/meri.ts`; they are re-exported here so callers keep one import.
 */
export { meridianMotion, meriForChat, type MeridianMotion, type MeridianState } from '@shared/meri';

/** The narration film. The end of a day is a success even if the voice failed on the way. */
export function meriForFilm(state: FilmState): MeridianState {
  if (state.phase === 'ended') return 'success';
  if (state.phase === 'loading') return 'thinking';
  if (state.voiceBroken) return 'error';
  return state.phase === 'playing' ? 'speaking' : 'paused';
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
