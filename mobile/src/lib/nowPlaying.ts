import type { StoryBeat, StoryScript } from '@shared/storyScript';

import type { PlacePhoto } from '@/api/types';

import { filmTitle } from '@/lib/meri';
import { filmBeatTitle, filmElapsedMs, type FilmPhase, type FilmState } from '@/lib/storyFilm';

/**
 * The story film as iOS's Now Playing player sees it: **each stop is a track**, as each song is in
 * Music. So Next plainly means the next stop, and a stop changing looks like a track changing — a new
 * title and photograph, and the scrubber back at 0:00 — rather than a long track that never says it
 * moved on. The artist line says where in the day it is ("Stop 2 of 5 · A day in Lisbon"). iOS draws the Dynamic Island and the
 * Lock Screen player from this (`modules/film-now-playing`); everything here is pure, so what the
 * player says is tested rather than looked at.
 */
export type NowPlayingInfo = {
  title: string;
  artist: string;
  album: string;
  artworkUrl: string | null;
  /** This stop's estimated length and how far into it the voice is. */
  durationMs: number;
  elapsedMs: number;
  playing: boolean;
  /** The beat as a track, 1-based, of the day's beats: the queue position iOS keeps. */
  trackIndex: number;
  trackCount: number;
};

/** A button on the Lock Screen or the island, or something iOS treats as one (a call, lost headphones). */
export type FilmCommand = 'play' | 'pause' | 'toggle' | 'next' | 'previous';

export function nowPlayingFor(args: {
  script: StoryScript;
  state: FilmState;
  stops: { name: string }[];
  day: { title?: string } | undefined;
  dayIndex: number;
  destination: string;
  at: { sentence: number; spoken: number };
  artworkUrl: string | null;
}): NowPlayingInfo {
  const { script, state, stops, day, dayIndex, destination, at, artworkUrl } = args;
  const film = filmTitle(day, destination);
  const dayName = `Day ${dayIndex + 1}`;
  const beat = script.beats[state.beat];
  const stopCount = script.beats.filter((b) => b.kind === 'stop').length;
  const { withinMs, beatMs } = filmElapsedMs(script.beats, state, at);
  let title = filmBeatTitle(beat, stops, dayIndex) || film;
  let artist = `${dayName} · ${film}`;
  if (beat?.kind === 'stop') {
    const ordinal = script.beats.slice(0, state.beat + 1).filter((b) => b.kind === 'stop').length;
    // iOS draws this player and animates nothing in it but a cross-fade, so the arrival is told in two
    // steps: "Now arriving" while the first sentence names the place, then the day's line. Two changes
    // at every stop read as a stop changing; one reads as a word that happened to differ.
    artist =
      state.phase === 'playing' && at.sentence === 0
        ? `Now arriving · Stop ${ordinal} of ${stopCount}`
        : `Stop ${ordinal} of ${stopCount} · ${film}`;
  } else if (beat?.kind === 'opening') {
    title = film;
    artist = `${dayName} · ${stopCount} ${stopCount === 1 ? 'stop' : 'stops'}`;
  }
  return {
    title,
    artist,
    album: destination,
    artworkUrl,
    durationMs: beatMs,
    elapsedMs: withinMs,
    playing: state.phase === 'playing',
    trackIndex: Math.min(state.beat + 1, script.beats.length),
    trackCount: script.beats.length,
  };
}

/** The place whose photograph is the artwork: the stop on a stop beat, the destination otherwise. */
export function artworkNameFor(beat: StoryBeat | undefined, stops: { name: string }[], destination: string): string {
  const stop = beat?.kind === 'stop' && typeof beat.stopIndex === 'number' ? stops[beat.stopIndex]?.name : undefined;
  return stop || destination;
}

/** The artwork's address: the thumbnail first. The full-size photograph is a bitmap of tens of MB,
 *  decoded while the app is in the background (where iOS kills at less memory), and too large for
 *  the URL cache to keep, so it would be downloaded again on every beat that shows it. */
export function artworkUrlOf(photo: PlacePhoto | undefined): string | null {
  return photo?.thumbnailUrl ?? photo?.imageUrl ?? null;
}

/** Whether a script is the day's own. A day change keeps the last day's script (and its ended state)
 *  for a render; publishing it would show the old day's last beat under the new day's name. */
export function scriptIsForDay(script: StoryScript, dayIndex: number): boolean {
  return script.dayIndex === dayIndex;
}

/**
 * Whether leaving the app keeps the film going. Only an audible, playing film, and only where the
 * Now Playing player exists (iOS): a muted film or a broken voice has nothing to hear, and nothing
 * should keep the phone awake for it.
 */
export function staysOnInBackground(state: FilmState, nowPlayingAvailable: boolean): boolean {
  return nowPlayingAvailable && state.phase === 'playing' && !state.muted && !state.voiceBroken;
}

/** What a command does to the film, or null when it should do nothing. */
export function commandAction(command: FilmCommand, phase: FilmPhase): 'toggle' | 'pause' | 'next' | 'prev' | null {
  if (phase === 'loading') return null;
  switch (command) {
    case 'play':
      return phase === 'playing' ? null : 'toggle';
    case 'pause':
      return phase === 'playing' ? 'pause' : null;
    case 'toggle':
      return 'toggle';
    case 'next':
      return 'next';
    case 'previous':
      return 'prev';
  }
}
