"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import dynamic from "next/dynamic";
import "./PolarLanding.css";
import { useScrollContainer } from "@/lib/scrollContainer";
import { planExamples, toPrefill, formatExampleParty, formatExampleSpan, resolveExampleDates, type PlanPrefill } from "@/lib/planExamples";
import { sceneBeats } from "@/lib/sceneBeats";
import { LENSES, petraPrefill, petraSampleDate, type LensId } from "@/lib/petraDay";
import { PLAN_EVENT } from "@/lib/planIntent";
import { heroPlaceIn, heroScene } from "@/lib/heroScene";
import type { IdeaRead } from "@/lib/ideaRead";
import { scrollToTarget, useLandingMotion } from "./motion";
import { Day, OpenSheet, useReveal, Ways } from "./ImagineDay";
import { DateRangeFields, shortDate, todayISO } from "./DateRangeFields";
import MeriPill, { type PlanEntry } from "./MeriPill";
import Meridian from "@/components/Meridian";

// The plan's globe pulls in MapLibre, which the landing's first viewport never needs.
const PlanGlobe = dynamic(() => import("./PlanGlobe"), { ssr: false });

/**
 * The landing, on Polar Interior: the "TripMate Polar Landing" design on the MagicPath canvas,
 * built into the app. Every "plan" here calls `onPlan`, which is HomeView's `startPlanning`, so the
 * wizard is unchanged.
 *
 * The page imagines one day before it plans anything: a destination hero, then a sample day in
 * Petra told as a story (ImagineDay `Day`), the same day four ways (`Ways`), and the plan behind it
 * on a night globe (`PlanGlobe`), all from `src/lib/petraDay.ts`. Then more sample journeys, what a
 * plan knows, and a closing form.
 *
 * **Light, by opting in.** The root carries `data-appearance="light"`, the Polar Light scope in
 * globals.css; the globe and the footer are night by their own backgrounds.
 *
 * **Copy and data are the app's.** The journeys, their photographs and their prefill come from
 * `planExamples`, the four beats from `sceneBeats`.
 */

// heroScene's HERO_PLACES mirrors these ids and words in this order: an index into one is an index into the other.
type Dest = { id: string; word: string; coord: string; img: string };
const DESTS: Dest[] = [
  { id: "petra", word: "Petra", coord: "[ 30º 19’ 20” N, 35º 27’ 07” E ]", img: "/scenes/petra-treasury.webp" },
  { id: "engadin", word: "Engadin", coord: "[ 46º 29’ 52” N, 9º 50’ 17” E ]", img: "/scenes/graubunden-autumn-valley.webp" },
  { id: "tuscany", word: "Tuscany", coord: "[ 43º 03’ 54” N, 11º 36’ 41” E ]", img: "/scenes/tuscany-cypress-road.webp" },
  { id: "jaipur", word: "Jaipur", coord: "[ 26º 54’ 45” N, 75º 47’ 14” E ]", img: "/scenes/jaipur-amber-fort-elephant.webp" },
  { id: "sinaia", word: "Sinaia", coord: "[ 45º 21’ 00” N, 25º 33’ 00” E ]", img: "/scenes/peles-castle-romania-snow.webp" },
];
const ROTATE_MS = 6000;

// The four journeys' seasons, as the strip prints them. Presentation copy, keyed by the plan's id.
const SEASON: Record<string, string> = { tuscany: "Early autumn", jaipur: "Cool season", sinaia: "Deep winter", "wadi-rum": "Spring" };

// "Then, either way" in the How it works sheet: what happens after both ways in.
const STEPS = [
  { n: "01", title: "Your budget is a ceiling", prose: "However you start, the plan stays inside what you said you would spend rather than spending up to it." },
  { n: "02", title: "Real data goes in first", prose: "Forecast for your actual dates, public holidays, opening hours and travel times, fetched before a single word is written." },
  { n: "03", title: "Written, then critiqued", prose: "A second pass reviews the finished plan against your budget and pace, and rewrites the days it finds fault with." },
  { n: "04", title: "Every place is checked", prose: "Coordinates are corrected against OpenStreetMap, so the pins land where the place actually is rather than where the model guessed." },
];

// The planner's own step names (the chips in planner/PlanningFlow.tsx), in order.
const PLANNER_STEPS = ["Where and when", "Who’s going", "What you’re after", "Review"];

