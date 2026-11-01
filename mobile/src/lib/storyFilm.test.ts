import type { StoryScript } from '@shared/storyScript';

import type { Stop } from '@/api/types';
import { beatDurations } from '@shared/storyTimeline';

import { filmBeatTitle, filmCameraFor, filmElapsedMs, filmReducer, filmStopFor, initialFilm, type FilmState } from './storyFilm';

const at = (s: Partial<FilmState>): FilmState => ({ ...initialFilm, ...s });

describe('filmReducer', () => {
  it('starts playing at the first beat once the script lands', () => {
    expect(filmReducer(initialFilm, { type: 'loaded', count: 5 })).toEqual(at({ phase: 'playing', beat: 0, count: 5 }));
  });
  it('ends a script with no beats instead of playing nothing', () => {
    // Review Focus 4.
    expect(filmReducer(initialFilm, { type: 'loaded', count: 0 }).phase).toBe('ended');
  });
  it('next advances and plays, and past the last beat it ends', () => {
    expect(filmReducer(at({ phase: 'paused', beat: 1, count: 3 }), { type: 'next' })).toEqual(
      at({ phase: 'playing', beat: 2, count: 3 }),
    );
    expect(filmReducer(at({ phase: 'playing', beat: 2, count: 3 }), { type: 'next' }).phase).toBe('ended');
  });
  it('prev steps back and plays; from the end it returns to the last beat', () => {
    expect(filmReducer(at({ phase: 'playing', beat: 2, count: 3 }), { type: 'prev' }).beat).toBe(1);
    expect(filmReducer(at({ phase: 'playing', beat: 0, count: 3 }), { type: 'prev' }).beat).toBe(0);
    expect(filmReducer(at({ phase: 'ended', beat: 2, count: 3 }), { type: 'prev' })).toEqual(
      at({ phase: 'playing', beat: 2, count: 3 }),
    );
  });
  it('toggle pauses and resumes, and from the end it starts again', () => {
    expect(filmReducer(at({ phase: 'playing', count: 3 }), { type: 'toggle' }).phase).toBe('paused');
    expect(filmReducer(at({ phase: 'paused', count: 3 }), { type: 'toggle' }).phase).toBe('playing');
    expect(filmReducer(at({ phase: 'ended', beat: 2, count: 3 }), { type: 'toggle' })).toEqual(
      at({ phase: 'playing', beat: 0, count: 3 }),
    );
  });
  it('Again on a script with no beats stays ended rather than playing nothing', () => {
    expect(filmReducer(at({ phase: 'ended', count: 0 }), { type: 'toggle' }).phase).toBe('ended');
  });
  it('ignores the transport while the script is still being written', () => {
    for (const type of ['next', 'prev', 'toggle'] as const) {
      expect(filmReducer(initialFilm, { type })).toBe(initialFilm);
    }
  });
  it('pause only stops a playing film', () => {
    expect(filmReducer(at({ phase: 'playing', count: 3 }), { type: 'pause' }).phase).toBe('paused');
    expect(filmReducer(at({ phase: 'ended', count: 3 }), { type: 'pause' }).phase).toBe('ended');
  });
  it('holds a film that was backgrounded while its script was being written', () => {
    // Pressing Play and switching apps during "Writing the story…" must not start a voice in the
    // background when the script lands.
    const asked = filmReducer(initialFilm, { type: 'pause' });
    expect(asked.phase).toBe('loading');
    expect(filmReducer(asked, { type: 'loaded', count: 3 })).toMatchObject({ phase: 'paused', beat: 0, count: 3 });
    expect(filmReducer(filmReducer(asked, { type: 'reset' }), { type: 'loaded', count: 3 }).phase).toBe('playing');
  });

  it('latches a broken voice until the film is reset', () => {
    const broken = filmReducer(at({ phase: 'playing', count: 3 }), { type: 'voiceError' });
    expect(broken.voiceBroken).toBe(true);
    expect(filmReducer(broken, { type: 'next' }).voiceBroken).toBe(true);
    expect(filmReducer(broken, { type: 'reset' })).toEqual(initialFilm);
  });
});

describe('filmStopFor', () => {
  const script: StoryScript = {
    dayIndex: 0,
    source: 'model',
    beats: [
      { kind: 'opening', text: 'Morning.' },
      { kind: 'stop', stopIndex: 0, text: 'First.' },
      { kind: 'stop', stopIndex: 1, text: 'Second.' },
      { kind: 'closing', text: 'Night.' },
    ],
  };
  it('points at the stop a stop beat names', () => {
    expect(filmStopFor(script, at({ phase: 'playing', beat: 2, count: 4 }))).toBe(1);
  });
  it('frames the whole day for the opening, the closing, the end and while loading', () => {
    expect(filmStopFor(script, at({ phase: 'playing', beat: 0, count: 4 }))).toBeNull();
    expect(filmStopFor(script, at({ phase: 'playing', beat: 3, count: 4 }))).toBeNull();
    expect(filmStopFor(script, at({ phase: 'ended', beat: 3, count: 4 }))).toBeNull();
    expect(filmStopFor(null, initialFilm)).toBeNull();
  });
});

