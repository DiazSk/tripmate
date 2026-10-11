import { setAudioModeAsync } from 'expo-audio';
import * as Speech from 'expo-speech';

import { pickNarrator, type SpeechLike } from '@/lib/narrator';

/**
 * The phone's own speech engine behind the narrator seam — the one file that imports a native
 * module, so `narrator.ts` stays testable.
 */
export const deviceSpeech: SpeechLike = {
  speak: (text, options) => Speech.speak(text, options),
  stop: () => {
    void Speech.stop();
  },
};

/** The best English voice installed, or undefined for the system default. Never throws. */
export async function narratorVoice(): Promise<string | undefined> {
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    return pickNarrator(voices, Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return undefined;
  }
}

/**
 * **The silent switch does not mute a film.** Pressing Play is a request for sound, the way a
 * video plays with the switch on; `expo-speech` speaks on the app's audio session, so this is
 * what lets it be heard. Other audio is ducked while the narrator speaks, and mixing is restored
 * when the film ends.
 */
export function filmAudio(on: boolean): void {
  setAudioModeAsync(
    on ? { playsInSilentMode: true, interruptionMode: 'duckOthers' } : { interruptionMode: 'mixWithOthers' },
  ).catch(() => {
    // A session that cannot be configured still speaks with the switch off — not worth a message.
  });
}
