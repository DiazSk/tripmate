import type { StoryScript } from '@shared/storyScript';
import { beatDurations } from '@shared/storyTimeline';

import { artworkNameFor, artworkUrlOf, commandAction, nowPlayingFor, scriptIsForDay, staysOnInBackground } from './nowPlaying';
import { initialFilm, type FilmState } from './storyFilm';

const at = (s: Partial<FilmState>): FilmState => ({ ...initialFilm, ...s });
const stops = [{ name: 'Coffee in Alfama' }, { name: 'São Jorge Castle' }];
const script: StoryScript = {
  dayIndex: 2,
  source: 'model',
  beats: [
    { kind: 'opening', text: 'Morning in the old town.' },
    { kind: 'stop', stopIndex: 1, text: 'The castle above it all.' },
    { kind: 'travel', legIndex: 0, text: 'Downhill on foot.' },
    { kind: 'closing', text: 'Night.' },
  ],
};
const base = { script, stops, day: undefined, dayIndex: 2, destination: 'Lisbon, Portugal', at: { sentence: 0, spoken: 0 }, artworkUrl: null };

describe('nowPlayingFor', () => {
  // Each stop is its own track, the way each song is in Music: Next then plainly means the next
  // stop, and a stop changing looks like a track changing — new title, new art, the scrubber at 0:00.
  const day: StoryScript = {
    dayIndex: 2,
    source: 'model',
    beats: [
      { kind: 'opening', text: 'Morning in the old town.' },
      { kind: 'stop', stopIndex: 0, text: 'Coffee first.' },
      { kind: 'stop', stopIndex: 1, text: 'Five six seven eight.' },
      { kind: 'closing', text: 'Night falls.' },
    ],
  };
  const film = { ...base, script: day };
  const durations = beatDurations(day.beats);

  it('names a stop as the track, and says which stop of the day it is', () => {
    const info = nowPlayingFor({ ...film, state: at({ phase: 'playing', beat: 2, count: 4 }), at: { sentence: 1, spoken: 0 } });
    expect(info.title).toBe('São Jorge Castle');
    expect(info.artist).toBe('Stop 2 of 2 · A day in Lisbon');
    expect(info.album).toBe('Lisbon, Portugal');
    expect(info.trackIndex).toBe(3);
    expect(info.trackCount).toBe(4);
    expect(info.playing).toBe(true);
  });
  it("runs the scrubber over the stop's own length, starting it again at every stop", () => {
    const info = nowPlayingFor({ ...film, state: at({ phase: 'playing', beat: 2, count: 4 }) });
    expect(info.durationMs).toBe(durations[2]);
    expect(info.elapsedMs).toBe(0);
    const half = nowPlayingFor({ ...film, state: at({ phase: 'playing', beat: 2, count: 4 }), at: { sentence: 0, spoken: 2 } });
    expect(half.elapsedMs).toBeCloseTo(durations[2] / 2, 0);
  });
  it('announces a stop on its first sentence, then settles, so arriving reads as a change on the island', () => {
    const arriving = nowPlayingFor({ ...film, state: at({ phase: 'playing', beat: 1, count: 4 }), at: { sentence: 0, spoken: 1 } });
    expect(arriving.artist).toBe('Now arriving · Stop 1 of 2');
    const settled = nowPlayingFor({ ...film, state: at({ phase: 'playing', beat: 1, count: 4 }), at: { sentence: 1, spoken: 0 } });
    expect(settled.artist).toBe('Stop 1 of 2 · A day in Lisbon');
  });
  it('does not announce an arrival on a paused film', () => {
    const paused = nowPlayingFor({ ...film, state: at({ phase: 'paused', beat: 1, count: 4 }), at: { sentence: 0, spoken: 1 } });
    expect(paused.artist).toBe('Stop 1 of 2 · A day in Lisbon');
  });
  it('calls the opening by the film and counts the stops ahead', () => {
    const info = nowPlayingFor({ ...film, state: at({ phase: 'playing', beat: 0, count: 4 }) });
    expect(info.title).toBe('A day in Lisbon');
    expect(info.artist).toBe('Day 3 · 2 stops');
  });
  it('names the close and shows the last track finished once the film ends', () => {
    const closing = nowPlayingFor({ ...film, state: at({ phase: 'playing', beat: 3, count: 4 }) });
    expect(closing.title).toBe('End of the day');
    expect(closing.artist).toBe('Day 3 · A day in Lisbon');
    const ended = nowPlayingFor({ ...film, state: at({ phase: 'ended', beat: 3, count: 4 }) });
    expect(ended.elapsedMs).toBe(ended.durationMs);
    expect(ended.playing).toBe(false);
  });
  it('is not playing when paused', () => {
    expect(nowPlayingFor({ ...film, state: at({ phase: 'paused', beat: 1, count: 4 }) }).playing).toBe(false);
  });
  it('falls back to the film title when a stop has no name', () => {
    const nameless: StoryScript = { ...script, beats: [{ kind: 'stop', stopIndex: 9, text: 'Somewhere.' }] };
    expect(nowPlayingFor({ ...base, script: nameless, state: at({ phase: 'playing', beat: 0, count: 1 }) }).title).toBe('A day in Lisbon');
  });
});