const FACTS = [
  ["Forecast", "For your actual dates, up to 16 days out"],
  ["Holidays & hours", "Public holidays and opening times, fetched first"],
  ["Critiqued", "A second pass against your budget and pace"],
] as const;

const FOOT_PHOTO = "/scenes/wadi-rum-desert.webp";

export default function PolarLanding({ onPlan }: { onPlan: (prefill?: PlanPrefill, entry?: PlanEntry | "landing") => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const askRef = useRef<HTMLDivElement>(null);
  const wordRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLElement>(null);
  const scroller = useScrollContainer();
  // True only in the browser, without a setState-in-effect: the portal target is document.body.
  const inBrowser = useSyncExternalStore(noopSubscribe, () => true, () => false);
  useLandingMotion(rootRef, scroller);
  useReveal([]);

  const [today] = useState(todayISO);
  // The sample day is a season, not a date: the next Wednesday after 12 April (petraDay.ts).
  const sampleDay = shortDate(petraSampleDate(today));

  const [destId, setDestId] = useState("petra");
  const [heroPaused, setHeroPaused] = useState(false);
  // The pill: whether it is open, the hero place its settled text names (-1 for none), and what Meri read.
  const [pillOpen, setPillOpen] = useState(false);
  const [typed, setTyped] = useState(-1);
  const [read, setRead] = useState<IdeaRead | null>(null);
  // How it works opens the pill through this.
  const pillFocus = useRef<{ focus(): void } | null>(null);
  const [plan, setPlan] = useState(0);
  const [howOpen, setHowOpen] = useState(false);
  const howTab = useRef<HTMLButtonElement>(null);
  const howClose = useRef<HTMLButtonElement>(null);
  // Set by "Ask Meri" so the sheet's focus return does not take the caret back from the pill.
  const askMeri = useRef(false);
  // The hero follows the sentence: a place it names (typed, or read) shows that place's photograph; a
  // read place the hero has no photograph of is named over the night veil instead.
  const scene = heroScene(read, typed, DESTS.findIndex((d) => d.id === destId));
  const dest = DESTS[scene.index];
  // A named hero place becomes the rotation's own place, so clearing the idea rotates on from it.
  const follow = (i: number) => {
    if (i >= 0) setDestId(DESTS[i].id);
  };

  // The day: how it is travelled, the stop in focus, and the "open this day" sheet.
  const [lens, setLens] = useState<LensId>("slow");
  const [hot, setHot] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const closeSheet = useCallback(() => setSheet(false), []);

  const [where, setWhere] = useState("");
  const [dates, setDates] = useState({ start: "", end: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // The navbar's "Plan a trip" (and its phone menu's) can't reach HomeView, so it asks here.
  useEffect(() => {
    const plan = () => onPlan();
    window.addEventListener(PLAN_EVENT, plan);
    return () => window.removeEventListener(PLAN_EVENT, plan);
  }, [onPlan]);

  // The hero moves on every ROTATE_MS. Naming a place restarts the clock; resting on the hero, tabbing
  // into it, or an open pill holds it; a hidden tab or reduced motion never rotates at all.
  useEffect(() => {
    if (heroPaused || pillOpen || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setTimeout(() => {
      if (document.hidden) return;
      const i = DESTS.findIndex((d) => d.id === destId);
      setDestId(DESTS[(i + 1) % DESTS.length].id);
    }, ROTATE_MS);
    return () => window.clearTimeout(t);
  }, [destId, heroPaused, pillOpen]);

  // What opens under the pill must never cover the monument word, and nothing may fade it. While
  // something is open, the group lifts just enough to clear the word by 1em; if that would put it
  // under the navbar it stops there and the hero grows instead, pushing the word down (and never
  // letting the hero's overflow clip the card). At rest the pill keeps the hero's centre.
  // Offsets, not rects: they ignore the GSAP scroll transforms on the wrappers and the lift itself.
  useEffect(() => {
    const hero = heroRef.current, ask = askRef.current, word = wordRef.current;
    const group = ask?.firstElementChild as HTMLElement | null;
    if (!hero || !ask || !word || !group) return;
    let frame = 0;
    const fit = () => {
      const under = group.querySelector<HTMLElement>(".mp-under");
      // Below 900px the pill is in the flow, above the word by construction.
      if (getComputedStyle(ask).position !== "absolute" || !under?.offsetHeight) {
        ask.style.removeProperty("--mp-lift");
        hero.style.removeProperty("--hero-fit");
        return;
      }
      const em = parseFloat(getComputedStyle(ask).fontSize);
      const ceiling = parseFloat(getComputedStyle(hero).paddingTop) + em;
      // Everything from the word down keeps its height as the hero grows, so this is stable.
      const belowWord = hero.offsetHeight - word.offsetTop;
      hero.style.setProperty("--hero-fit", `${ceiling + group.offsetHeight + em + belowWord}px`);
      const top = group.offsetTop;
      const want = Math.max(ceiling, Math.min(top, word.offsetTop - em - group.offsetHeight));
      ask.style.setProperty("--mp-lift", `${top - want}px`);
    };
    // A frame later: writing the hero's height inside the observer's callback would resize what it observes.
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    [hero, group, word].forEach((el) => ro.observe(el));
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  // The sheet is a modal dialog: Escape closes it, focus moves in on open and returns to the tab on close.
  useEffect(() => {
    if (!howOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setHowOpen(false);
    window.addEventListener("keydown", onKey);
    howClose.current?.focus({ preventScroll: true });
    const tab = howTab.current;
    const pill = pillFocus; // a stable handle, not a node React swaps
    return () => {
      window.removeEventListener("keydown", onKey);
      if (askMeri.current) {
        askMeri.current = false;
        pill.current?.focus();
      } else tab?.focus({ preventScroll: true });
    };
  }, [howOpen]);

  /** "See this stop in the plan": the slow way, that stop in focus, its row a third of the way down. */
  function openStop(stop: string) {
    setLens("slow");
    setHot(stop);
    requestAnimationFrame(() => scrollToTarget(document.getElementById(`stop-${stop}`), -window.innerHeight / 3));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!where.trim()) next.where = "Tell us where you’re going.";
    if (!dates.start) next.start = "When do you arrive?";
    else if (!dates.end) next.end = "When do you leave?";
    setErrors(next);
    // Where and when only: money and party were not asked, so they are not sent (see PlanPrefill).
    if (Object.keys(next).length === 0) onPlan({ destination: where.trim(), startDate: dates.start, endDate: dates.end });
  }

  return (
    // Cancels <main>'s padding exactly, as ScrollStory's wrapper did: every band here is full-bleed,
    // including the top, behind the fixed glass navbar.
    <div className="-mx-5 -mb-5 -mt-[calc(var(--nav-h)+1.25rem)] sm:-mx-6 sm:-mb-6 sm:-mt-[calc(var(--nav-h)+1.5rem)]">
      <div className="tm" data-appearance="light" ref={rootRef}>
        <div className="tm-gridlines" aria-hidden="true">
          {Array.from({ length: 12 }).map((_, i) => (
            <span key={i} />
          ))}
        </div>

        {/* ───── Hero ───── */}
        <section
          ref={heroRef}
          className="tm-hero"
          aria-label="TripMate"
          onPointerEnter={(e) => e.pointerType === "mouse" && setHeroPaused(true)}
          onPointerLeave={() => setHeroPaused(false)}
          onFocus={() => setHeroPaused(true)}
          onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setHeroPaused(false)}
        >
          {/* The page's one heading, stable. The destination rotating below is decoration, not the title. */}
          <h1 className="sr-only">TripMate — plan a day you can imagine</h1>
          <div className="tm-hero-media" aria-hidden="true">
            {DESTS.map((d, i) => (
              <Image key={d.id} src={d.img} alt="" fill sizes="100vw" priority={d.id === "petra"} className={`tm-hero-img${i === scene.index ? " is-on" : ""}`} />
            ))}
            <div className="tm-hero-scrim" />
            <div className="tm-hero-veil" />
            <div className={`tm-hero-night${scene.elsewhere ? " is-elsewhere" : pillOpen ? " is-open" : ""}`} />
          </div>

          <div className="tm-hero-mid">
            <p className="tm-hero-lead">Be there before the day arrives. Imagine it first and TripMate plans the rest.</p>
            {/* No "Plan a trip" here: the navbar carries the page's one, above the fold. */}
            <button type="button" className="tm-ghost" onClick={() => scrollToTarget(document.getElementById("day"))}>
              Picture a day <span aria-hidden="true">↓</span>
            </button>
          </div>

          <div className="tm-hero-ask" ref={askRef}>
            <MeriPill
              onPlan={onPlan}
              onText={(t) => {
                const i = heroPlaceIn(t);
                setTyped(i);
                follow(i);
              }}
              onRead={(r) => {
                setRead(r);
                if (r?.destination) follow(heroPlaceIn(r.destination));
              }}
              onOpenChange={setPillOpen}
              focusRef={pillFocus}
            />
          </div>

          <div className="tm-hero-foot">
            <span className="tm-coord tm-on-dark">{scene.elsewhere ? `[ ${read?.destination} ]` : dest.coord}</span>
          </div>

          <div className="tm-monument-wrap" ref={wordRef}>
            <p className="tm-monument" key={scene.elsewhere ?? dest.id} aria-hidden="true">
              {scene.elsewhere ?? dest.word}
            </p>
          </div>
        </section>

        {/* ───── A day you can imagine: the day, four ways, the plan behind it ───── */}
        <div className="pl">
          <Day onOpenStop={openStop} />
          <Ways lens={lens} setLens={setLens} />
          {/* A stable box for the motion to hold: PlanGlobe is a lazy import, so the element it
              renders arrives after the scroll effects (and the navbar's section observer) are bound. */}
          <div className="tm-night" id="the-plan">
            <PlanGlobe lens={lens} setLens={setLens} hot={hot} setHot={setHot} when={sampleDay} onOpen={() => setSheet(true)} />
          </div>
        </div>

        {/* ───── More journeys ───── */}
        <section className="tm-plans" id="plans">
          <div className="tm-section-title">
            <p className="tm-kicker">Sample journeys</p>
            <h2 className="tm-display">More journeys to imagine</h2>
          </div>
          {/* The rows only apply below 760px, where the strip is a grid; on desktop it is flex and
              this declaration is inert. */}
          <div className="tm-strip" style={{ gridTemplateRows: planExamples.map((_, i) => (i === plan ? "34em" : "4.5em")).join(" ") }}>
            {planExamples.map((p, i) => {
              const open = i === plan;
              const { startDate, endDate } = resolveExampleDates(p.startMonthDay, p.days, today);
              return (
                // A mouse opens a plan by resting on it; touch and keyboard open it with a tap or focus.
                <article key={p.id} className={`tm-strip-item${open ? " is-open" : ""}`} onPointerEnter={(e) => e.pointerType === "mouse" && setPlan(i)}>
                  <Image src={p.photo.src} alt="" fill sizes="(max-width: 760px) 100vw, 60vw" />
                  <button type="button" className="tm-strip-hit" aria-expanded={open} aria-label={`${p.title}, from US $${p.budgetUsd.toLocaleString("en-US")}`} onClick={() => setPlan(i)} onFocus={() => setPlan(i)} />
                  <span className="tm-strip-label" aria-hidden="true">
                    {p.destination}
                  </span>
                  <div className="tm-strip-body" aria-hidden={!open}>
                    <h3 className="tm-strip-title">{p.title}</h3>
                    <div className="tm-strip-foot">
                      <div className="tm-meta">
                        <span>From US ${p.budgetUsd.toLocaleString("en-US")}</span>
                        <span className="tm-pipe" aria-hidden="true" />
                        <span>{SEASON[p.id]}</span>
                      </div>
                      <dl className="tm-facts">
                        <div>
                          <dt>Where</dt>
                          <dd>{p.destination}</dd>
                        </div>
                        <div>
                          <dt>When</dt>
                          <dd>{formatSpan(startDate, endDate)}</dd>
                        </div>
                        <div>
                          <dt>Length</dt>
                          <dd>{formatExampleSpan(p.days)}</dd>
                        </div>
                        <div>
                          <dt>Party</dt>
                          <dd>{formatExampleParty(p.adults, p.children)}</dd>
                        </div>
                      </dl>
                      <button type="button" className="tm-signal" tabIndex={open ? 0 : -1} onClick={() => onPlan(toPrefill(p, today))}>
                        <span className="tm-signal-label">Plan one like it</span>
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* ───── What a plan knows ───── */}
        <section className="tm-knows" id="knows">
          <div className="tm-section-title">
            <p className="tm-kicker">Four things built in</p>
            <h2 className="tm-display">What a plan knows</h2>
          </div>
          <div className="tm-beats">
            {sceneBeats.map((b) => (
              <article key={b.id} className="tm-beat" tabIndex={0}>
                {b.photo && <Image src={b.photo.src} alt="" fill sizes="(max-width: 760px) 100vw, 25vw" />}
                <div className="tm-beat-card">
                  <h3 className="tm-beat-label">{b.label}</h3>
                  <p className="tm-beat-stat">{b.stat}</p>
                  <div className="tm-beat-reveal">
                    <p className="tm-beat-prose">{b.detail}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* ───── Footer: Variant B "Monument" ───── */}
        <footer className="tm-fb" ref={formRef} id="plan">
          <div className="tm-fb-photo" aria-hidden="true">
            <Image src={FOOT_PHOTO} alt="" fill sizes="100vw" />
          </div>
          <div className="tm-fb-scrim" aria-hidden="true" />

          <div className="tm-fb-inner">
            <div className="tm-fb-top">
              <p className="tm-kicker">Let’s make yours.</p>
              <span className="tm-coord tm-on-dark">[ 29º 35’ 00” N, 35º 25’ 00” E ] · Wadi Rum</span>
            </div>

            <section className="tm-fb-cta" aria-labelledby="tm-fb-title">
              <div className="tm-fb-line">
                <h2 className="tm-fb-title" id="tm-fb-title">
                  Plan a trip
                </h2>
                <span className="tm-fb-sub">Free · no account needed · drafts until you keep them</span>
              </div>

              <div className="tm-fb-carry">
                <button type="button" className="tm-signal" onClick={() => setSheet(true)}>
                  <span className="tm-signal-label">
                    Open this day in the planner <span aria-hidden="true">→</span>
                  </span>
                </button>
                <span className="tm-caption tm-on-dark-2">
                  Petra · {sampleDay} · {LENSES[lens].name}. Or start from your own idea below.
                </span>
              </div>

              <form className="tm-fb-glass tm-fb-form" onSubmit={submit} noValidate>
                <label className={`tm-fb-field tm-fb-where${errors.where ? " has-err" : ""}`}>
                  <span>Where</span>
                  <input
                    className="tm-fb-input"
                    value={where}
                    onChange={(e) => setWhere(e.target.value)}
                    placeholder="A city, region or country"
                    aria-invalid={!!errors.where}
                    aria-describedby={errors.where ? "tm-fb-where-error" : undefined}
                    maxLength={120}
                  />
                  {errors.where && <em id="tm-fb-where-error">{errors.where}</em>}
                </label>
                <DateRangeFields
                  value={dates}
                  onChange={(d) => {
                    setDates(d);
                    setErrors(({ start, end, ...rest }) => ({ ...rest, ...(d.start ? {} : { start }), ...(d.end ? {} : { end }) }));
                  }}
                  errors={errors}
                />
                <button className="tm-signal tm-fb-go" type="submit">
                  Plan my trip <span className="tm-fb-arrow" aria-hidden="true">→</span>
                </button>
              </form>

              <ul className="tm-fb-facts" aria-label="What goes in first">
                {FACTS.map(([k, v]) => (
                  <li key={k}>
                    <span className="tm-eyebrow">{k}</span>
                    <span className="tm-caption tm-on-dark-2">{v}</span>
                  </li>
                ))}
              </ul>
            </section>

            <nav className="tm-fb-links" aria-label="Footer">
              <button type="button" className="tm-fb-link" onClick={() => setHowOpen(true)}>
                How it works
              </button>
              <a className="tm-fb-link" href="#day">
                A day in Petra
              </a>
              <a className="tm-fb-link" href="#ways">
                Four ways
              </a>
              <a className="tm-fb-link" href="#the-plan">
                The plan
              </a>
              <a className="tm-fb-link" href="#plans">
                More journeys
              </a>
              <a className="tm-fb-link" href="/signin">
                Sign in
              </a>
              <span className="tm-fb-spacer" />
              <span className="tm-caption tm-on-dark-2">Photography via Pexels and Unsplash · every journey here is a sample</span>
            </nav>
          </div>

          <p className="tm-fb-monument" aria-hidden="true">
            TripMate
          </p>
        </footer>

        {sheet && <OpenSheet lens={lens} when={sampleDay} onClose={closeSheet} onOpen={(adults) => onPlan(petraPrefill(today, adults))} />}

        {/* ───── How it works sheet ───── */}
        <button ref={howTab} type="button" className="tm-tab" onClick={() => setHowOpen(true)} aria-haspopup="dialog" aria-expanded={howOpen}>
          How it works <span aria-hidden="true">+</span>
        </button>
        {/* The sheet and its scrim are portalled to <body>. Rendered here they sit inside AppShell's
            content overlay, a z-10 stacking context, so the z-20 navbar painted over the sheet's
            header whatever z-index the sheet gave itself. The wrapper re-establishes the `.tm`
            tokens and the light scope the sheet's rules expect. */}
        {inBrowser &&
          createPortal(
            <div className="tm tm-layer" data-appearance="light">
              <div className={`tm-sheet-scrim${howOpen ? " is-on" : ""}`} onClick={() => setHowOpen(false)} aria-hidden="true" />
              <aside data-lenis-prevent className={`tm-sheet${howOpen ? " is-on" : ""}`} role="dialog" aria-modal="true" aria-label="How it works" aria-hidden={!howOpen}>
                <div className="tm-sheet-head">
                  <h2 className="tm-eyebrow">How it works</h2>
                  <button ref={howClose} type="button" className="tm-quiet" onClick={() => setHowOpen(false)} tabIndex={howOpen ? 0 : -1}>
                    Close
                  </button>
                </div>
                <section aria-labelledby="tm-ways-title">
                  <h3 id="tm-ways-title" className="tm-sheet-title">
                    Two ways to start
                  </h3>
                  <p className="tm-body tm-sheet-lead">Both end in the same planner, and you check every field before a day is written.</p>
                  <div className="tm-ways">
                    <article className="tm-way">
                      <div className="tm-way-head">
                        <Meridian state="idle" size={30} />
                        <h4 className="tm-way-title">Tell Meri</h4>
                      </div>
                      <p className="tm-body">Say it in a sentence, the way you would to a friend.</p>
                      <p className="tm-way-example">“4 slow days in Lisbon under $2,000 for two”</p>
                      <p className="tm-body">Meri fills in the planner’s fields from it. Anything you didn’t say stays yours to choose.</p>
                      <button
                        type="button"
                        className="tm-signal"
                        tabIndex={howOpen ? 0 : -1}
                        onClick={() => {
                          askMeri.current = true;
                          setHowOpen(false);
                        }}
                      >
                        <span className="tm-signal-label">Ask Meri →</span>
                      </button>
                    </article>
                    <article className="tm-way">
                      <div className="tm-way-head">
                        <span className="tm-way-icon" aria-hidden="true">
                          <svg viewBox="0 0 16 16" width="16" height="16">
                            <path d="M3 4h10M3 8h7M3 12h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                          </svg>
                        </span>
                        <h4 className="tm-way-title">Step by step</h4>
                      </div>
                      <p className="tm-body">Choose every detail yourself, in four short steps:</p>
                      <ol className="tm-way-steps">
                        {PLANNER_STEPS.map((t, i) => (
                          <li key={t}>
                            <span aria-hidden="true">{i + 1}</span>
                            {t}
                          </li>
                        ))}
                      </ol>
                      <button
                        type="button"
                        className="tm-signal"
                        tabIndex={howOpen ? 0 : -1}
                        onClick={() => {
                          setHowOpen(false);
                          onPlan(undefined, "step_by_step");
                        }}
                      >
                        <span className="tm-signal-label">Plan step by step →</span>
                      </button>
                    </article>
                  </div>
                </section>
                <section aria-labelledby="tm-either-title">
                  <h3 id="tm-either-title" className="tm-eyebrow tm-either">
                    Then, either way
                  </h3>
                  <ol className="tm-steps">
                    {STEPS.map((s) => (
                      <li key={s.n}>
                        <span className="tm-step-n">{s.n}.</span>
                        <h4 className="tm-step-title">{s.title}</h4>
                        <p className="tm-body">{s.prose}</p>
                      </li>
                    ))}
                  </ol>
                </section>
              </aside>
            </div>,
            document.body
          )}
      </div>
    </div>
  );
}

const noopSubscribe = () => () => {};

/** "Sep 12–20, 2027", or across months "Feb 27 – Mar 4, 2027", in UTC like every date here. */
function formatSpan(start: string, end: string) {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  const mon = (d: Date) => d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const year = e.getUTCFullYear();
  return s.getUTCMonth() === e.getUTCMonth()
    ? `${mon(s)} ${s.getUTCDate()}–${e.getUTCDate()}, ${year}`
    : `${mon(s)} ${s.getUTCDate()} – ${mon(e)} ${e.getUTCDate()}, ${year}`;
}
