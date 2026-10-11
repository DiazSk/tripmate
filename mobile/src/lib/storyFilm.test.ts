import type { StoryScript } from '@shared/storyScript';

import type { Stop } from '@/api/types';
import { filmCameraFor, filmReducer, filmStopFor, initialFilm, type FilmState } from './storyFilm';

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
