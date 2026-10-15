import { estimateDurationMs, LEAD_IN_MS } from '@shared/storyPacing';

import { pickNarrator, silentSpeech, speakBeat, START_GUARD_MS, type SpeakOptions, type SpeechLike } from './narrator';

function fakeSpeech() {
  const calls: { text: string; options: SpeakOptions }[] = [];
  const speech: SpeechLike & { stopped: number } = {
    stopped: 0,
    speak: (text, options) => {
      calls.push({ text, options });
    },
    stop() {
      speech.stopped += 1;
    },
  };
  return { speech, calls };
}

const BEAT = 'Here is the castle. It is old. Go now.';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('speakBeat', () => {
  it('speaks each sentence after its pause, the last one slower, then ends once', () => {
    const { speech, calls } = fakeSpeech();
    const onEnd = jest.fn();
    speakBeat(BEAT, { onEnd, onError: jest.fn() }, { speech });

    jest.advanceTimersByTime(LEAD_IN_MS);
    expect(calls.map((c) => c.text)).toEqual(['Here is the castle.']);
    calls[0].options.onStart?.();
    calls[0].options.onDone?.();

    jest.advanceTimersByTime(699);
    expect(calls).toHaveLength(1);
    jest.advanceTimersByTime(1);
    expect(calls[1].text).toBe('It is old.');
    calls[1].options.onStart?.();
    calls[1].options.onDone?.();

    jest.advanceTimersByTime(420);
    expect(calls[2].text).toBe('Go now.');
    expect(calls[2].options.rate).toBe(0.88);
    expect(calls[0].options.rate).toBe(0.92);
    calls[2].options.onDone?.();
    calls[2].options.onDone?.();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('a cancelled beat stops the voice and reports nothing, whatever the engine fires after', () => {
    const { speech, calls } = fakeSpeech();
    const onEnd = jest.fn();
    const onError = jest.fn();
    const handle = speakBeat(BEAT, { onEnd, onError }, { speech });
    jest.advanceTimersByTime(LEAD_IN_MS);
    calls[0].options.onStart?.();

    handle.cancel();
    calls[0].options.onStopped?.();
    calls[0].options.onDone?.();
    jest.advanceTimersByTime(60_000);

    expect(speech.stopped).toBe(1);
    expect(calls).toHaveLength(1);
    expect(onEnd).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('moves on when a started sentence never reports done', () => {
    const { speech, calls } = fakeSpeech();
    speakBeat(BEAT, { onEnd: jest.fn(), onError: jest.fn() }, { speech });
    jest.advanceTimersByTime(LEAD_IN_MS);
    calls[0].options.onStart?.();

    const watchdog = estimateDurationMs('Here is the castle.') * 2.5 + 4000;
    jest.advanceTimersByTime(watchdog - 1);
    expect(calls).toHaveLength(1);
    jest.advanceTimersByTime(1 + 700);
    expect(calls[1].text).toBe('It is old.');
  });

  it('reports a voice that never starts, once, and speaks nothing more', () => {
    const { speech, calls } = fakeSpeech();
    const onError = jest.fn();
    const onEnd = jest.fn();
    speakBeat(BEAT, { onEnd, onError }, { speech });
    jest.advanceTimersByTime(LEAD_IN_MS + START_GUARD_MS);

    expect(onError).toHaveBeenCalledTimes(1);
    calls[0].options.onDone?.();
    jest.advanceTimersByTime(60_000);
    expect(calls).toHaveLength(1);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('silences a voice that starts after the guard gave up on it', () => {
    // A slow first utterance (an older phone, an Enhanced voice) that begins at 2.3s must not read
    // over a film that has already switched to text.
    const { speech, calls } = fakeSpeech();
    speakBeat(BEAT, { onEnd: jest.fn(), onError: jest.fn() }, { speech });
    jest.advanceTimersByTime(LEAD_IN_MS + START_GUARD_MS);
    calls[0].options.onStart?.();
    expect(speech.stopped).toBe(1);
  });

  it('passes an engine error up once', () => {
    const { speech, calls } = fakeSpeech();
    const onError = jest.fn();
    speakBeat(BEAT, { onEnd: jest.fn(), onError }, { speech });
    jest.advanceTimersByTime(LEAD_IN_MS);
    calls[0].options.onError?.(new Error('engine'));
    calls[0].options.onError?.(new Error('engine'));
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('ends a beat with no words instead of holding the film on it', () => {
    // Review Focus 1: a malformed script line must not freeze the film.
    const { speech, calls } = fakeSpeech();
    const onEnd = jest.fn();
    speakBeat('   ', { onEnd, onError: jest.fn() }, { speech });
    jest.advanceTimersByTime(LEAD_IN_MS);
    expect(calls).toHaveLength(0);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('speaks in the voice it was given', () => {
    const { speech, calls } = fakeSpeech();
    speakBeat(BEAT, { onEnd: jest.fn(), onError: jest.fn() }, { speech, voice: 'com.apple.voice.enhanced.en-GB.Serena' });
    jest.advanceTimersByTime(LEAD_IN_MS);
    expect(calls[0].options.voice).toBe('com.apple.voice.enhanced.en-GB.Serena');
  });
  it('reports each spoken word', () => {
    const { speech, calls } = fakeSpeech();
    const onWord = jest.fn();
    speakBeat(BEAT, { onEnd: jest.fn(), onError: jest.fn(), onWord }, { speech });
    jest.advanceTimersByTime(LEAD_IN_MS);
    calls[0].options.onStart?.();
    calls[0].options.onBoundary?.();
    calls[0].options.onBoundary?.();
    expect(onWord).toHaveBeenCalledTimes(2);
  });

  it('reports no words after a cancel', () => {
    // Review Focus 2: a stale word event must not pulse Meri.
    const { speech, calls } = fakeSpeech();
    const onWord = jest.fn();
    const handle = speakBeat(BEAT, { onEnd: jest.fn(), onError: jest.fn(), onWord }, { speech });
    jest.advanceTimersByTime(LEAD_IN_MS);
    handle.cancel();
    calls[0].options.onBoundary?.();
    expect(onWord).not.toHaveBeenCalled();
  });
});

describe('pickNarrator', () => {
  const v = (identifier: string, name: string, language: string, quality = 'Default') => ({
    identifier,
    name,
    language,
    quality,
  });

  it('prefers an Enhanced English voice over a Default one', () => {
    expect(pickNarrator([v('a', 'Samantha', 'en-US'), v('b', 'Ava', 'en-US', 'Enhanced')], 'en-US')).toBe('b');
  });
  it("prefers the phone's own English among equals", () => {
    expect(pickNarrator([v('us', 'Samantha', 'en-US'), v('gb', 'Daniel', 'en-GB')], 'en-GB')).toBe('gb');
  });
  it('never picks a novelty voice', () => {
    expect(pickNarrator([v('x', 'Bad News', 'en-US', 'Enhanced'), v('y', 'Samantha', 'en-US')], 'en-US')).toBe('y');
  });
  it('leaves it to the system when nothing speaks English', () => {
    expect(pickNarrator([v('fr', 'Thomas', 'fr-FR')], 'fr-FR')).toBeUndefined();
  });
});

describe('subtitles', () => {
  it('reports each sentence as it begins, so the subtitle shows one at a time', () => {
    const { speech, calls } = fakeSpeech();
    const onSentence = jest.fn();
    speakBeat(BEAT, { onEnd: jest.fn(), onError: jest.fn(), onSentence }, { speech });
    jest.advanceTimersByTime(LEAD_IN_MS);
    expect(onSentence).toHaveBeenLastCalledWith(0, 3);
    calls[0].options.onStart?.();
    calls[0].options.onDone?.();
    jest.advanceTimersByTime(700);
    expect(onSentence).toHaveBeenLastCalledWith(1, 3);
  });

  it('the silent voice keeps the narrator\'s pace: words across each sentence, then the end', () => {
    const onEnd = jest.fn();
    const onWord = jest.fn();
    const onSentence = jest.fn();
    speakBeat(BEAT, { onEnd, onError: jest.fn(), onWord, onSentence }, { speech: silentSpeech() });
    jest.advanceTimersByTime(LEAD_IN_MS + estimateDurationMs('Here is the castle.') - 1);
    expect(onWord).toHaveBeenCalledTimes(4);
    expect(onEnd).not.toHaveBeenCalled();
    jest.advanceTimersByTime(60_000);
    expect(onSentence).toHaveBeenCalledTimes(3);
    expect(onWord).toHaveBeenCalledTimes(4 + 3 + 2);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('stopping the silent voice stops its words', () => {
    const onWord = jest.fn();
    const handle = speakBeat(BEAT, { onEnd: jest.fn(), onError: jest.fn(), onWord }, { speech: silentSpeech() });
    jest.advanceTimersByTime(LEAD_IN_MS + 1);
    handle.cancel();
    const said = onWord.mock.calls.length;
    jest.advanceTimersByTime(60_000);
    expect(onWord).toHaveBeenCalledTimes(said);
  });
});
