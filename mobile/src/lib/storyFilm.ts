import type { StoryScript } from '@shared/storyScript';
import { legBearingRad } from '@shared/tourPacing';

import type { Stop } from '@/api/types';
import { drawableStops } from '@/lib/mapRegion';

/**
 * The film's clock, as a pure state machine — the same phases as the web's `storyMode.tsx`.
 *
 * **The beat is the clock.** Camera, voice and highlighted line are all derived from `beat`, and a
 * beat only advances when the narrator says it finished (or, with a broken voice, on its
 * estimated length). Resume is `paused` → `playing`, which re-runs the beat effect and so says the
 * beat again from its start: a pause that resumed mid-sentence would talk over a camera that had
 * stopped.
 */

export type FilmPhase = 'loading' | 'playing' | 'paused' | 'ended';

export interface FilmState {
  phase: FilmPhase;
  beat: number;
  count: number;
  /** Latched for the rest of the film once the voice fails — later beats run on a timer. */
  voiceBroken: boolean;
  /** A pause asked for while the script was still being written — the app went to the
   *  background — so the film arrives paused instead of speaking behind another app. */
  holdOnLoad: boolean;
}

export type FilmAction =
  | { type: 'reset' }
  | { type: 'loaded'; count: number }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'toggle' }
  | { type: 'pause' }
  | { type: 'voiceError' };

export const initialFilm: FilmState = { phase: 'loading', beat: 0, count: 0, voiceBroken: false, holdOnLoad: false };

export function filmReducer(state: FilmState, action: FilmAction): FilmState {
  switch (action.type) {
    case 'reset':
      return initialFilm;
    case 'loaded':
      return action.count > 0
        ? { ...state, phase: state.holdOnLoad ? 'paused' : 'playing', beat: 0, count: action.count, holdOnLoad: false }
        : { ...state, phase: 'ended', beat: 0, count: 0, holdOnLoad: false };
    case 'voiceError':
      return { ...state, voiceBroken: true };
    case 'pause':
      if (state.phase === 'loading') return { ...state, holdOnLoad: true };
      return state.phase === 'playing' ? { ...state, phase: 'paused' } : state;
  }
  if (state.phase === 'loading') return state;
  switch (action.type) {
    case 'next':
      return state.beat + 1 >= state.count
        ? { ...state, phase: 'ended' }
        : { ...state, beat: state.beat + 1, phase: 'playing' };
    case 'prev':
      return state.phase === 'ended'
        ? { ...state, beat: state.count - 1, phase: 'playing' }
        : { ...state, beat: Math.max(0, state.beat - 1), phase: 'playing' };
    case 'toggle':
      if (state.phase === 'ended') return { ...state, beat: 0, phase: 'playing' };
      return { ...state, phase: state.phase === 'playing' ? 'paused' : 'playing' };
  }
}

/** The day's stop index the camera should be on, or null to frame the whole day. */
export function filmStopFor(script: StoryScript | null, state: FilmState): number | null {
  if (!script || state.phase === 'loading' || state.phase === 'ended') return null;
  const beat = script.beats[state.beat];
  return beat?.kind === 'stop' && typeof beat.stopIndex === 'number' ? beat.stopIndex : null;
}

/**
 * Where the camera lands for a stop, facing along the day — the web's `legBearingRad`, so the next
 * place is ahead of you as you arrive rather than every arrival being due north.
 *
 * Bearings are measured over the stops the map can draw, so a stop with no coordinates neither
 * gets a camera nor bends the heading of its neighbours. A lone stop faces north.
 */
export function filmCameraFor(
  stops: Stop[],
  index: number,
): { center: { latitude: number; longitude: number }; heading: number } | null {
  const drawn = drawableStops(stops);
  const at = drawn.findIndex((d) => d.index === index);
  if (at < 0) return null;
  const { stop } = drawn[at];
  const bearing = legBearingRad(
    drawn.map((d) => ({ lat: d.stop.lat, lng: d.stop.lng })),
    at,
  );
  return {
    center: { latitude: stop.lat, longitude: stop.lng },
    heading: bearing === null ? 0 : (bearing * 180) / Math.PI,
  };
}
