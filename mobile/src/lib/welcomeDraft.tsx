import { usePathname } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import type { TravelerProfile } from '@shared/travelerProfile';
import { answersFromProfile, hasAnyAnswer, welcomeToProfile, type WelcomeAnswers } from '@shared/travelCard';

import { useAccount } from '@/api/auth';
import { completeOnboarding, getProfile, saveProfile } from '@/api/tripMateApi';

interface WelcomeValue {
  answers: WelcomeAnswers;
  set: (patch: Partial<WelcomeAnswers>) => void;
  image: string | null;
  issued: Date;
  line: string | null;
  /** The step the line was said on, so a frame shows it only on that page. */
  lineStep: string | null;
  cheer: boolean;
  /** Say a line and let the character cheer (the success squint and lift) for one beat. */
  react: (text: string) => void;
  /** Say a line without cheering — a gentle no, like the fourth pick. */
  quiet: (text: string | null) => void;
  save: (a?: WelcomeAnswers) => Promise<void>;
  complete: (skipped: boolean) => Promise<void>;
  /** True once any write has failed. Sticky: a later success never clears it, because the earlier answers are still unsaved. */
  unsaved: boolean;
  /** For a write this provider cannot see (the name goes through the account route, not the profile). */
  flagUnsaved: () => void;
  /** One button's work at a time: Continue and Skip share it, so a second press while one runs does nothing. */
  busy: boolean;
  guard: (work: () => Promise<void>) => Promise<void>;
  ready: boolean;
}

const WelcomeContext = createContext<WelcomeValue | null>(null);

/** The welcome's answers, shared by its seven routes the way `PlanDraftProvider` shares the wizard's. */
export function WelcomeDraftProvider({ children }: { children: React.ReactNode }) {
  const { account } = useAccount();
  const [answers, setAnswers] = useState<WelcomeAnswers>(() => answersFromProfile(null, ''));
  const [profile, setProfile] = useState<TravelerProfile | null>(null);
  // 'loading' until the profile fetch answers; 'failed' is distinct from "no profile" (see `save`).
  const [load, setLoad] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const ready = load !== 'loading';
  // Which answers the traveller has touched, so a late profile never overwrites them.
  const touched = useRef(new Set<string>());
  // The page showing now, read at the moment a line is said: /welcome -> 'welcome', /welcome/who -> 'who'.
  const pathname = usePathname();
  const stepNow = useRef('welcome');
  useEffect(() => { stepNow.current = pathname.split('/')[2] ?? 'welcome'; }, [pathname]);
  const [issued] = useState(() => new Date());
  const [said, setSaid] = useState<{ text: string; step: string } | null>(null);
  const [cheer, setCheer] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Seed once the account and any claimed profile are known; the welcome opens pre-filled.
  // `undefined` (the fetch failed) is "no profile" — and still ready, so the welcome never hangs offline.
  useEffect(() => {
    if (!account || ready) return;
    let alive = true;
    getProfile().then((p) => {
      if (!alive) return;
      // The wire type leaves `accessibility` optional, which the server's parser always fills in.
      const claimed = (p ?? null) as TravelerProfile | null;
      setProfile(claimed);
      const seeded = answersFromProfile(claimed, account.name ?? '');
      setAnswers((a) => {
        const merged: Record<string, unknown> = { ...seeded };
        for (const key of touched.current) merged[key] = a[key as keyof WelcomeAnswers];
        return merged as unknown as WelcomeAnswers;
      });
      setLoad(p === undefined ? 'failed' : 'loaded');
    });
    return () => { alive = false; };
  }, [account, ready]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const react = useCallback((text: string) => {
    setSaid({ text, step: stepNow.current });
    setCheer(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCheer(false), 1100);
  }, []);
  const quiet = useCallback((text: string | null) => setSaid(text === null ? null : { text, step: stepNow.current }), []);
  const guard = useCallback(async (work: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      await work();
    } finally {
      working.current = false;
      setBusy(false);
    }
  }, []);

  const value: WelcomeValue = useMemo(() => ({
    answers,
    set: (patch) => {
      for (const key of Object.keys(patch)) touched.current.add(key);
      setAnswers((a) => ({ ...a, ...patch }));
    },
    image: account?.image ?? null,
    issued,
    line: said?.text ?? null,
    lineStep: said?.step ?? null,
    cheer,
    react,
    quiet,
    save: async (a = answers) => {
      // Building a profile before the stored one is known would overwrite what the account already
      // has (access needs, the dietary note), so a load that failed or has not finished writes nothing.
      if (load !== 'loaded') return setUnsaved(true);
      // Skipping an unanswered step must not invent answers (solo, balanced) for an account with none.
      if (!profile && !hasAnyAnswer(a)) return;
      const next = welcomeToProfile(a, profile);
      setProfile(next);
      if (!(await saveProfile(next))) setUnsaved(true);
    },
    complete: completeOnboarding,
    unsaved,
    flagUnsaved: () => setUnsaved(true),
    busy,
    guard,
    ready,
  }), [answers, account?.image, issued, said, cheer, react, quiet, profile, load, unsaved, busy, guard, ready]);
  return <WelcomeContext.Provider value={value}>{children}</WelcomeContext.Provider>;
}

export function useWelcome(): WelcomeValue {
  const value = useContext(WelcomeContext);
  if (!value) throw new Error('useWelcome outside WelcomeDraftProvider');
  return value;
}