describe('filmCameraFor', () => {
  const stop = (name: string, lat: number, lng: number) => ({ name, lat, lng }) as Stop;
  const day = [stop('Castle', 38.7139, -9.1334), stop('Market', 38.7071, -9.1456), stop('Belem', 38.6916, -9.2160)];

  it('faces the next stop on arrival', () => {
    const camera = filmCameraFor(day, 0);
    expect(camera?.center).toEqual({ latitude: 38.7139, longitude: -9.1334 });
    // Market is south-west of the castle.
    expect(camera!.heading).toBeGreaterThan(180);
    expect(camera!.heading).toBeLessThan(270);
  });
  it('keeps facing the way it came at the last stop', () => {
    expect(Number.isFinite(filmCameraFor(day, 2)!.heading)).toBe(true);
  });
  it('faces north on a one-stop day rather than NaN', () => {
    // Review Focus 3.
    expect(filmCameraFor([day[0]], 0)!.heading).toBe(0);
  });
  it('holds the camera for a stop with no usable coordinates', () => {
    // Review Focus 2.
    expect(filmCameraFor([day[0], stop('Nowhere', 0, 0), day[2]], 1)).toBeNull();
    expect(filmCameraFor(day, 9)).toBeNull();
  });
});

describe('filmReducer · subtitles player', () => {
  it('seeks to a beat and plays it, clamped to the day, and not while the script is written', () => {
    const film = at({ phase: 'paused', beat: 1, count: 5 });
    expect(filmReducer(film, { type: 'seek', beat: 3 })).toEqual(at({ phase: 'playing', beat: 3, count: 5 }));
    expect(filmReducer(film, { type: 'seek', beat: 99 }).beat).toBe(4);
    expect(filmReducer(at({ phase: 'ended', beat: 4, count: 5 }), { type: 'seek', beat: 0 }).phase).toBe('playing');
    expect(filmReducer(initialFilm, { type: 'seek', beat: 2 })).toBe(initialFilm);
  });

  it('mutes and unmutes, and a muted film stays muted on the next day', () => {
    const muted = filmReducer(at({ phase: 'playing', count: 5 }), { type: 'mute' });
    expect(muted.muted).toBe(true);
    expect(filmReducer(muted, { type: 'reset' })).toEqual(at({ muted: true }));
    expect(filmReducer(muted, { type: 'mute' }).muted).toBe(false);
  });
});

describe('filmBeatTitle', () => {
  const stops = [{ name: 'Coffee in Alfama' }, { name: 'São Jorge Castle' }];
  it('names a stop by its place, the way between by where it goes, and the day at either end', () => {
    expect(filmBeatTitle({ kind: 'stop', stopIndex: 1, text: '' }, stops, 2)).toBe('São Jorge Castle');
    expect(filmBeatTitle({ kind: 'travel', legIndex: 0, text: '' }, stops, 2)).toBe('On to São Jorge Castle');
    expect(filmBeatTitle({ kind: 'travel', legIndex: 5, text: '' }, stops, 2)).toBe('On the way');
    expect(filmBeatTitle({ kind: 'opening', text: '' }, stops, 2)).toBe('Day 3');
    expect(filmBeatTitle({ kind: 'closing', text: '' }, stops, 2)).toBe('End of the day');
    expect(filmBeatTitle(undefined, stops, 2)).toBe('');
  });
});

describe('filmElapsedMs', () => {
  const beats = [{ text: 'One two three four.' }, { text: 'Five six. Seven eight.' }];
  const durations = beatDurations(beats);
  const total = durations[0] + durations[1];
  const start = { sentence: 0, spoken: 0 };
  it('is zero while the script loads and the whole film once it ends', () => {
    expect(filmElapsedMs(beats, at({ phase: 'loading' }), start)).toMatchObject({ elapsedMs: 0, totalMs: total, withinMs: 0 });
    expect(filmElapsedMs(beats, at({ phase: 'ended', beat: 1, count: 2 }), start).elapsedMs).toBe(total);
  });
  it('starts a beat where the beats before it end', () => {
    expect(filmElapsedMs(beats, at({ phase: 'playing', beat: 1, count: 2 }), start).elapsedMs).toBe(durations[0]);
  });
  it('places the voice within the beat by the words it has said', () => {
    const half = filmElapsedMs(beats, at({ phase: 'playing', beat: 0, count: 2 }), { sentence: 0, spoken: 2 }).elapsedMs;
    expect(half).toBeCloseTo(durations[0] / 2, 0);
  });
});
