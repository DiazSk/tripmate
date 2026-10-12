"use client";

import { useEffect, useId, useRef } from "react";
import { initialsFor } from "@/lib/avatar";
import { guillochePaths } from "@/lib/paperPrint";
import { CROWD_CHOICES, GROUP_CHOICES, PACE_CHOICES, issuedDate, stampsFor, type StampKey, type WelcomeAnswers } from "@/lib/travelCard";
import { StampMark } from "./stamps";

/** Where each stamp lands: centre as % of the card, width as % of the card, and its tilt. */
const SPOTS: Record<"full" | "compact", Record<StampKey, { x: number; y: number; w: number; r: number }>> = {
  full: { group: { x: 73, y: 35, w: 25, r: -11 }, home: { x: 90, y: 33, w: 20, r: 13 }, pace: { x: 71, y: 74, w: 33, r: 4 }, loves: { x: 88, y: 62, w: 25, r: -9 } },
  compact: { group: { x: 64, y: 58, w: 21, r: -11 }, home: { x: 91, y: 40, w: 16, r: 12 }, pace: { x: 81, y: 66, w: 27, r: 5 }, loves: { x: 89, y: 84, w: 23, r: -7 } },
};

// Computed once per module, not per render: the rosette is ~67KB of path data.
const PRINT = guillochePaths(480, 330);

/**
 * The TripMate travel card: a passport data page on paper, the only paper object in a dark-glass app,
 * and the welcome's reward. Each answered step rubber-stamps it. Stamps are keyed by their label, so
 * a stamp already on the card stays put and only a new or changed answer presses a new one.
 */
export default function TravelCard({
  answers,
  image,
  issued,
  compact = false,
  complete = false,
}: {
  answers: WelcomeAnswers;
  image: string | null;
  issued: Date;
  compact?: boolean;
  complete?: boolean;
}) {
  const stamps = stampsFor(answers, issued);
  const signature = stamps.map((s) => s.label).join("|");
  // Per card, not per page: two cards mounted at once (compact and full) each keep their own filter.
  const inkId = `tm-ink-${useId().replace(/:/g, "")}`;
  const card = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  // The thud when a stamp lands: a class toggled on the element, so it needs no state and no render.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const el = card.current;
    if (!el) return;
    el.classList.remove("is-thud");
    void el.offsetWidth;
    el.classList.add("is-thud");
  }, [signature]);

  const group = GROUP_CHOICES.find((g) => g.id === answers.group);
  const pace = PACE_CHOICES.find((p) => p.id === answers.pace);
  const crowds = CROWD_CHOICES.find((c) => c.id === answers.crowds);
  const field = (label: string, value: string | undefined, extra = "") => (
    <div className={`travel-card-field ${extra}`}>
      <small>{label}</small>
      <span className={value ? "" : "is-empty"}>{value || "—"}</span>
    </div>
  );
  const spots = SPOTS[compact ? "compact" : "full"];

  return (
    <div ref={card} role="group" className={`travel-card ${compact ? "is-compact" : ""} ${complete ? "is-complete" : ""}`} aria-label="Your TripMate travel card">
      <svg className="travel-card-print" viewBox="0 0 480 330" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        {PRINT.map((d, i) => (
          <path key={i} d={d} fill="none" stroke={i < 2 ? "rgba(40,110,96,0.13)" : "rgba(122,90,60,0.09)"} strokeWidth="0.7" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <filter id={inkId} x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves={2} seed={7} result="grain" />
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.5 1.42" result="holes" />
          <feComposite in="SourceGraphic" in2="holes" operator="in" result="speckled" />
          <feTurbulence type="turbulence" baseFrequency="0.035" numOctaves={2} seed={3} result="warp" />
          <feDisplacementMap in="speckled" in2="warp" scale={1.3} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
      <span className="travel-card-perf" aria-hidden="true" />
      <div className="travel-card-head">
        <span className="travel-card-title">TripMate<small>Travel card</small></span>
        <span className="travel-card-no">No. TM {issued.getUTCFullYear()} {String(issued.getUTCMonth() + 1).padStart(2, "0")}{String(issued.getUTCDate()).padStart(2, "0")}</span>
      </div>
      <div className="travel-card-photo">
        {/* eslint-disable-next-line @next/next/no-img-element -- same-origin, versioned, 256px */}
        {image ? <img src={image} alt="" /> : initialsFor(answers.name)}
        <span className="travel-card-seal" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="rgba(60,45,30,0.42)" strokeWidth="2" strokeLinecap="round"><path d="M12 4v16M5 8l14 8M5 16l14-8" /></svg>
        </span>
      </div>
      <div className="travel-card-fields">
        {field("Holder", answers.name.trim() || "Traveller", "is-name")}
        {field("Travels with", group?.title)}
        {field("Rhythm", pace ? `${pace.label}${crowds ? `, ${crowds.label.toLowerCase()}` : ""}` : undefined)}
        {field("Loves", answers.loves.join(", ") || undefined)}
        {field("At the table", answers.diet.join(", ") || undefined)}
        {field("Home port", answers.home?.name, "is-home")}
      </div>
      <div className="travel-card-foot"><span>Issued {issuedDate(issued)}</span><span>Valid for every trip</span></div>
      <div className="travel-card-stamps">
        {stamps.map((s) => {
          const at = spots[s.key];
          return (
            <span key={`${s.key}-${s.label}`} className="travel-card-stamp" style={{ left: `${at.x}%`, top: `${at.y}%`, width: `${at.w}%`, ["--r" as string]: `${at.r}deg` }}>
              <StampMark stamp={s} inkId={inkId} />
            </span>
          );
        })}
      </div>
    </div>
  );
}
