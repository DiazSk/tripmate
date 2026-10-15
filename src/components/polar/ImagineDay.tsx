"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import "./ImagineDay.css";
import { scrollToTarget } from "./motion";
import { dayCost, LENS_ORDER, LENSES, PETRA_BEATS, PETRA_PHOTOS, type LensId, type PetraPhoto } from "@/lib/petraDay";

/**
 * "A day you can imagine": the hero's spectacle brought close (a day that plays as you scroll, the
 * page keeping the sky's time), then the same day four ways. The plan behind it is PlanGlobe.
 * All of it is one sample day in Petra, from `src/lib/petraDay.ts`, which the phone app shares.
 */

const photo = (k: PetraPhoto) => `/scenes/${PETRA_PHOTOS[k]}`;
const d = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

// The scroll reveal lives with the rest of the page motion now; PolarLanding and PlanGlobe import it from here.
export { useReveal } from "./motion";

/* ---------------------------------------------------------- picture a day */

// Each beat is a stop in the slow plan, so the story and the plan are the same day told twice.
const LAST = PETRA_BEATS.length - 1;

export function Day({ onOpenStop }: { onOpenStop: (stop: string) => void }) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLElement | null)[]>([]);
  const beat = PETRA_BEATS[active];
  const sky = beat.sky;

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setActive(Number((e.target as HTMLElement).dataset.i))),
      { rootMargin: "-48% 0px -48% 0px" }
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    // One id over both bands, so the navbar's "A day in Petra" stays lit through the whole story.
    <div id="day">
      <section className="bg-white" data-nav-theme="light">
        <div className="mx-auto grid max-w-[1440px] gap-8 px-4 pb-16 pt-28 md:grid-cols-12 md:pb-24 md:pl-8 md:pr-20 md:pt-40">
          <p className="pl-eyebrow text-[var(--signal-text)] md:col-span-3" data-reveal>
            Picture a day
          </p>
          <div className="md:col-span-9">
            <h2 className="pl-display max-w-[16ch] text-[clamp(40px,5.6vw,88px)]" data-reveal>
              What would a day here actually feel like?
            </h2>
            <p className="mt-8 max-w-[52ch] text-[18px] leading-[1.55] text-[var(--charcoal)]" data-reveal style={d(120)}>
              Not the sights, the hours. Here is one Wednesday in Petra, from the first coffee to the last candle, told the way you
              would remember it.
            </p>
          </div>
        </div>
      </section>

      {/* The navbar goes dark with the sky on the night beat, and stays light over the day's paper. */}
      <section
        className="pl-sky relative"
        style={{ backgroundColor: sky.bg, color: sky.fg }}
        aria-label="One day in Petra, morning to evening"
        data-nav-theme={active === LAST ? "dark" : "light"}
      >
        <div className="mx-auto grid max-w-[1440px] gap-10 px-4 md:grid-cols-[1.08fr_.92fr] md:gap-16 md:pl-8 md:pr-20">
          <div className="sticky top-0 hidden h-[100svh] items-center md:flex">
            <figure className="relative h-[calc(100svh-4rem)] w-full overflow-hidden rounded-[4px] bg-[var(--night)]">
              {PETRA_BEATS.map((b, i) => (
                <Image key={b.stop} src={photo(b.photo)} alt="" fill sizes="55vw" className={`pl-frame-img object-cover ${i === active ? "is-on" : ""}`} />
              ))}
              <figcaption className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-[linear-gradient(0deg,rgba(9,11,16,.7),transparent)] p-5 pt-16 text-white">
                <span key={active} className="pl-swap">
                  <span className="pl-label block text-[13px] text-white/90">
                    {beat.part} · <span className="pl-tnum">{beat.time}</span>
                  </span>
                  <span className="pl-lead block text-[22px]">{beat.caption}</span>
                </span>
                <span className="pl-tnum text-[13px] text-white/90">
                  {String(active + 1).padStart(2, "0")} / {String(PETRA_BEATS.length).padStart(2, "0")}
                </span>
              </figcaption>
            </figure>
          </div>

          <div className="py-10 md:py-[22svh]">
            <ol className="sticky top-8 z-10 mb-10 hidden grid-cols-5 gap-1.5 md:grid" aria-hidden>
              {PETRA_BEATS.map((b, i) => (
                <li key={b.stop}>
                  <span className="pl-tick block h-[2px]" style={{ backgroundColor: i <= active ? sky.fg : sky.rule }} />
                  <span className="pl-label mt-2 block text-[11px]" style={{ color: i === active ? sky.fg : sky.fg2 }}>
                    {b.part}
                  </span>
                </li>
              ))}
            </ol>
            {PETRA_BEATS.map((b, i) => (
              <article
                key={b.stop}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                data-i={i}
                className={`pl-beat flex flex-col justify-center py-10 md:min-h-[78svh] ${i === active ? "is-on" : ""}`}
              >
                <div className="relative mb-6 aspect-[4/5] w-full overflow-hidden rounded-[4px] md:hidden">
                  <Image src={photo(b.photo)} alt="" fill sizes="100vw" className="object-cover" />
                </div>
                <p className="pl-label text-[14px]" style={{ color: sky.fg2 }}>
                  {b.part} · <span className="pl-tnum">{b.time}</span>
                </p>
                <h3 className="pl-serif mt-3 text-[clamp(36px,4.2vw,64px)] leading-[1.02]">{b.line}</h3>
                <p className="mt-5 max-w-[42ch] text-[18px] leading-[1.55]" style={{ color: sky.fg2 }}>
                  {b.body}
                </p>
                <button
                  type="button"
                  onClick={() => onOpenStop(b.stop)}
                  className="mt-6 w-fit text-[14px] font-semibold underline decoration-1 underline-offset-[6px] hover:decoration-2"
                >
                  See this stop in the plan →
                </button>
              </article>
            ))}
            <p className="pl-lead border-t pt-8 text-[26px] leading-[1.25]" style={{ borderColor: sky.rule }}>
              That was the slow way.
              <br />
              <button
                type="button"
                onClick={() => scrollToTarget(document.getElementById("ways"))}
                className="underline decoration-1 underline-offset-[6px]"
              >
                There are three others.
              </button>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

