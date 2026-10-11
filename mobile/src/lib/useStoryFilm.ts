import { estimateDurationMs } from '@shared/storyPacing';
import { fallbackScript, type StoryScript } from '@shared/storyScript';
import { useEffect, useReducer, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { storyScript } from '@/api/tripMateApi';
import type { Trip } from '@/api/types';
import { speakBeat } from '@/lib/narrator';
import { deviceSpeech, filmAudio, narratorVoice } from '@/lib/narratorEngine';
import { filmReducer, filmStopFor, initialFilm } from '@/lib/storyFilm';

/**
 * Runs one day's film while `active`: writes or fetches the script, speaks each beat, and
 * advances when the narrator says it finished. Everything decidable is in `storyFilm.ts`; this is
 * the wiring.
 *
 * The camera is not called from here — `stop` is handed to `DayMap`, which flies when it changes.
 * On iOS `animateCamera`'s duration is ignored (`RNMapsMapView.mm`), so the flight's length is
 * MapKit's and nothing here waits on it.
 */
export function useStoryFilm({ trip, dayIndex, active }: { trip: Trip; dayIndex: number; active: boolean }) {
  const [state, dispatch] = useReducer(filmReducer, initialFilm);
  const [script, setScript] = useState<StoryScript | null>(null);
  const voice = useRef<string | undefined>(undefined);
  // Read inside the fetch rather than depended on: a refreshed trip object mid-film must not
  // restart it.
  const tripRef = useRef(trip);
  useEffect(() => {
    tripRef.current = trip;
  });

  useEffect(() => {
    if (!active) return;
    let live = true;
    dispatch({ type: 'reset' });
    filmAudio(true);
    void narratorVoice().then((picked) => {
      voice.current = picked;
    });
    const t = tripRef.current;
    const params = {
      destination: t.destination,
      day: t.itinerary.days[dayIndex],
      dayIndex,
      dayCount: t.itinerary.days.length,
    };
    void storyScript({ ...params, tripId: t.id }).then((fetched) => {
      if (!live) return;
      const chosen = fetched ?? fallbackScript(params);
      setScript(chosen);
      dispatch({ type: 'loaded', count: chosen.beats.length });
    });
    return () => {
      live = false;
      // Cleared here rather than at the top of the next run, so Close and a day change both drop
      // the old script before anything can render it.
      setScript(null);
      deviceSpeech.stop();
      filmAudio(false);
    };
  }, [active, dayIndex]);

  const beat = script && state.phase !== 'loading' ? script.beats[state.beat] : undefined;

  // **The clock.** One run per beat; its cleanup cancels the sentence, so Next, Prev, Pause and
  // Close never leave a voice talking over the next shot.
  useEffect(() => {
    if (!active || state.phase !== 'playing' || !beat) return;
    if (state.voiceBroken) {
      const timer = setTimeout(() => dispatch({ type: 'next' }), estimateDurationMs(beat.text));
      return () => clearTimeout(timer);
    }
    const handle = speakBeat(
      beat.text,
      { onEnd: () => dispatch({ type: 'next' }), onError: () => dispatch({ type: 'voiceError' }) },
      { speech: deviceSpeech, voice: voice.current },
    );
    return () => handle.cancel();
  }, [active, state.phase, state.beat, state.voiceBroken, beat]);

  // A film is watched: leaving the app pauses it, and resume says the beat again.
  useEffect(() => {
    if (!active) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') dispatch({ type: 'pause' });
    });
    return () => sub.remove();
  }, [active]);

  return {
    state,
    script,
    stop: filmStopFor(script, state),
    next: () => dispatch({ type: 'next' }),
    prev: () => dispatch({ type: 'prev' }),
    toggle: () => dispatch({ type: 'toggle' }),
  };
}
