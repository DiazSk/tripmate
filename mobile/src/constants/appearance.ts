import { DevSettings } from 'react-native';
import { File, Paths } from 'expo-file-system';

export type Appearance = 'dark' | 'light';

const STORE = new File(Paths.document, 'appearance');

/**
 * Which appearance this launch is running, read **synchronously at module load**.
 *
 * That is the whole mechanism, and it is what keeps the change to two files instead of thirty:
 * `theme.ts` picks a palette once, `Colors` stays a plain frozen object, and not one of the 184
 * call sites or 34 `StyleSheet.create` blocks changes. `expo-file-system` is synchronous in SDK
 * 57 and `tripCache.ts` already depends on that, so this needs no new dependency and no await.
 *
 * ponytail: switching costs a JS reload rather than a re-render, so the two appearances cannot
 * be A/B'd on the same screen. The upgrade is a context plus a `useStyles` factory, which
 * converts 34 stylesheets across 30 files — worth doing when somebody commits to shipping
 * light, and worth nothing at all while this is a prototype. The token table is identical
 * either way.
 *
 * Wrapped, like every other filesystem call in this app: an unreadable preference is dark.
 */
function read(): Appearance {
  try {
    return STORE.exists && STORE.textSync().trim() === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/**
 * **Development builds only.** The switch is not in a user build's Profile, so a user build reads
 * nothing: somebody who chose Light while it was offered would otherwise be held in it with no way
 * back. They open in Dark, the default every screen was drawn for.
 */
export const APPEARANCE: Appearance = __DEV__ ? read() : 'dark';

/**
 * Write the preference and restart the JS bundle.
 *
 * `DevSettings.reload()` is a no-op in a release build — it is, as the name says, a development
 * facility — so outside a dev client the new appearance arrives on the next cold launch. Named
 * rather than hidden: this is a token-level prototype behind a flag, not a shipped setting.
 */
export function setAppearance(next: Appearance): void {
  try {
    STORE.write(next);
  } catch {
    // A preference that cannot be written is a preference that does not persist. Reloading into
    // the old appearance is a better outcome than crashing the screen that offered the switch.
  }
  DevSettings.reload();
}