describe('artworkNameFor', () => {
  it("is the stop's own photo on a stop beat and the destination's otherwise", () => {
    expect(artworkNameFor(script.beats[1], stops, 'Lisbon, Portugal')).toBe('São Jorge Castle');
    expect(artworkNameFor(script.beats[0], stops, 'Lisbon, Portugal')).toBe('Lisbon, Portugal');
    expect(artworkNameFor(script.beats[2], stops, 'Lisbon, Portugal')).toBe('Lisbon, Portugal');
    expect(artworkNameFor(script.beats[3], stops, 'Lisbon, Portugal')).toBe('Lisbon, Portugal');
  });
});

describe('staysOnInBackground', () => {
  it('keeps only a playing, audible film going, and only where Now Playing exists', () => {
    expect(staysOnInBackground(at({ phase: 'playing' }), true)).toBe(true);
    // Review Focus 3: nothing to hear, so nothing should keep the phone awake.
    expect(staysOnInBackground(at({ phase: 'playing', muted: true }), true)).toBe(false);
    expect(staysOnInBackground(at({ phase: 'playing', voiceBroken: true }), true)).toBe(false);
    expect(staysOnInBackground(at({ phase: 'paused' }), true)).toBe(false);
    expect(staysOnInBackground(at({ phase: 'loading' }), true)).toBe(false);
    expect(staysOnInBackground(at({ phase: 'playing' }), false)).toBe(false);
  });
});

describe('commandAction', () => {
  it('maps play to resuming a paused film or replaying an ended one, and ignores it while playing', () => {
    expect(commandAction('play', 'paused')).toBe('toggle');
    expect(commandAction('play', 'ended')).toBe('toggle');
    expect(commandAction('play', 'playing')).toBeNull();
  });
  it('pauses only a playing film, so an interruption after the end does nothing', () => {
    // Review Focus 1 and 2: interruptions and lost headphones arrive as `pause`.
    expect(commandAction('pause', 'playing')).toBe('pause');
    expect(commandAction('pause', 'paused')).toBeNull();
    expect(commandAction('pause', 'ended')).toBeNull();
  });
  it('passes toggle, next and previous through, and ignores everything while loading', () => {
    expect(commandAction('toggle', 'paused')).toBe('toggle');
    expect(commandAction('next', 'playing')).toBe('next');
    expect(commandAction('previous', 'playing')).toBe('prev');
    expect(commandAction('toggle', 'loading')).toBeNull();
    expect(commandAction('next', 'loading')).toBeNull();
  });
});

describe('artworkUrlOf', () => {
  it('prefers the thumbnail: a full-size photo is a 40MB bitmap in the background, and a download per beat', () => {
    expect(artworkUrlOf({ thumbnailUrl: 'https://t/x.jpg', imageUrl: 'https://i/x.jpg', extract: null })).toBe('https://t/x.jpg');
    expect(artworkUrlOf({ thumbnailUrl: null, imageUrl: 'https://i/x.jpg', extract: null })).toBe('https://i/x.jpg');
    expect(artworkUrlOf({ thumbnailUrl: null, imageUrl: null, extract: null })).toBeNull();
    expect(artworkUrlOf(undefined)).toBeNull();
  });
});

describe('scriptIsForDay', () => {
  it("refuses the last day's script while the next day's loads, so the player never shows it under the new day", () => {
    expect(scriptIsForDay(script, 2)).toBe(true);
    expect(scriptIsForDay(script, 3)).toBe(false);
  });
});
