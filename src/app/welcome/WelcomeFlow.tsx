"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Avatar from "@/components/Avatar";
import Meridian from "@/components/Meridian";
import TravelCard from "@/components/welcome/TravelCard";
import { INTEREST_TAGS } from "@/components/InterestPicker";
import { DIETARY_TAGS } from "@/components/DietaryPicker";
import { authClient } from "@/lib/authClient";
import type { TravelerProfile } from "@/lib/travelerProfile";
import {
  CROWD_CHOICES, GROUP_CHOICES, MAX_LOVES, PACE_CHOICES, STEP_LINES, WELCOME_STEPS,
  answersFromProfile, dietLine, firstName, homeLine, loveLine, photoLine, readyLine, welcomeSummary, welcomeToProfile,
  type WelcomeAnswers,
} from "@/lib/travelCard";
import HomeCitySearch from "@/components/welcome/HomeCitySearch";

const PROFILE_STEPS = new Set(["who", "rhythm", "matters", "home"]);

/**
 * The welcome after sign-up: one job per page, every answer stamping the travel card, and your
 * TripMate reacting in a sentence. Answers are written as each Continue is pressed, so quitting
 * halfway keeps what was said. The step lives in `?step=` so the browser's Back works.
 */
export default function WelcomeFlow({ user, profile: initialProfile, next }: {
  user: { id: string; name: string; image: string | null };
  profile: TravelerProfile | null;
  next: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const index = Math.min(WELCOME_STEPS.length - 1, Math.max(0, Number(params.get("step") ?? 0) || 0));
  const step = WELCOME_STEPS[index];

  const [answers, setAnswers] = useState<WelcomeAnswers>(() => answersFromProfile(initialProfile, user.name));
  const [profile, setProfile] = useState(initialProfile);
  const [image, setImage] = useState(user.image);
  const [issued] = useState(() => new Date());
  const [line, setLine] = useState<string | null>(null);
  const [cheer, setCheer] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const cheerTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(cheerTimer.current), []);
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  // Move focus to the new page's heading, but not on page load.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    heading.current?.focus();
  }, [step]);

  const nextParam = next !== "/trips" ? `&next=${encodeURIComponent(next)}` : "";
  // Stepping is client-only: `router.push` would re-run the server page, and once `complete()` has run
  // that page redirects to /trips, so Ready would never render. Native pushState syncs into
  // `useSearchParams` without a server round trip.
  const go = (i: number) => { setLine(null); window.history.pushState(null, "", `/welcome?step=${i}${nextParam}`); };
  function react(text: string) {
    setLine(text);
    setCheer(true);
    window.clearTimeout(cheerTimer.current);
    cheerTimer.current = window.setTimeout(() => setCheer(false), 1100);
  }
  const set = (patch: Partial<WelcomeAnswers>) => setAnswers((a) => ({ ...a, ...patch }));

  async function saveProfile(a: WelcomeAnswers) {
    const p = welcomeToProfile(a, profile);
    setProfile(p);
    // Each write sends the whole profile, so a failed one is repaired by the next that succeeds.
    const ok = await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile: p }) })
      .then((r) => r.ok).catch(() => false);
    if (!ok) setUnsaved(true);
  }
  const complete = (skipped: boolean) =>
    fetch("/api/onboarding/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skipped }) }).catch(() => {});

  async function proceed() {
    if (busy) return;
    setBusy(true);
    let a = answers;
    if (step === "you" && a.name.trim() && a.name.trim() !== user.name) {
      const res = await authClient.updateUser({ name: a.name.trim().slice(0, 40) }).catch(() => ({ error: true }));
      if (res.error) setUnsaved(true);
    }
    if (step === "rhythm") { a = { ...a, pace: a.pace ?? "balanced", crowds: a.crowds ?? "mixed" }; setAnswers(a); }
    if (PROFILE_STEPS.has(step)) await saveProfile(a);
    if (WELCOME_STEPS[index + 1] === "ready") await complete(false);
    setBusy(false);
    go(index + 1);
  }
  async function skip() {
    if (busy) return;
    setBusy(true);
    try {
      if (PROFILE_STEPS.has(step)) await saveProfile(answers);
      await complete(true);
    } finally { setBusy(false); }
    go(WELCOME_STEPS.length - 1);
  }

  const host = step === "welcome" ? null : (
    <div className="flex min-h-14 items-center gap-3">
      <Meridian state={cheer ? "success" : "idle"} size={52} />
      <p aria-live="polite" className="max-w-[34ch] text-[0.95rem] leading-snug text-muted">
        {line ?? (step === "ready" ? readyLine(answers.name) : STEP_LINES[step as keyof typeof STEP_LINES])}
      </p>
    </div>
  );

  return (
    <main
      className="pointer-events-auto fixed inset-0 z-40 overflow-y-auto"
      style={{ background: "radial-gradient(120% 70% at 50% -10%, rgb(40 185 129 / 0.10), transparent 60%), radial-gradient(80% 60% at 100% 100%, rgb(164 110 147 / 0.10), transparent 60%), rgb(18 17 16)" }}
    >
      <div className="mx-auto grid min-h-full w-full max-w-6xl gap-6 px-5 pt-[calc(var(--nav-h)+1.25rem)] pb-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] lg:gap-12 lg:px-10 lg:pt-[calc(var(--nav-h)+2rem)] lg:pb-10">
        <div className="flex min-h-[640px] flex-col gap-5 lg:max-w-xl">
          <TopBar index={index} onBack={() => go(index - 1)} onSkip={skip} busy={busy} hidden={step === "welcome" || step === "ready"} />
          <div className="lg:hidden"><TravelCard answers={answers} image={image} issued={issued} compact complete={step === "ready"} /></div>
          {host}
          <section key={step} className="welcome-step flex flex-1 flex-col gap-4">
            {step === "welcome" && <WelcomeIntro heading={heading} />}
            {step === "you" && (
              <>
                <h1 ref={heading} tabIndex={-1} className="font-display-xl text-[clamp(2rem,6vw,3.1rem)] leading-[1.06]">Hello, {firstName(answers.name)}.</h1>
                <label className="grid gap-2">
                  <span className="text-[0.6875rem] font-semibold tracking-[0.18em] text-muted uppercase">Your name</span>
                  <input value={answers.name} maxLength={40} autoComplete="name" onChange={(e) => set({ name: e.target.value })}
                    className="rounded-2xl border border-card-border bg-white/5 px-4 py-3.5 text-xl font-medium text-foreground focus:border-accent focus:ring-4 focus:ring-accent/15 focus:outline-none" />
                </label>
                <div className="flex items-center gap-4">
                  <Avatar userId={user.id} name={answers.name} image={image} size={104} editable onChange={(img) => { setImage(img); if (img) react(photoLine(answers.name)); }} />
                  <div className="grid gap-1"><strong className="text-[0.95rem]">{image ? "Looking good." : "Add a face to the card"}</strong>
                    <span className="text-sm text-muted">{image ? "Tap the photo to change it." : "Optional. It shows on your profile and on trips you share."}</span></div>
                </div>
              </>
            )}
            {step === "who" && (
              <>
                <h1 ref={heading} tabIndex={-1} className="font-display-xl text-[clamp(2rem,6vw,3.1rem)] leading-[1.06]">Who&rsquo;s coming with you?</h1>
                <p className="text-muted">Most of the time. You can change it for any trip.</p>
                <div className="grid grid-cols-2 gap-2.5">
                  {GROUP_CHOICES.map((g) => (
                    <button key={g.id} type="button" aria-pressed={answers.group === g.id} onClick={() => { set({ group: g.id }); react(g.line); }}
                      className="grid gap-1 rounded-2xl border border-card-border bg-white/5 p-4 text-left transition hover:bg-white/10 active:scale-[0.97] aria-pressed:border-accent aria-pressed:bg-accent/10">
                      <strong>{g.title}</strong><small className="text-muted">{g.hint}</small>
                    </button>
                  ))}
                </div>
              </>
            )}
            {step === "rhythm" && <Rhythm heading={heading} answers={answers} onPace={(id) => { set({ pace: id }); react(PACE_CHOICES.find((p) => p.id === id)!.line); }} onCrowds={(id) => { set({ crowds: id }); react(CROWD_CHOICES.find((c) => c.id === id)!.line); }} />}
            {step === "matters" && (
              <>
                <h1 ref={heading} tabIndex={-1} className="font-display-xl text-[clamp(2rem,6vw,3.1rem)] leading-[1.06]">What matters most?</h1>
                <div className="flex items-baseline justify-between"><span className="text-[0.6875rem] font-semibold tracking-[0.18em] text-muted uppercase">Pick up to three</span><span className="text-xs text-muted tabular-nums">{answers.loves.length} of {MAX_LOVES}</span></div>
                <div className="flex flex-wrap gap-2">
                  {INTEREST_TAGS.map((tag) => {
                    const at = answers.loves.indexOf(tag);
                    return (
                      <button key={tag} type="button" aria-pressed={at >= 0}
                        onClick={() => {
                          if (at >= 0) return set({ loves: answers.loves.filter((l) => l !== tag) });
                          if (answers.loves.length >= MAX_LOVES) return setLine("Three is the limit. Tap one to swap it out.");
                          const loves = [...answers.loves, tag];
                          set({ loves });
                          react(loveLine(loves, tag));
                        }}
                        className="inline-flex items-center gap-2 rounded-full border border-card-border bg-white/5 px-3.5 py-2.5 text-sm font-semibold transition active:scale-95 aria-pressed:border-accent aria-pressed:bg-accent/15">
                        {at >= 0 && <span className="grid h-5 w-5 place-items-center rounded-full bg-accent text-[0.7rem] text-accent-foreground">{at + 1}</span>}{tag}
                      </button>
                    );
                  })}
                </div>
                <span className="mt-1.5 text-[0.6875rem] font-semibold tracking-[0.18em] text-muted uppercase">How you eat</span>
                <div className="flex flex-wrap gap-2">
                  {DIETARY_TAGS.map((tag) => {
                    const on = answers.diet.includes(tag);
                    return (
                      <button key={tag} type="button" aria-pressed={on}
                        onClick={() => { set({ diet: on ? answers.diet.filter((d) => d !== tag) : [...answers.diet, tag] }); if (!on) react(dietLine(tag)); }}
                        className="rounded-full border border-card-border bg-white/5 px-3 py-2 text-[0.82rem] font-semibold aria-pressed:border-money aria-pressed:bg-money-soft">
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            {step === "home" && (
              <>
                <h1 ref={heading} tabIndex={-1} className="font-display-xl text-[clamp(2rem,6vw,3.1rem)] leading-[1.06]">Where&rsquo;s home?</h1>
                <p className="text-muted">It helps with travel times and the best months to go.</p>
                <HomeCitySearch value={answers.home} onPick={(home) => { if (home) { set({ home }); react(homeLine(home.name)); } else set({ home: null }); }} />
              </>
            )}
            {step === "ready" && (
              <>
                <h1 ref={heading} tabIndex={-1} className="font-display-xl text-[clamp(2rem,6vw,3.1rem)] leading-[1.06]">All set, {firstName(answers.name)}.</h1>
                <p className="font-display-xl max-w-[30ch] text-[1.35rem] leading-snug">{welcomeSummary(answers)}</p>
                {unsaved && <p role="status" className="text-sm text-alert">Some answers didn&rsquo;t save. You can finish them on your Profile.</p>}
              </>
            )}
          </section>
          <div className="grid gap-2.5">
            {step === "ready" ? (
              <>
                <button type="button" onClick={() => { router.refresh(); router.push("/?plan=1"); }} className="rounded-full bg-accent px-5 py-4 font-semibold text-accent-foreground shadow-[0_8px_24px_rgb(40_185_129/0.22)] hover:bg-accent-hover">Plan a trip</button>
                <button type="button" onClick={() => { router.refresh(); router.push(next); }} className="rounded-full border border-card-border bg-white/5 px-5 py-3.5 font-semibold hover:bg-white/10">{next === "/trips" ? "See my trips" : "Continue where I was"}</button>
              </>
            ) : (
              <button type="button" disabled={busy || (step === "you" && !answers.name.trim()) || (step === "who" && !answers.group) || (step === "matters" && !answers.loves.length)}
                onClick={step === "welcome" ? () => go(1) : proceed}
                className="rounded-full bg-accent px-5 py-4 font-semibold text-accent-foreground shadow-[0_8px_24px_rgb(40_185_129/0.22)] hover:bg-accent-hover disabled:bg-white/5 disabled:text-muted disabled:shadow-none">
                {step === "welcome" ? "Let's begin" : step === "home" ? (answers.home ? "Finish my card" : "Skip this one") : "Continue"}
              </button>
            )}
            {step === "welcome" && <p className="text-center text-xs text-muted">You can change any of this later on your Profile.</p>}
          </div>
        </div>
        <div className="hidden items-center justify-center lg:flex">
          <div className="w-full max-w-[480px] -rotate-[1.4deg]"><TravelCard answers={answers} image={image} issued={issued} complete={step === "ready"} /></div>
        </div>
      </div>
    </main>
  );
}

function TopBar({ index, onBack, onSkip, hidden, busy }: { index: number; onBack: () => void; onSkip: () => void; hidden: boolean; busy: boolean }) {
  return (
    <div className={`grid grid-cols-[40px_1fr_auto] items-center gap-3 ${hidden ? "invisible" : ""}`}>
      <button type="button" onClick={onBack} disabled={busy} aria-label="Back" className="grid h-9 w-9 place-items-center rounded-full border border-card-border bg-white/5">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
      </button>
      <div className="grid grid-cols-5 gap-1.5" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className="h-1 overflow-hidden rounded bg-white/12"><span className={`block h-full origin-left bg-accent transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${i <= index ? "scale-x-100" : "scale-x-0"}`} /></span>
        ))}
      </div>
      <button type="button" onClick={onSkip} disabled={busy} className="text-sm font-semibold text-muted hover:text-foreground">Skip for now</button>
    </div>
  );
}

function WelcomeIntro({ heading }: { heading: RefObject<HTMLHeadingElement | null> }) {
  return (
    <div className="grid justify-items-start gap-4 pt-3">
      <Meridian state="idle" size={120} />
      <h1 ref={heading} tabIndex={-1} className="font-display-xl text-[clamp(2rem,6vw,3.1rem)] leading-[1.06]">Hi, I&rsquo;m your TripMate. Let&rsquo;s make every plan yours.</h1>
      <p className="max-w-[40ch] leading-relaxed text-muted">Five quick questions, about a minute. Each answer goes on your travel card, and every trip I plan reads it.</p>
      <ul className="grid gap-2.5 text-[0.9rem] text-muted">
        {["Days paced the way you like them", "Food that fits how you eat", "More of what you love, less of what you don't"].map((t) => (
          <li key={t} className="flex items-center gap-2.5">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-accent" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>{t}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Rhythm({ heading, answers, onPace, onCrowds }: { heading: RefObject<HTMLHeadingElement | null>; answers: WelcomeAnswers; onPace: (id: WelcomeAnswers["pace"] & string) => void; onCrowds: (id: WelcomeAnswers["crowds"] & string) => void }) {
  const pace = PACE_CHOICES.find((p) => p.id === (answers.pace ?? "balanced"))!;
  const crowds = answers.crowds ?? "mixed";
  const seg = "grid grid-cols-3 gap-1.5 rounded-2xl border border-card-border bg-white/5 p-1";
  const segBtn = "rounded-xl px-1.5 py-2.5 text-sm font-semibold text-muted transition aria-pressed:bg-foreground aria-pressed:text-background";
  return (
    <>
      <h1 ref={heading} tabIndex={-1} className="font-display-xl text-[clamp(2rem,6vw,3.1rem)] leading-[1.06]">Find your rhythm.</h1>
      <span className="text-[0.6875rem] font-semibold tracking-[0.18em] text-muted uppercase">Pace</span>
      <div className={seg}>{PACE_CHOICES.map((p) => <button key={p.id} type="button" aria-pressed={pace.id === p.id} onClick={() => onPace(p.id)} className={segBtn}>{p.label}</button>)}</div>
      <div className="grid gap-2.5 rounded-2xl border border-card-border bg-black/20 px-4 py-3.5">
        <div className="flex items-baseline justify-between"><span className="text-[0.6875rem] font-semibold tracking-[0.18em] text-muted uppercase">A day, your way</span><span className="text-xs text-muted tabular-nums">{pace.times.length} stops · {pace.times[0]}–{pace.times[pace.times.length - 1]}</span></div>
        <div className="relative h-14">
          <span className="absolute inset-x-0 top-[13px] h-px bg-white/12" />
          {pace.times.map((t, i) => (
            <span key={t} className="absolute top-1.5 grid -translate-x-1/2 justify-items-center gap-1.5 text-[0.6875rem] text-muted tabular-nums transition-[left] duration-500"
              style={{ left: `${6 + (88 * i) / Math.max(1, pace.times.length - 1)}%` }}>
              <i className="h-[15px] w-[15px] rounded-full border-2 border-[rgb(18_17_16)] bg-accent" />{t}
            </span>
          ))}
        </div>
      </div>
      <span className="text-[0.6875rem] font-semibold tracking-[0.18em] text-muted uppercase">Crowds</span>
      <div className={seg}>{CROWD_CHOICES.map((c) => <button key={c.id} type="button" aria-pressed={crowds === c.id} onClick={() => onCrowds(c.id)} className={segBtn}>{c.label}</button>)}</div>
    </>
  );
}
