import { useFocusEffect } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActionSheetIOS, Alert, Platform } from 'react-native';

import { legacyExplorerStyle, travelStyleOf } from '@shared/userAnswers';

import { signOut, useAccount, type Account } from '@/api/auth';
import { subscribeToSession } from '@/api/session';
import { getProfile, getProfileStats, listSavedPlaces, listTrips, saveProfile } from '@/api/tripMateApi';
import type { DiscoveryPreference, PacePreference, ProfileStats, SavedPlace, TravelerProfile, TripSummary } from '@/api/types';
import { emptyDraft, toTravelerProfile } from '@/lib/planDraft';

/**
 * The Profile tab's one copy of your profile, shared by its stack: the main screen and the screens
 * it pushes (interests, dietary, home city, account) all read and edit this, so an answer changed
 * on a pushed screen is already in the sentence when you come back.
 *
 * **It saves as you go, as it always has here.** Each edit queues a PUT of the whole profile
 * (`PUT /api/profile` replaces rather than merges), debounced so a burst of taps is one request,
 * and flushed when the tab is left. Mounted by `profile/_layout.tsx`, so its focus is the tab's,
 * not one screen's: pushing Interests does not flush, leaving the tab does.
 */

/** Long enough that a burst of taps is one request, short enough that leaving the tab rarely
 *  races it, and blur flushes what is pending. Matches `ProfileStore.edited()` in the Swift app. */
const SAVE_DEBOUNCE_MS = 600;
/** How long "Saved" stays in the bar before it clears. */
const SAVED_SHOWN_MS = 2400;

/** `undefined` still loading · `null` the fetch failed · a profile otherwise. A traveller with no
 *  profile gets the wizard's defaults, and nothing is written until their first edit. */
export type Loaded = TravelerProfile | null | undefined;
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed';

/**
 * One half of the pair, plus the legacy field both halves derive to. Written together: `explorerStyle`
 * is still what a stored row and the frozen Swift app read.
 */
export function withLegacy(profile: TravelerProfile, change: { pace?: PacePreference; discovery?: DiscoveryPreference }): Partial<TravelerProfile> {
  const next = { ...travelStyleOf(profile), ...change };
  return { ...change, explorerStyle: legacyExplorerStyle(next) };
}

type Store = {
  account: Account | null;
  profile: Loaded;
  edit: (changes: Partial<TravelerProfile>) => void;
  status: SaveStatus;
  stats: ProfileStats | undefined;
  recent: TripSummary[];
  places: SavedPlace[];
};

const ProfileContext = createContext<Store | null>(null);

export function useProfileStore(): Store {
  const store = useContext(ProfileContext);
  if (!store) throw new Error('useProfileStore outside ProfileProvider');
  return store;
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { account } = useAccount();
  const [profile, setProfile] = useState<Loaded>(undefined);
  const [stats, setStats] = useState<ProfileStats | undefined>(undefined);
  const [recent, setRecent] = useState<TripSummary[]>([]);
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [status, setStatus] = useState<SaveStatus>('idle');

  /**
   * True from the first edit until a PUT carrying it succeeds: the store's one correctness guard.
   * The profile is re-read on every focus, and that read would overwrite an edit that has not
   * reached the server. It clears on success, which hands authority back to the server.
   */
  const unsaved = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shown = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<TravelerProfile | null>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    void saveProfile(next).then((ok) => {
      // Only a success releases the guard, and only if nothing was queued behind this write.
      if (ok && !timer.current) unsaved.current = false;
      if (timer.current) return;
      setStatus(ok ? 'saved' : 'failed');
      if (shown.current) clearTimeout(shown.current);
      if (ok) shown.current = setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), SAVED_SHOWN_MS);
    });
  }, []);

  /** Read everything for whoever the caller currently is. Returns its own cancel: a tab change and
   *  a sign-out can each land mid-flight, and a late reply must not win. */
  const load = useCallback(() => {
    let active = true;
    if (!unsaved.current) {
      void getProfile().then((result) => {
        if (!active || unsaved.current) return;
        setProfile(result === undefined ? null : (result ?? toTravelerProfile(emptyDraft())));
      });
    }
    void getProfileStats().then((r) => active && setStats(r));
    void listTrips().then((r) => active && setRecent((r ?? []).slice(0, 6)));
    void listSavedPlaces().then((r) => active && setPlaces(r ?? []));
    return () => {
      active = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      const cancel = load();
      // Leaving the tab mid-debounce must not sit on an unsent edit.
      return () => {
        cancel();
        flush();
      };
    }, [flush, load]),
  );

  // Signing in or out changes whose figures these are, and it happens on this very tab.
  useEffect(() => {
    let cancel: (() => void) | undefined;
    const unsubscribe = subscribeToSession(() => {
      cancel?.();
      cancel = load();
    });
    return () => {
      cancel?.();
      unsubscribe();
    };
  }, [load]);

  useEffect(
    () => () => {
      if (shown.current) clearTimeout(shown.current);
    },
    [],
  );

  /** Queue an edit. The whole profile goes every time. */
  const edit = useCallback(
    (changes: Partial<TravelerProfile>) => {
      setProfile((current) => {
        if (!current) return current;
        const next = { ...current, ...changes };
        unsaved.current = true;
        pending.current = next;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
        return next;
      });
      setStatus('saving');
    },
    [flush],
  );

  return <ProfileContext.Provider value={{ account, profile, edit, status, stats, recent, places }}>{children}</ProfileContext.Provider>;
}

/**
 * Sign out, asked first the way iOS asks an account action: the destructive action sheet. Your
 * trips stay on the account; this phone goes back to planning without one.
 */
export function confirmSignOut(then?: () => void) {
  const title = 'Sign out of TripMate?';
  const message = 'Your trips stay on your account. This phone keeps planning without one.';
  const run = async () => {
    await signOut();
    then?.();
  };
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions({ title, message, options: ['Sign Out', 'Cancel'], destructiveButtonIndex: 0, cancelButtonIndex: 1 }, (i) => i === 0 && void run());
  } else {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => void run() },
    ]);
  }
}
