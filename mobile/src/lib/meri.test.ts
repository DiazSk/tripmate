import type { StoryScript } from '@shared/storyScript';

import { filmSubtitle, filmTitle, meriForChat, meriForFilm, meridianMotion, type MeridianState } from './meri';
import { initialFilm, type FilmState } from './storyFilm';

const film = (s: Partial<FilmState>): FilmState => ({ ...initialFilm, ...s });
const ALL: MeridianState[] = ['idle', 'thinking', 'streaming', 'speaking', 'paused', 'success', 'error', 'offline'];

describe('meridianMotion', () => {
  it('breathes slowly and blinks when idle', () => {
    expect(meridianMotion('idle', false)).toEqual({ breatheMs: 3200, blink: true, driftMs: null, squash: false, lift: false, eyes: 1, glance: 'around', squint: false, bob: true });
  });
  it('breathes faster while thinking', () => {
    expect(meridianMotion('thinking', false)).toMatchObject({ breatheMs: 1400, glance: 'up', bob: true });
  });
  it('lets the eyes drift while streaming', () => {
    expect(meridianMotion('streaming', false)).toMatchObject({ driftMs: 2400, glance: null, bob: true });
  });
  it('squashes instead of breathing while speaking', () => {
    expect(meridianMotion('speaking', false)).toMatchObject({ squash: true, breatheMs: null, blink: true, glance: null, bob: false });
  });
  it('rests with relaxed eyes when paused', () => {
    expect(meridianMotion('paused', false)).toEqual({ breatheMs: null, blink: false, driftMs: null, squash: false, lift: false, eyes: 0.8, glance: null, squint: false, bob: false });
  });
  it('lifts once on success, then breathes', () => {
    expect(meridianMotion('success', false)).toMatchObject({ lift: true, breatheMs: 3200, squint: true, bob: false });
  });
  it('holds completely still on error and offline', () => {
    for (const s of ['error', 'offline'] as const) {
      expect(meridianMotion(s, false)).toEqual({ breatheMs: null, blink: false, driftMs: null, squash: false, lift: false, eyes: 1, glance: null, squint: false, bob: false });
    }
  });
  it('is completely still in every state under Reduce Motion', () => {
    for (const s of ALL) {
      expect(meridianMotion(s, true)).toMatchObject({ breatheMs: null, blink: false, driftMs: null, squash: false, lift: false, glance: null, squint: false, bob: false });
    }
  });
});

describe('meriForFilm', () => {
  it('thinks while the story is being written', () => {
    expect(meriForFilm(film({ phase: 'loading' }))).toBe('thinking');
  });
  it('speaks while playing and rests while paused', () => {
    expect(meriForFilm(film({ phase: 'playing', count: 3 }))).toBe('speaking');
    expect(meriForFilm(film({ phase: 'paused', count: 3 }))).toBe('paused');
  });
  it('shows an error when the voice has failed, playing or paused', () => {
    expect(meriForFilm(film({ phase: 'playing', count: 3, voiceBroken: true }))).toBe('error');
    expect(meriForFilm(film({ phase: 'paused', count: 3, voiceBroken: true }))).toBe('error');
  });
  it('the end of a day is a success even if the voice failed along the way', () => {
    // Review Focus 3.
    expect(meriForFilm(film({ phase: 'ended', count: 3, voiceBroken: true }))).toBe('success');
  });
});

describe('meriForChat', () => {
  it('thinks while a reply is pending', () => {
    expect(meriForChat({ replying: true, failure: null, justReplied: false })).toBe('thinking');
  });
  it('a failed turn outranks a just-landed reply', () => {
    // Review Focus 5.
    expect(meriForChat({ replying: false, failure: 'No connection', justReplied: true })).toBe('error');
  });
  it('lifts once when a reply lands, otherwise idles', () => {
    expect(meriForChat({ replying: false, failure: null, justReplied: true })).toBe('success');
    expect(meriForChat({ replying: false, failure: null, justReplied: false })).toBe('idle');
  });
});

describe('filmTitle', () => {
  it("uses the day's own title", () => {
    expect(filmTitle({ title: 'A walk through Alfama' }, 'Lisbon, Portugal')).toBe('A walk through Alfama');
  });
  it('falls back to the city, cut at the first comma', () => {
    expect(filmTitle({}, 'Lisbon, Portugal')).toBe('A day in Lisbon');
    expect(filmTitle(undefined, 'Kyoto')).toBe('A day in Kyoto');
  });
  it('never shows a blank title', () => {
    // Review Focus 4.
    expect(filmTitle({ title: '   ' }, 'Lisbon, Portugal')).toBe('A day in Lisbon');
  });
});

describe('filmSubtitle', () => {
  const script = (source: 'model' | 'fallback'): StoryScript => ({ dayIndex: 0, source, beats: [{ kind: 'opening', text: 'Hi.' }] });
  it('says when the story was read from the plan', () => {
    expect(filmSubtitle(script('fallback'), film({ phase: 'playing', count: 1 }))).toBe('Read from your plan');
  });
  it('a broken voice wins over the fallback note', () => {
    expect(filmSubtitle(script('fallback'), film({ phase: 'playing', count: 1, voiceBroken: true }))).toBe('Voice unavailable');
  });
  it('says nothing when everything is as it should be', () => {
    expect(filmSubtitle(script('model'), film({ phase: 'playing', count: 1 }))).toBeNull();
    expect(filmSubtitle(null, initialFilm)).toBeNull();
  });
});
