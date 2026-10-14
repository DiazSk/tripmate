"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import dynamic from "next/dynamic";
import "./PolarLanding.css";
import { useScrollContainer } from "@/lib/scrollContainer";
import { planExamples, toPrefill, formatExampleParty, formatExampleSpan, resolveExampleDates, type PlanPrefill } from "@/lib/planExamples";
import { sceneBeats } from "@/lib/sceneBeats";
import { scrollToTarget, useLandingMotion } from "./motion";
import { PLAN_EVENT } from "@/lib/planIntent";

// The night map pulls in MapLibre, which the landing's first viewport never needs.
const NightMap = dynamic(() => import("./NightMap"), { ssr: false, loading: () => <div className="nm nm-pending" id="day" /> });

/**
 * The landing, on Polar Interior — the "TripMate — Polar Landing" design on the MagicPath canvas,
 * built into the app. It replaces the Blue Hour scroll story and hands off the same way: every
 * "plan" here calls `onPlan`, which is HomeView's `startPlanning`, so the wizard is unchanged.
 *
 * **Light, by opting in.** The root carries `data-appearance="light"`, the Polar Light scope in
 * globals.css; the night map and the footer are night by their own backgrounds. Everything else in
 * the app stays on Polar Night until its screen is redesigned.
 *
 * **Copy and data are the app's, not the canvas's.** The plans, their photographs and their
 * prefill come from `planExamples`, the four beats from `sceneBeats`. One canvas line said the
 * budget is "a target to hit, not a ceiling"; the planner does the opposite and says so on every
 * other surface, so the quote here is the app's own claim.
 */

type Dest = { id: string; word: string; coord: string; img: string };
const DESTS: Dest[] = [
  { id: "petra", word: "Petra", coord: "[ 30º 19’ 20” N, 35º 27’ 07” E ]", img: "/scenes/petra-treasury.webp" },
  { id: "engadin", word: "Engadin", coord: "[ 46º 29’ 52” N, 9º 50’ 17” E ]", img: "/scenes/graubunden-autumn-valley.webp" },
  { id: "tuscany", word: "Tuscany", coord: "[ 43º 03’ 54” N, 11º 36’ 41” E ]", img: "/scenes/tuscany-cypress-road.webp" },
  { id: "jaipur", word: "Jaipur", coord: "[ 26º 54’ 45” N, 75º 47’ 14” E ]", img: "/scenes/jaipur-amber-fort-elephant.webp" },
  { id: "sinaia", word: "Sinaia", coord: "[ 45º 21’ 00” N, 25º 33’ 00” E ]", img: "/scenes/peles-castle-romania-snow.webp" },
];

// The four plans' seasons, as the strip prints them. Presentation copy, keyed by the plan's id.
const SEASON: Record<string, string> = { tuscany: "Early autumn", jaipur: "Cool season", sinaia: "Deep winter", "wadi-rum": "Spring" };

// The same four steps HowItWorks states, in the same words.
const STEPS = [
  { n: "01", title: "You set the constraints", prose: "Where, when, how much, and who is going. The budget is a ceiling — the plan stays inside it rather than spending up to it." },
  { n: "02", title: "Real data goes in first", prose: "Forecast for your actual dates, public holidays, opening hours and travel times — fetched before a single word is written." },
  { n: "03", title: "Written, then critiqued", prose: "A second pass reviews the finished plan against your budget and pace, and rewrites the days it finds fault with." },
  { n: "04", title: "Every place is checked", prose: "Coordinates are corrected against OpenStreetMap, so the pins land where the place actually is rather than where the model guessed." },
];

const FACTS = [
  ["Forecast", "For your actual dates, up to 16 days out"],
  ["Holidays & hours", "Public holidays and opening times, fetched first"],
  ["Critiqued", "A second pass against your budget and pace"],
] as const;

const FOOT_PHOTO = "/scenes/wadi-rum-desert.webp";

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const todayISO = () => isoDay(new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())));

// The footer's "When": the next six months, keyed YYYY-MM, built in UTC so no timezone shifts one.
function nextMonths(n: number) {
  const now = new Date();
  return Array.from({ length: n }, (_, k) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + k + 1, 1));
    return { key: isoDay(d).slice(0, 7), label: d.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }) };
  });
}

/** A month picked in the footer opens the wizard on its first week — dates the traveller then sees and edits. */
function monthPrefill(where: string, month: string, adults: number, budget: number | null): PlanPrefill {
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { destination: where.trim(), startDate: isoDay(start), endDate: isoDay(end), adults, children: 0, ...(budget ? { budgetUsd: budget } : {}) };
}

