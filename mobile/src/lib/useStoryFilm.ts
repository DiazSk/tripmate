import { fallbackScript, type StoryScript } from '@shared/storyScript';
import { useEffect, useReducer, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import { placePhotoFor } from '@/api/placePhotos';
import { storyScript } from '@/api/tripMateApi';
import type { Trip } from '@/api/types';
import { resumeStart, silentSpeech, speakBeat } from '@/lib/narrator';
import { deviceSpeech, filmAudio, narratorVoice } from '@/lib/narratorEngine';
import { artworkNameFor, artworkUrlOf, commandAction, nowPlayingFor, scriptIsForDay, staysOnInBackground, type NowPlayingInfo } from '@/lib/nowPlaying';
import { filmReducer, filmStopFor, initialFilm, type FilmState } from '@/lib/storyFilm';

import { filmNowPlaying } from '../../modules/film-now-playing';

type Place = { beat: number; sentence: number; words: number };

/** The film as the Now Playing player shows it, from where the voice is and the latest artwork. */
function nowPlayingAt(trip: Trip, dayIndex: number, script: StoryScript, state: FilmState, place: Place, artworkUrl: string | null): NowPlayingInfo {
  const day = trip.itinerary.days[dayIndex];
  return nowPlayingFor({
    script,
    state,
    stops: day?.stops ?? [],
    day,
    dayIndex,
    destination: trip.destination,
    // A new beat runs before the clock has moved `place` onto it: it starts at its first word.
    at: place.beat === state.beat ? { sentence: place.sentence, spoken: place.words } : { sentence: 0, spoken: 0 },
    artworkUrl,
  });
}

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
  /** Words spoken so far, for Meri's speaking pulse. A shared value, not state: at two or three
   *  words a second, state would re-render the whole trip screen while the camera is flying. */
  const words = useSharedValue(0);
  /** The subtitle's place: which sentence of the beat is being said, and how many of its words
   *  have been. Shared values for the same reason as `words`; the subtitle reads them itself. */
  const sentence = useSharedValue(0);
  const spoken = useSharedValue(0);
  const voice = useRef<string | undefined>(undefined);
  /** Where the voice is: which beat, which sentence, how many of its words were heard. A pause, a
   *  mute or the voice failing re-runs the clock on the same beat, and it resumes here rather than
   *  from the beat's first word. Only what means "from the top" clears it (`fromTheTop`). */
  const place = useRef({ beat: -1, sentence: 0, words: 0 });
  /** Whether the Now Playing player is up: the first publish starts it, later ones update it. */
  const published = useRef(false);
  /** The latest artwork. Kept across a beat change until the next photograph lands, so the Lock
   *  Screen's art changes rather than blanking at every beat; cleared when the film closes. */
  const art = useRef<string | null>(null);
  /** Bumped when the app comes back to a film: the map flies to the current stop again. */
  const [cameraEpoch, setCameraEpoch] = useState(0);
  const fromTheTop = () => {
    place.current = { beat: -1, sentence: 0, words: 0 };
  };
  // Read inside the fetch rather than depended on: a refreshed trip object mid-film must not
  // restart it.
  const tripRef = useRef(trip);
  /** The film as the remote commands and the background policy see it: they are subscribed once
   *  per film, so they read the latest state here rather than the state they were made with. */
  const stateRef = useRef(state);
  useEffect(() => {
    tripRef.current = trip;
    stateRef.current = state;
  });

  useEffect(() => {
    if (!active) return;
    let live = true;
    fromTheTop();
    dispatch({ type: 'reset' });
    const t = tripRef.current;
    const params = {
      destination: t.destination,
      day: t.itinerary.days[dayIndex],
      dayIndex,
      dayCount: t.itinerary.days.length,
    };
    // The voice is picked before the first beat, not raced against the script: a fast offline
    // fallback used to start in the system voice and switch to the Enhanced one a beat later.
    void Promise.all([narratorVoice(), storyScript({ ...params, tripId: t.id })]).then(([picked, fetched]) => {
      if (!live) return;
      voice.current = picked;
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
      filmNowPlaying.stop();
      published.current = false;
      art.current = null;
      filmAudio(false);
    };
  }, [active, dayIndex]);

  const beat = script && state.phase !== 'loading' ? script.beats[state.beat] : undefined;

  /** A film that can be heard. A muted one, or one whose voice failed, is not an audio player: it
   *  leaves the Lock Screen, and somebody's music, alone. */
  const audible = !state.muted && !state.voiceBroken;

  // Other audio is ducked only while the narrator can actually speak — not through a pause or
  // the end screen. The fetch effect's cleanup restores mixing when the film closes. As a Now
  // Playing player (iOS) the film holds the session through a pause too, as a music app does: a
  // mixable session loses the Lock Screen.
  useEffect(() => {
    // Nor while muted: a silent film has no reason to quiet somebody's music.
    if (active) filmAudio(audible && (filmNowPlaying.available || state.phase === 'playing'));
  }, [active, state.phase, audible]);

  // **The Now Playing player.** The beat is the track and the day the artist; it is republished on
  // every change of beat or phase, and goes away for a film that cannot be heard.
  useEffect(() => {
    if (!filmNowPlaying.available || !active || !script || state.phase === 'loading' || !scriptIsForDay(script, dayIndex)) return;
    if (!audible) {
      if (published.current) filmNowPlaying.stop();
      published.current = false;
      return;
    }
    const info = nowPlayingAt(tripRef.current, dayIndex, script, state, place.current, art.current);
    if (published.current) filmNowPlaying.update(info);
    else filmNowPlaying.start(info);
    published.current = true;
  }, [active, script, state, audible, dayIndex]);

  // The artwork: the stop's photograph, or the destination's, looked up once per beat and attached
  // when it lands, unless the film has moved on by then.
  useEffect(() => {
    if (!filmNowPlaying.available || !active || !script) return;
    let live = true;
    const beatIndex = state.beat;
    const t = tripRef.current;
    const stops = t.itinerary.days[dayIndex]?.stops ?? [];
    const name = artworkNameFor(script.beats[beatIndex], stops, t.destination);
    // A stop with no photograph shows the destination's, never the previous stop's under its name.
    void placePhotoFor(name)
      .then(async (photo) => artworkUrlOf(photo) ?? (name === t.destination ? null : artworkUrlOf(await placePhotoFor(t.destination))))
      .then((url) => {
        if (!live || !url || url === art.current) return;
        art.current = url;
        const now = stateRef.current;
        if (published.current && now.beat === beatIndex) filmNowPlaying.update(nowPlayingAt(t, dayIndex, script, now, place.current, art.current));
      });
    return () => {
      live = false;
    };
  }, [active, script, state.beat, dayIndex]);

  // Its buttons, and what iOS treats as buttons: the same actions as the panel's.
  useEffect(() => {
    if (!active || !filmNowPlaying.available) return;
    const sub = filmNowPlaying.onCommand((command) => {
      const action = commandAction(command, stateRef.current.phase);
      if (action === 'prev' || (action === 'toggle' && stateRef.current.phase === 'ended')) fromTheTop();
      if (action) dispatch({ type: action });
    });
    return () => sub.remove();
  }, [active]);

  // **The clock.** One run per beat; its cleanup cancels the sentence, so Next, Prev, Pause and
  // Close never leave a voice talking over the next shot.
  // Muted, or with a voice that failed, the beat is "said" by a silent voice at the narrator's pace,
  // so the subtitle still moves sentence by sentence and word by word.
  useEffect(() => {
    if (!active || state.phase !== 'playing' || !beat) return;
    // The same beat again means a resume (play after pause, a mute, the voice failing); a new beat
    // starts at its first word.
    const resume = place.current.beat === state.beat ? { sentence: place.current.sentence, words: place.current.words } : undefined;
    // The subtitle goes where the voice will re-enter before it does, so the caption never shows the
    // sentence unlit and the clock (read off the lit words) never drops back for a moment.
    const start = resumeStart(beat.text, resume);
    place.current = { beat: state.beat, sentence: start.sentence, words: start.skip };
    sentence.value = start.sentence;
    spoken.value = start.skip;
    const silent = state.voiceBroken || state.muted;
    const handle = speakBeat(
      beat.text,
      {
        onEnd: () => dispatch({ type: 'next' }),
        onError: () => dispatch({ type: 'voiceError' }),
        onWord: () => {
          words.value += 1;
          spoken.value += 1;
          place.current.words += 1;
        },
        onSentence: (index, _count, startWord) => {
          sentence.value = index;
          spoken.value = startWord;
          place.current = { beat: state.beat, sentence: index, words: startWord };
          // Re-anchors the Lock Screen's scrubber on each sentence; iOS runs it on between.
          if (published.current && script) {
            filmNowPlaying.update(nowPlayingAt(tripRef.current, dayIndex, script, stateRef.current, place.current, art.current));
          }
        },
      },
      { ...(silent ? { speech: silentSpeech() } : { speech: deviceSpeech, voice: voice.current }), from: resume },
    );
    return () => handle.cancel();
  }, [active, state.phase, state.beat, state.voiceBroken, state.muted, beat, words, sentence, spoken, script, dayIndex]);

  // A film is watched: leaving the app (or pulling down Notification Center) pauses it, and Play
  // picks the beat up at the word it was on. Where it is a Now Playing player and can be heard, it
  // is listened to instead, and keeps going.
  useEffect(() => {
    if (!active) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') setCameraEpoch((e) => e + 1);
      else if (!staysOnInBackground(stateRef.current, filmNowPlaying.available)) dispatch({ type: 'pause' });
    });
    return () => sub.remove();
  }, [active]);

  return {
    state,
    script,
    stop: filmStopFor(script, state),
    cameraEpoch,
    words,
    sentence,
    spoken,
    next: () => dispatch({ type: 'next' }),
    // A chapter tap, Previous and a replay mean "from the top", even onto the beat already playing.
    seek: (beatIndex: number) => {
      fromTheTop();
      dispatch({ type: 'seek', beat: beatIndex });
    },
    mute: () => dispatch({ type: 'mute' }),
    prev: () => {
      fromTheTop();
      dispatch({ type: 'prev' });
    },
    toggle: () => {
      if (state.phase === 'ended') fromTheTop();
      dispatch({ type: 'toggle' });
    },
  };
}
