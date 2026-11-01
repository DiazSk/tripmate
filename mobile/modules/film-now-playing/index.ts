import { NativeModule, requireOptionalNativeModule } from 'expo';

import type { FilmCommand, NowPlayingInfo } from '@/lib/nowPlaying';

declare class FilmNowPlayingNative extends NativeModule<{ onCommand: (event: { command: FilmCommand }) => void }> {
  start(info: NowPlayingInfo): Promise<void>;
  update(info: NowPlayingInfo): Promise<void>;
  stop(): Promise<void>;
}

// Absent on Android and the web, where a film still pauses when the app is left.
const native = requireOptionalNativeModule<FilmNowPlayingNative>('FilmNowPlaying');

/** The story film as iOS's Now Playing player. Every method is a no-op where the module is absent. */
export const filmNowPlaying = {
  available: native !== null,
  start(info: NowPlayingInfo): void {
    void native?.start(info).catch(() => {});
  },
  update(info: NowPlayingInfo): void {
    void native?.update(info).catch(() => {});
  },
  stop(): void {
    void native?.stop().catch(() => {});
  },
  onCommand(listener: (command: FilmCommand) => void): { remove(): void } {
    const subscription = native?.addListener('onCommand', (event) => listener(event.command));
    return { remove: () => subscription?.remove() };
  },
};