export default function PolarLanding({ onPlan }: { onPlan: (prefill?: PlanPrefill) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLElement>(null);
  const scroller = useScrollContainer();
  // True only in the browser, without a setState-in-effect: the portal target is document.body.
  const inBrowser = useSyncExternalStore(noopSubscribe, () => true, () => false);
  useLandingMotion(rootRef, scroller);

  const [destId, setDestId] = useState("petra");
  const [plan, setPlan] = useState(0);
  const [howOpen, setHowOpen] = useState(false);
  const dest = DESTS.find((d) => d.id === destId)!;

  const [months] = useState(() => nextMonths(6));
  const [where, setWhere] = useState("");
  const [month, setMonth] = useState("");
  const [party, setParty] = useState(2);
  const [budget, setBudget] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  // The navbar's "Plan a trip" (and its phone menu's) can't reach HomeView, so it asks here.
  useEffect(() => {
    const plan = () => onPlan();
    window.addEventListener(PLAN_EVENT, plan);
    return () => window.removeEventListener(PLAN_EVENT, plan);
  }, [onPlan]);

  useEffect(() => {
    if (!howOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setHowOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [howOpen]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!where.trim()) next.where = "Tell us where you’re going.";
    if (!month) next.month = "Pick a month.";
    const amount = budget.trim() ? Number(budget) : null;
    if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) next.budget = "A budget in US dollars, or leave it blank.";
    setErrors(next);
    if (Object.keys(next).length === 0) onPlan(monthPrefill(where, month, party, amount));
  }

  const toForm = () => scrollToTarget(formRef.current);

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
        <section className="tm-hero" aria-label="TripMate" data-nav-theme="photo">
          <div className="tm-hero-media" aria-hidden="true">
            {DESTS.map((d) => (
              <Image key={d.id} src={d.img} alt="" fill sizes="100vw" priority={d.id === "petra"} className={`tm-hero-img${d.id === destId ? " is-on" : ""}`} />
            ))}
            <div className="tm-hero-scrim" />
            <div className="tm-hero-veil" />
          </div>

          <div className="tm-hero-mid">
            <p className="tm-hero-lead">A trip planned against your real dates, budget and weather.</p>
            {/* No "Plan a trip" here: the navbar carries the page's one, above the fold. */}
            <div className="tm-hero-actions">
              <button type="button" className="tm-ghost" onClick={() => scrollToTarget(document.getElementById("day"))}>
                Watch a day play <span aria-hidden="true">▸</span>
              </button>
            </div>
          </div>

          <div className="tm-hero-foot">
            <div className="tm-dest-row" role="radiogroup" aria-label="Destination">
              {DESTS.map((d) => (
                <button key={d.id} type="button" role="radio" aria-checked={d.id === destId} className="tm-dest" onClick={() => setDestId(d.id)}>
                  {d.word}
                </button>
              ))}
            </div>
            <span className="tm-coord tm-on-dark">{dest.coord}</span>
          </div>

          <div className="tm-monument-wrap">
            <h1 className="tm-monument" key={dest.id}>
              {dest.word}
            </h1>
          </div>
        </section>

        {/* ───── Intro ───── */}
        <section className="tm-intro" data-nav-theme="light">
          <p className="tm-kicker">The plan that already knows</p>
          <p className="tm-statement tm-scroll-fade">
            Forecast, holidays, opening hours and travel times go in first — before a single word of your plan is written.
          </p>
          <div className="tm-intro-cols">
            <div>
              <h2 className="tm-eyebrow">How a plan is made</h2>
            </div>
            <p className="tm-body">
              Tell TripMate where, when, how much and who is going. It fetches the real conditions for your dates, writes the days, then
              runs a second pass that critiques the finished plan against your budget and pace — and rewrites the days it finds fault with.
              Every pin is corrected against OpenStreetMap.
            </p>
          </div>
        </section>

        {/* ───── Sample plans ───── */}
        <section className="tm-plans" id="plans" data-nav-theme="light">
          <div className="tm-section-title">
            <h2 className="tm-display">Sample plans</h2>
          </div>
          {/* The rows only apply below 760px, where the strip is a grid; on desktop it is flex and
              this declaration is inert. */}
          <div className="tm-strip" style={{ gridTemplateRows: planExamples.map((_, i) => (i === plan ? "34em" : "4.5em")).join(" ") }}>
            {planExamples.map((p, i) => {
              const open = i === plan;
              const { startDate, endDate } = resolveExampleDates(p.startMonthDay, p.days, todayISO());
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
                      <button type="button" className="tm-signal" tabIndex={open ? 0 : -1} onClick={() => onPlan(toPrefill(p, todayISO()))}>
                        <span className="tm-signal-label">Plan one like it</span>
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* ───── A day on the map ───── */}
        {/* A stable box for the motion to hold: NightMap is a lazy import, so the element it renders
            replaces its loading placeholder after the scroll effects are already bound. */}
        <div className="tm-night" data-nav-theme="photo">
          <NightMap />
        </div>

        {/* ───── Quote ───── */}
        <section className="tm-quote" data-nav-theme="light">
          <figure>
            <span className="tm-quote-mark" aria-hidden="true">
              “
            </span>
            <blockquote className="tm-scroll-fade">
              The budget is a ceiling, not a target. Say what you can spend, and the plan stays inside it rather than spending up to it.
            </blockquote>
            <figcaption>
              <span className="tm-dash" aria-hidden="true">
                -
              </span>
              <span className="tm-ui">How TripMate plans</span>
              <span className="tm-caption">Step 01 · You set the constraints</span>
            </figcaption>
          </figure>
        </section>

        {/* ───── What a plan knows ───── */}
        <section className="tm-knows" id="knows" data-nav-theme="light">
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

        {/* ───── Footer — Variant B "Monument" ───── */}
        <footer className="tm-fb" ref={formRef} id="plan" data-nav-theme="photo">
          <div className="tm-fb-photo" aria-hidden="true">
            <Image src={FOOT_PHOTO} alt="" fill sizes="100vw" />
          </div>
          <div className="tm-fb-scrim" aria-hidden="true" />

          <div className="tm-fb-inner">
            <div className="tm-fb-top">
              <p className="tm-kicker">Where to next?</p>
              <span className="tm-coord tm-on-dark">[ 29º 35’ 00” N, 35º 25’ 00” E ] · Wadi Rum</span>
            </div>

            <section className="tm-fb-cta" aria-labelledby="tm-fb-title">
              <div className="tm-fb-line">
                <h2 className="tm-fb-title" id="tm-fb-title">
                  Plan a trip
                </h2>
                <span className="tm-fb-sub">Free · no account needed · drafts until you keep them</span>
              </div>

              <form className="tm-fb-glass tm-fb-form" onSubmit={submit} noValidate>
                <label className={`tm-fb-field${errors.where ? " has-err" : ""}`}>
                  <span>Where</span>
                  <input className="tm-fb-input" value={where} onChange={(e) => setWhere(e.target.value)} placeholder="A city, region or country" aria-invalid={!!errors.where} maxLength={120} />
                  {errors.where && <em>{errors.where}</em>}
                </label>
                <label className={`tm-fb-field${errors.month ? " has-err" : ""}`}>
                  <span>When</span>
                  <select className="tm-fb-input tm-fb-select" value={month} onChange={(e) => setMonth(e.target.value)} aria-invalid={!!errors.month}>
                    <option value="">Choose a month</option>
                    {months.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  {errors.month && <em>{errors.month}</em>}
                </label>
                <div className="tm-fb-field">
                  <span id="tm-fb-party">Travellers</span>
                  <div className="tm-stepper" role="group" aria-labelledby="tm-fb-party">
                    <button type="button" aria-label="Fewer travellers" onClick={() => setParty((p) => Math.max(1, p - 1))} disabled={party <= 1}>
                      −
                    </button>
                    <output aria-live="polite">{party}</output>
                    <button type="button" aria-label="More travellers" onClick={() => setParty((p) => Math.min(12, p + 1))} disabled={party >= 12}>
                      +
                    </button>
                  </div>
                </div>
                {/* Budget rather than a tier toggle: the planner derives the tier from the budget
                    (`closestTier`), so a tier picked here would be a question nothing listens to. */}
                <label className={`tm-fb-field${errors.budget ? " has-err" : ""}`}>
                  <span>Budget</span>
                  <input className="tm-fb-input" value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d]/g, ""))} placeholder="US $, optional" inputMode="numeric" aria-invalid={!!errors.budget} />
                  {errors.budget && <em>{errors.budget}</em>}
                </label>
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
              <a className="tm-fb-link" href="#plans">
                Sample plans
              </a>
              <a className="tm-fb-link" href="#day">
                A day on the map
              </a>
              <a className="tm-fb-link" href="#knows">
                What a plan knows
              </a>
              <span className="tm-fb-spacer" />
              <a className="tm-fb-link" href="/trips">
                Memories
              </a>
              <a className="tm-fb-link" href="/profile">
                Profile
              </a>
              <span className="tm-caption tm-on-dark-2">Photography via Pexels and Unsplash</span>
            </nav>
          </div>

          <p className="tm-fb-monument" aria-hidden="true">
            TripMate
          </p>
        </footer>

        {/* ───── How it works sheet ───── */}
        <button type="button" className="tm-tab" onClick={() => setHowOpen(true)} aria-haspopup="dialog" aria-expanded={howOpen}>
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
            <button type="button" className="tm-quiet" onClick={() => setHowOpen(false)} tabIndex={howOpen ? 0 : -1}>
              Close
            </button>
          </div>
          <ol className="tm-steps">
            {STEPS.map((s) => (
              <li key={s.n}>
                <span className="tm-step-n">{s.n}.</span>
                <h3 className="tm-step-title">{s.title}</h3>
                <p className="tm-body">{s.prose}</p>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="tm-signal tm-signal-lg"
            tabIndex={howOpen ? 0 : -1}
            onClick={() => {
              setHowOpen(false);
              toForm();
            }}
          >
            <span className="tm-signal-label">Plan a trip</span>
          </button>
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
