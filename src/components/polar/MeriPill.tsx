"use client";

import { useEffect, useEffectEvent, useImperativeHandle, useRef, useState, type RefObject } from "react";
import InlineNote from "@/components/InlineNote";
import Meridian from "@/components/Meridian";
import { useHold } from "@/lib/actionHolds";
import { track } from "@/lib/analytics/client";
import { holdFromFailure, type Failure } from "@/lib/failure";
import { ideaFailureCopy, loadReadyTrips, readIdea, understoodNothing, type IdeaOutcome } from "@/lib/ideaClient";
import { IDEA_MAX_CHARS, type IdeaRead } from "@/lib/ideaRead";
import {
  ideaHeadline,
  ideaToPrefill,
  matchTrips,
  QUICK_PROMPTS,
  readyTripToPrefill,
  TYPEWRITER_IDEAS,
  typewriterTick,
  type Typewriter,
} from "@/lib/homeIdeas";
import type { MeridianState } from "@/lib/meri";
import type { PlanPrefill } from "@/lib/planExamples";
import type { ReadyTrip } from "@/lib/readyTrips";
import "./MeriPill.css";

export type PlanEntry = "meri" | "step_by_step" | "ready_made";

type Phase =
  | { kind: "idle" }
  | { kind: "blank" }
  | { kind: "reading" }
  /** `trips` is null until the catalogue has answered, and stays [] when it is unavailable. */
  | { kind: "read"; read: IdeaRead; trips: ReadyTrip[] | null }
  | { kind: "nothing" }
  | { kind: "failed"; failure: Failure };

/** The hero follows the sentence this long after typing stops, so the photograph does not flicker per key. */
const TEXT_SETTLE_MS = 260;

const BLANK_NUDGE = "Tell Meri a place, a length or a feeling, and she’ll fill in the planner.";
/** PH-02: a 200 with no place, kind or length. */
const NOTHING_UNDERSTOOD = "Meri couldn’t tell where or how long. Say a place, or how many days.";

const today = () => new Date().toISOString().slice(0, 10);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** What the reading found, under the planner's own labels, and nothing it did not. */
function readFields(r: IdeaRead): [string, string][] {
  const who = [r.adults !== null ? plural(r.adults, "adult") : "", r.children ? plural(r.children, "child", "children") : ""]
    .filter(Boolean)
    .join(", ");
  const rows: [string, string | false][] = [
    ["Where", r.destination ?? false],
    ["Length", r.days !== null && plural(r.days, "day")],
    ["Budget", r.budget !== null && `${usd(r.budget)}${r.budgetBasis === "per_person" ? " per person" : ""}`],
    ["Who", who || false],
    ["Pace", r.pace ? r.pace[0].toUpperCase() + r.pace.slice(1) : false],
    ["Into", r.interests.join(", ") || false],
  ];
  return rows.filter((row): row is [string, string] => Boolean(row[1]));
}

/**
 * Meri's sentence box on the landing (spec: docs/superpowers/specs/2026-10-23-landing-meri-pill-design.md),
 * with what it shows under itself (the example prompts, the reading, a failure) and the equal
 * "Plan step by step" under all of it. One centred group: the hero positions it, this sizes it.
 */