/* --------------------------------------------------------- make it yours */

export function Ways({ lens, setLens }: { lens: LensId; setLens: (l: LensId) => void }) {
  return (
    <section id="ways" className="bg-white" data-nav-theme="light">
      <div className="mx-auto max-w-[1440px] px-4 py-24 md:py-36 md:pl-8 md:pr-20">
        <div className="grid gap-8 md:grid-cols-12">
          <p className="pl-eyebrow text-[var(--signal-text)] md:col-span-3" data-reveal>
            Make it yours
          </p>
          <div className="md:col-span-9">
            <h2 className="pl-display max-w-[14ch] text-[clamp(40px,5.6vw,88px)]" data-reveal>
              The same day, four ways.
            </h2>
            <p className="mt-8 max-w-[50ch] text-[18px] leading-[1.55] text-[var(--charcoal)]" data-reveal style={d(120)}>
              Same valley, same Wednesday. Tell TripMate how you like to travel and the day rearranges itself around it. Pick one and
              the plan below follows.
            </p>
          </div>
        </div>

        <div role="radiogroup" aria-label="How you like to travel" className="mt-14 grid grid-cols-2 gap-3 md:mt-20 md:grid-cols-4 md:gap-4">
          {LENS_ORDER.map((id, i) => {
            const x = LENSES[id];
            const on = id === lens;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setLens(id)}
                data-reveal
                style={d(i * 90)}
                className={`pl-lens group overflow-hidden rounded-[4px] border text-left ${on ? "border-[var(--ink)]" : "border-[var(--rule)] hover:border-[var(--ink)]"}`}
              >
                <div className="relative aspect-[4/5] overflow-hidden bg-[var(--paper)]">
                  <Image src={photo(x.photo)} alt="" fill sizes="(min-width: 768px) 25vw, 50vw" className="object-cover" />
                  <span
                    className={`absolute left-3 top-3 rounded-[2px] px-2 py-1 text-[12px] font-semibold transition-colors duration-300 ${on ? "bg-[var(--signal)] text-[var(--ink)]" : "bg-white/90 text-[var(--ink)]"}`}
                  >
                    {on ? "Selected" : x.short}
                  </span>
                </div>
                <div className={`p-4 transition-colors duration-300 md:p-5 ${on ? "bg-[var(--ink)] text-white" : "bg-white"}`}>
                  <span className="pl-serif block text-[24px] leading-[1.05] md:text-[30px]">{x.name}</span>
                  <span className={`mt-1 block text-[14px] ${on ? "text-white/85" : "text-[var(--charcoal)]"}`}>{x.line}</span>
                </div>
              </button>
            );
          })}
        </div>

        <div key={lens} className="pl-swap mt-10 grid gap-6 border-t border-[var(--rule)] pt-8 md:grid-cols-12" aria-live="polite">
          <p className="pl-label text-[14px] text-[var(--charcoal)] md:col-span-3">What changes</p>
          <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-3 md:col-span-9">
            {LENSES[lens].changes.map((c) => (
              <li key={c} className="pl-lead text-[24px] leading-[1.2]">
                {c}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- sheet */

/**
 * "Open this day in the planner": what the day carries into the wizard, and the one thing it asks
 * (how many adults). Portalled into a `.tm-layer` like the How-it-works sheet, so it sits above the
 * navbar and outside the content overlay's stacking context.
 */
export function OpenSheet({
  lens,
  when,
  onClose,
  onOpen,
}: {
  lens: LensId;
  /** The sample day, formatted ("Wed 14 Apr 2027"). */
  when: string;
  onClose: () => void;
  onOpen: (adults: number) => void;
}) {
  const [adults, setAdults] = useState(2);
  const first = useRef<HTMLButtonElement>(null);
  const L = LENSES[lens];

  useEffect(() => {
    first.current?.focus();
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  return createPortal(
    <div className="tm tm-layer" data-appearance="light">
      <div className="pl flex items-end justify-center md:items-center" style={{ position: "fixed", inset: 0 }} data-lenis-prevent>
        <button type="button" aria-label="Close" onClick={onClose} className="pl-scrim absolute inset-0 bg-[rgba(9,11,16,.6)]" />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="pl-sheet-title"
          className="pl-sheet relative w-full max-w-[520px] rounded-t-[6px] bg-white p-6 text-[var(--ink)] md:rounded-[6px] md:p-8"
        >
          <p className="pl-label text-[13px] text-[var(--charcoal)]">Open in the planner</p>
          <p id="pl-sheet-title" className="pl-serif mt-2 text-[36px] leading-[1.02]">
            This day comes with you.
          </p>
          <dl className="pl-tnum mt-6 divide-y divide-[var(--rule)] border-y border-[var(--rule)] text-[15px]">
            {[
              ["Where", "Petra, Jordan"],
              ["When", `${when} · day 2`],
              ["The way", L.name],
              ["Estimate", `$${dayCost(L.stops)} per person`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 py-3">
                <dt className="text-[var(--charcoal)]">{k}</dt>
                <dd className="text-right font-semibold">{v}</dd>
              </div>
            ))}
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-[var(--charcoal)]">Travellers</dt>
              <dd className="flex items-center gap-3">
                <button
                  type="button"
                  aria-label="One fewer adult"
                  disabled={adults <= 1}
                  onClick={() => setAdults((a) => a - 1)}
                  className="grid h-8 w-8 place-items-center rounded-[2px] border border-[var(--rule)] hover:border-[var(--ink)] disabled:opacity-40"
                >
                  −
                </button>
                <span className="w-16 text-center font-semibold" aria-live="polite">
                  {adults} {adults === 1 ? "adult" : "adults"}
                </span>
                <button
                  type="button"
                  aria-label="One more adult"
                  disabled={adults >= 8}
                  onClick={() => setAdults((a) => a + 1)}
                  className="grid h-8 w-8 place-items-center rounded-[2px] border border-[var(--rule)] hover:border-[var(--ink)] disabled:opacity-40"
                >
                  +
                </button>
              </dd>
            </div>
          </dl>
          <div className="mt-7 flex gap-3">
            <button type="button" onClick={onClose} className="pl-ghost flex-1 px-5 py-3.5 text-[15px] hover:bg-[var(--paper)]">
              Not yet
            </button>
            <button ref={first} type="button" onClick={() => onOpen(adults)} className="pl-cta flex-[1.4] px-5 py-3.5 text-[15px]">
              Open the planner
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