export default function MeriPill({
  onPlan,
  onText,
  onRead,
  onOpenChange,
  focusRef,
}: {
  onPlan: (prefill: PlanPrefill | undefined, entry: PlanEntry) => void;
  /** The settled text, for the hero to follow. */
  onText: (text: string) => void;
  /** A usable reading, or null when it stops standing (Change, Escape, a new send). */
  onRead: (read: IdeaRead | null) => void;
  onOpenChange: (open: boolean) => void;
  focusRef?: RefObject<{ focus(): void } | null>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const inflight = useRef<AbortController | null>(null);
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const holdLeft = useHold("idea").secondsLeft;
  const held = holdLeft !== null;
  // The server's own numbers from the 429 that started the hold, for SV-25's sentence on a held send.
  const lastLimit = useRef<Extract<Failure, { kind: "rate_limited" }> | null>(null);
  // A sentence in the box keeps the pill open after focus leaves it: it is still the trip being asked about.
  const open = focused || text !== "";
  const busy = phase.kind === "reading";

  const focusPill = () => {
    setFocused(true);
    input.current?.focus();
  };
  useImperativeHandle(focusRef, () => ({ focus: focusPill }));

  const reportText = useEffectEvent((t: string) => onText(t));
  useEffect(() => {
    const t = setTimeout(() => reportText(text), TEXT_SETTLE_MS);
    return () => clearTimeout(t);
  }, [text]);

  const reportOpen = useEffectEvent((o: boolean) => onOpenChange(o));
  useEffect(() => reportOpen(open), [open]);

  // The nudge belongs to the open pill; closing takes it away.
  const close = () => {
    setFocused(false);
    setPhase((p) => (p.kind === "blank" ? { kind: "idle" } : p));
  };

  // Only an untouched pill closes on a click elsewhere; one holding a sentence stays as it is.
  useEffect(() => {
    if (!focused || text) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [focused, text]);

  useEffect(() => () => inflight.current?.abort(), []);

  const answered = (c: AbortController, out: Exclude<IdeaOutcome, { aborted: true }>) => {
    if (!out.ok) {
      holdFromFailure(out.failure);
      if (out.failure.kind === "rate_limited") lastLimit.current = out.failure;
      setPhase({ kind: "failed", failure: out.failure });
      track("idea_answered", { branch: out.failure.kind === "offline" ? "offline" : "error", matches: 0 });
      return;
    }
    const read = out.read;
    if (understoodNothing(read)) {
      setPhase({ kind: "nothing" });
      track("idea_answered", { branch: "nothing_understood", matches: 0 });
      return;
    }
    setPhase({ kind: "read", read, trips: null });
    onRead(read);
    void loadReadyTrips().then((all) => {
      // A send or Escape before the catalogue answers drops this read's idea_answered: accepted drift.
      if (inflight.current !== c) return;
      const trips = matchTrips(all, read);
      setPhase((p) => (p.kind === "read" && p.read === read ? { ...p, trips } : p));
      track("idea_answered", { branch: "read", matches: trips.length });
      // An empty catalogue (Sanity unavailable) matches nothing for a reason that is not the sentence.
      if (!trips.length && all.length) {
        track("idea_unmatched", { destination: read.destination, kind: read.kind, tags: read.tags.join(","), days: read.days });
      }
    });
  };

  const send = async (idea = text) => {
    const t = idea.trim();
    if (!t) {
      setPhase({ kind: "blank" });
      return;
    }
    if (held) {
      const base = lastLimit.current ?? { kind: "rate_limited", bucket: "idea", retryAfterSeconds: 0, limit: 0, windowMinutes: 0 };
      setPhase({ kind: "failed", failure: { ...base, retryAfterSeconds: holdLeft } });
      return;
    }
    inflight.current?.abort();
    const c = new AbortController();
    inflight.current = c;
    onRead(null);
    const offline = !navigator.onLine;
    track("idea_sent", { chars: t.length, offline });
    setPhase({ kind: "reading" });
    // No signal means no request: the answer is already known.
    const out: IdeaOutcome = offline ? { ok: false, failure: { kind: "offline" } } : await readIdea(t, c.signal);
    // A newer send (or Escape) superseded this one: its answer must never replace the newer state.
    if (inflight.current !== c || "aborted" in out) return;
    answered(c, out);
  };

  const reset = () => {
    inflight.current?.abort();
    inflight.current = null;
    setText("");
    setPhase({ kind: "idle" });
    setFocused(false);
    onRead(null);
    if (root.current?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  };

  const change = () => {
    setPhase({ kind: "idle" });
    onRead(null);
    focusPill();
  };

  const failure = phase.kind === "failed" ? phase.failure : null;
  const failText = failure ? ideaFailureCopy(failure) : phase.kind === "nothing" ? NOTHING_UNDERSTOOD : "";
  // Resending what was refused, or what Meri could not use, gets the same answer: those reopen the sentence.
  const resend = failure && (failure.kind === "timeout" || failure.kind === "server" || failure.kind === "offline" || failure.kind === "rate_limited");
  const meri: MeridianState =
    phase.kind === "reading" ? "thinking"
    : phase.kind === "read" ? "success"
    : failure?.kind === "offline" ? "offline"
    : failText ? "error"
    : "idle";

  return (
    <div
      ref={root}
      className="mp"
      onKeyDown={(e) => {
        // Escape during an IME composition cancels the composition, not the sentence.
        if (e.key === "Escape" && !e.nativeEvent.isComposing) reset();
      }}
      // Tabbing out of an untouched pill closes it, as a click elsewhere does. A null relatedTarget
      // (a pointer press) is left to the pointerdown listener, which knows where the press landed.
      onBlur={(e) => {
        if (!text && e.relatedTarget && !root.current?.contains(e.relatedTarget)) close();
      }}
    >
      <form
        className={`mp-pill${open ? " is-open" : ""}`}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        onClick={focusPill}
      >
        <Meridian state={meri} size={38} />
        <label className="mp-field">
          <span className="sr-only">Tell Meri the trip you want</span>
          <input
            ref={input}
            className="mp-input"
            value={text}
            maxLength={IDEA_MAX_CHARS}
            enterKeyHint="go"
            autoComplete="off"
            onChange={(e) => {
              setText(e.target.value);
              if (phase.kind === "blank") setPhase({ kind: "idle" });
            }}
            onFocus={() => setFocused(true)}
            onKeyDown={(e) => {
              // Enter that confirms an IME composition is not a send. Safari reports it after
              // compositionend, with isComposing false and keyCode 229.
              if (e.key === "Enter" && (e.nativeEvent.isComposing || e.keyCode === 229)) e.preventDefault();
            }}
          />
          {!text && <Ghost open={open} />}
        </label>
        {/* Never disabled: a disabled default button also blocks Enter, and a corrected sentence sent
            mid-read must replace the read in flight. */}
        <button
          type="submit"
          className="mp-go"
          aria-busy={busy || undefined}
          aria-label={busy ? "Meri is reading. Send again to replace it" : "Ask Meri"}
        >
          {busy ? <span className="mp-spin" aria-hidden="true" /> : <span aria-hidden="true">→</span>}
        </button>
      </form>

      <div className="mp-under">
        {phase.kind === "blank" && (
          <p className="mp-nudge" role="alert">
            {BLANK_NUDGE}
          </p>
        )}
        {focused && !text && (phase.kind === "idle" || phase.kind === "blank") && (
          <div className="mp-prompts">
            {QUICK_PROMPTS.map((q) => (
              <button
                key={q.label}
                type="button"
                className="mp-prompt"
                onClick={() => {
                  setText(q.text);
                  void send(q.text);
                }}
              >
                {q.label}
              </button>
            ))}
          </div>
        )}
        <div aria-live="polite">
          {phase.kind === "read" && (
            <Reading
              read={phase.read}
              trips={phase.trips ?? []}
              onChange={change}
              onOpen={() => onPlan(ideaToPrefill(phase.read, today()), "meri")}
              onTrip={(trip) => {
                track("ready_trip_used", { slug: trip.slug, how: "use_plan" });
                onPlan(readyTripToPrefill(trip, phase.read, today()), "ready_made");
              }}
            />
          )}
        </div>
        {/* Kept mounted and only its words change, so the alert is announced (see InlineNote). */}
        {/* A dark island: the landing is a light scope, and this sits on night glass over the photograph. */}
        <div className={`mp-fail${failText ? " is-on" : ""}`} role="alert" data-appearance="dark">
          <InlineNote
            size="item"
            tone="error"
            code={failure ? failure.kind : phase.kind === "nothing" ? "nothing_understood" : undefined}
            surface="/"
            live={false}
            action={
              failText && failure?.kind !== "daily_cap"
                ? { label: "Try again", onClick: resend ? () => void send() : change, busy: held && failure?.kind === "rate_limited" }
                : undefined
            }
          >
            {failText}
          </InlineNote>
          {failText && (
            <button type="button" className="err-btn err-btn-text" onClick={() => onPlan(undefined, "step_by_step")}>
              Plan step by step
            </button>
          )}
        </div>
      </div>

      <div className="mp-steps-row">
        <button type="button" className="mp-steps" onClick={() => onPlan(undefined, "step_by_step")}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M3 4h10M3 8h7M3 12h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          Plan step by step <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  );
}

/** The placeholder: example ideas typing themselves at a closed pill, a plain prompt at an open one. */
function Ghost({ open }: { open: boolean }) {
  const [tw, setTw] = useState<Typewriter>({ line: 0, chars: 0, phase: "typing" });
  useEffect(() => {
    // Under reduced motion nothing types; the fallback below stands still.
    if (open || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const { next, delayMs } = typewriterTick(tw, TYPEWRITER_IDEAS);
    const t = setTimeout(() => setTw(next), delayMs);
    return () => clearTimeout(t);
  }, [open, tw]);
  const typed = TYPEWRITER_IDEAS[tw.line].slice(0, tw.chars);
  return (
    <span aria-hidden="true" className={`mp-ghost${open ? "" : " is-typing"}`}>
      {open ? "Where, how long, who with, how much…" : typed || "Ask Meri"}
    </span>
  );
}

/** What Meri read, as the planner's fields, with the ready-made trips it is close to. */
function Reading({
  read,
  trips,
  onChange,
  onOpen,
  onTrip,
}: {
  read: IdeaRead;
  trips: ReadyTrip[];
  onChange: () => void;
  onOpen: () => void;
  onTrip: (trip: ReadyTrip) => void;
}) {
  const fields = readFields(read);
  return (
    <div className="mp-card">
      <p className="mp-headline">{ideaHeadline(read)}</p>
      {fields.length > 0 && (
        <dl className="mp-fields">
          {fields.map(([k, v]) => (
            <div key={k}>
              <dt className="mp-kicker">{k}</dt>
              <dd className="mp-value">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {trips.length > 0 && (
        <p className="mp-close">
          Close to
          {trips.map((t) => (
            <button key={t.slug} type="button" className="mp-trip" onClick={() => onTrip(t)}>
              {t.monument} · {plural(t.days, "day")} · {usd(t.priceFrom)}
            </button>
          ))}
        </p>
      )}
      <div className="mp-card-foot">
        <button type="button" className="mp-change" onClick={onChange}>
          Change
        </button>
        <button type="button" className="mp-open" onClick={onOpen}>
          Open in the planner <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  );
}
