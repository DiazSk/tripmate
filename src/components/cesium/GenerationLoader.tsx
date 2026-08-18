"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  STAGE_ORDER,
  STAGE_SECONDS,
  generationProgress,
  stageMeta,
  type StageId,
  type StageProgress,
} from "@/lib/generationStages";

/** Each word is split into individual <span>s so every letter can carry its own
 *  staggered animation-delay — see the `.loader-letter:nth-child(n)` rules in
 *  globals.css, which cover exactly 10 letters. **Every word here must be 10
 *  characters long**, or those rules need extending to match. The assertion below
 *  is what turns that from a comment into something that fails loudly. */
const WORD = {
  generate: { word: "Generating", baseLabel: "Generating your itinerary" },
  refine: { word: "Rethinking", baseLabel: "Reworking your itinerary" },
} as const;

if (process.env.NODE_ENV !== "production") {
  for (const [mode, { word }] of Object.entries(WORD)) {
    if (word.length !== 10) {
      console.error(
        `GenerationLoader: "${word}" (${mode}) is ${word.length} letters. globals.css only staggers 10.`
      );
    }
  }
}

const CAPTION_INTERVAL_MS = 2500;
/** How often the progress value is recomputed and written to the CSS custom property. */
const PROGRESS_TICK_MS = 100;

/** How many facts are on screen together, and how long a set is held before the next one. */
const FACTS_VISIBLE = 3;
const FACT_SET_MS = 9000;
/** How long before Cancel is offered. */
const CANCEL_AFTER_MS = 10000;

/** Left edge of each stage's segment as a percentage, from the same weights the progress
 *  math uses, so the ticks and the fill can't disagree about where a stage begins. */
function waypointPercents(stages: readonly StageProgress[]): number[] {
  const live = stages.filter((s) => s.status !== "skipped");
  const total = live.reduce((sum, s) => sum + STAGE_SECONDS[s.stage], 0) || 1;
  let acc = 0;
  return live.map((s) => {
    const at = (acc / total) * 100;
    acc += STAGE_SECONDS[s.stage];
    return at;
  });
}

function activeStageId(stages: readonly StageProgress[]): StageId {
  const inProgress = stages.find((s) => s.status === "start");
  if (inProgress) return inProgress.stage;
  // Nothing in progress means either the stream just opened (all pending) or every stage
  // has settled. Falling back to stages[0] would caption both states with the FIRST stage —
  // wrong for refine, which never runs geocode, and wrong at the end of a run, where all
  // five dots are green next to a "finding your destination" pill. Prefer the furthest
  // stage actually reached, and never caption a stage that was skipped.
  const lastDone = [...stages].reverse().find((s) => s.status === "done");
  if (lastDone) return lastDone.stage;
  const firstUnskipped = stages.find((s) => s.status !== "skipped");
  return firstUnskipped?.stage ?? stages[0]?.stage ?? STAGE_ORDER[0];
}

/** The wait indicator for any long model call — shows only while `active`, rendering the
 *  five real generation stages (generationStages.ts) with their live status, plus a caption
 *  that rotates within whichever stage is currently running. Floats centered over the globe. */
export default function GenerationLoader({
  active,
  mode = "generate",
  stages,
  facts = [],
  subject,
  onCancel,
}: {
  active: boolean;
  mode?: keyof typeof WORD;
  stages: StageProgress[];
  /** True, trip-specific lines from `buildDestinationFacts`. Purely presentational here —
   *  this component never fetches and knows nothing about where they came from. */
  facts?: string[];
  /** What is being generated, e.g. "Kyoto · Sep 19–22 · Mid-range". The form unmounts during
   *  generation, so without this the screen never once names the trip it is working on. */
  subject?: string;
  /** Aborts the run and returns to the form. Omit it and no cancel is offered. */
  onCancel?: () => void;
}) {
  const { word, baseLabel } = WORD[mode];
  const activeId = activeStageId(stages);
  const [index, setIndex] = useState(0);

  // --- Progress -------------------------------------------------------------------------
  // The value is written straight to a CSS custom property through a ref rather than held in
  // state: it changes ten times a second, and re-rendering the whole loader (including the
  // orbiting cards, whose CSS animations would be untouched but whose React elements would
  // be reconciled) that often to move a bar a fraction of a pixel is waste. Same technique
  // StopMarkerLayer uses for `--marker-depth`.
  const stripRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef(0);
  const stageStartRef = useRef<{ stage: StageId | null; at: number }>({ stage: null, at: 0 });

  useEffect(() => {
    if (!active) return;
    // The stage clock is reset here rather than during render, where the caption index's own
    // reset lives: `Date.now()` is impure and a render-phase read of it is genuinely wrong,
    // not merely lint-flagged — a re-render for any unrelated reason would move the clock.
    // The effect already re-runs on every SSE frame, so the reset lands one paint after the
    // transition, which is nothing against a stage measured in tens of seconds.
    if (stageStartRef.current.stage !== activeId) {
      stageStartRef.current = { stage: activeId, at: Date.now() };
    }
    const write = () => {
      progressRef.current = generationProgress(
        stages,
        Date.now() - stageStartRef.current.at,
        progressRef.current
      );
      stripRef.current?.style.setProperty("--gen-progress", progressRef.current.toFixed(4));
    };
    write();
    const id = setInterval(write, PROGRESS_TICK_MS);
    return () => clearInterval(id);
  }, [active, stages, activeId]);

  // --- Facts ----------------------------------------------------------------------------
  // One index, advanced on a timer, naming the start of the visible window. This replaced a
  // per-card recycler that tracked four independent indices and skipped any already on
  // screen — machinery that existed only because the cards recycled at different times, and
  // which carried two bugs neither review caught by reading it: with a pool of three or four
  // it settled into every slot showing the same fact forever, and on mobile the hidden
  // wheel's slots never advanced yet stayed in the exclusion set, so two facts could never
  // appear at all. Both vanish with a single cursor over a stable window.
  // Cancel appears after a beat rather than immediately: most refines and every cached path
  // finish well inside this, and a control that flashes up and vanishes reads as a glitch.
  const [cancelReady, setCancelReady] = useState(false);
  // Reset during render rather than in the effect, the same in-render adjustment the caption
  // index below already uses. The component stays mounted between runs, so without a reset a
  // second generation would offer Cancel from its first frame — and doing it in the effect is
  // a synchronous setState that cascades an extra render pass after paint.
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    setCancelReady(false);
  }
  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => setCancelReady(true), CANCEL_AFTER_MS);
    return () => clearTimeout(id);
  }, [active]);

  const [factSet, setFactSet] = useState(0);
  useEffect(() => {
    if (!active || facts.length <= FACTS_VISIBLE) return;
    const id = setInterval(() => setFactSet((n) => n + 1), FACT_SET_MS);
    return () => clearInterval(id);
  }, [active, facts.length]);

  const visibleFacts =
    facts.length <= FACTS_VISIBLE
      ? facts
      : Array.from(
          { length: FACTS_VISIBLE },
          (_, i) => facts[(factSet * FACTS_VISIBLE + i) % facts.length]
        );

  // Resets to the top of the new stage's caption list whenever the active stage changes,
  // so switching stages never shows a caption mid-rotation that belonged to the last one.
  // Adjusted during render rather than in an effect: an effect would fire a second render
  // pass after paint, briefly showing the previous stage's caption under the new stage.
  // This is React's documented pattern for resetting state when a value changes.
  const [captionStage, setCaptionStage] = useState(activeId);
  if (captionStage !== activeId) {
    setCaptionStage(activeId);
    setIndex(0);
  }

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setIndex((i) => i + 1), CAPTION_INTERVAL_MS);
    return () => clearInterval(id);
  }, [active]);

  if (!active) return null;

  const activeMeta = stageMeta(mode, activeId);
  const caption = activeMeta.captions[index % activeMeta.captions.length];
  const activeEntry = stages.find((s) => s.stage === activeId);
  const activeLabel = activeEntry?.status === "start" ? activeMeta.label : null;

  const live = stages.filter((s) => s.status !== "skipped");
  const percents = waypointPercents(stages);
  // Every stage settled: the marker has reached the pin and the run is over. page.tsx holds
  // the loader open for a beat on this state before handing off, so the arrival is seen.
  const complete = live.length > 0 && live.every((s) => s.status === "done");

  return (
    <div className="pointer-events-none fixed inset-0 z-30 flex flex-col items-center justify-center gap-3">
      {/* The live region covers the disc and the strip only. Its announced content is one real
          string that changes on a genuine stage transition — five of them, each meaningful, and
          a stage change is exactly the answer to "is this stuck". The rotating captions stay
          aria-hidden: several cycle past within one stage saying nothing the stage label
          doesn't. The facts sit OUTSIDE this region rather than inside it aria-hidden, so a
          screen reader can reach them on demand without them being announced every few seconds
          over someone waiting on a result. */}
      <div role="status" className="flex flex-col items-center gap-3">
        <span className="sr-only">{activeLabel ? `${baseLabel} — ${activeLabel}` : baseLabel}</span>
        {subject && (
          // The one line that says what is actually being made. It never moves, is readable at
          // 400% zoom, and answers the question a waiting traveler is really asking — "did it
          // take what I typed?" — which nothing else on this screen was doing.
          <p className="glass-itinerary max-w-[min(90vw,26rem)] rounded-full px-3.5 py-1 text-center text-xs font-medium tracking-[0.025em] text-foreground tabular-nums">
            {subject}
          </p>
        )}
        <div className="loader-wrapper" aria-hidden="true">
          {word.split("").map((letter, i) => (
            <span key={i} className="loader-letter">
              {letter}
            </span>
          ))}
          <div className="loader" />
        </div>

        {/* Flight path: origin dot, travelled arc, marker, remaining dashes, destination pin.
            This replaces the five separate stage dots rather than joining them — the
            waypoints carry the same per-stage state in the same place, and the segments
            between them are what the old row could never show: how much of the wait each
            stage actually accounts for. Widths come from STAGE_SECONDS, so `generate`'s ~95
            seconds gets ~63% of the rail instead of a fifth of it. */}
        <div ref={stripRef} className="gen-strip" aria-hidden="true">
          <div className="gen-strip-track">
            <span className="gen-strip-origin" />
            <div className="gen-strip-rail" />
            <div className="gen-strip-fill" />
            {percents.map((left, i) => (
              <span
                key={live[i].stage}
                className={`gen-strip-tick ${live[i].status === "done" ? "is-done" : ""} ${
                  live[i].status === "start" ? "is-active" : ""
                }`}
                style={{ left: `${left}%` }}
              />
            ))}
            <div className="gen-strip-cursor">
              <span className="gen-strip-marker" />
            </div>
            <span className={`gen-strip-pin ${complete ? "is-done" : ""}`} />
          </div>
          {/* The stage name sits inside the panel, once, instead of in a five-label row under
              the rail. That row was a lie: labels were evenly spaced with `space-between`
              while the ticks sit at duration-weighted positions, so with three stages under
              three seconds the ticks bunch into the first 2% of the rail and the marker spent
              most of the wait under the word "Reviewing" while `generate` was running. One
              name that matches the running stage beats five that don't. */}
          <p className="gen-strip-stage">{activeMeta.label}</p>
        </div>

      {/* Caption pill carries the same frosted treatment as the itinerary card
          and every other panel over the map — see .glass-itinerary in
          globals.css, which also sets --foreground, so text-foreground
          resolves to white here. No AnimatePresence/exit animation: this used to wait
          ("mode=\"wait\"") for the outgoing pill's exit to finish before mounting the next
          one, and if that exit never resolves the caption freezes forever on whatever was
          first on screen. A plain motion.div keyed on `caption` lets React's own
          reconciliation swap the DOM node immediately on every change; only the entrance
          fade is animated, which cannot get stuck the same way. */}
        <motion.div
          aria-hidden="true"
          key={caption}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="glass-itinerary rounded-full px-3 py-1 text-xs font-medium text-foreground"
        >
          {caption}
        </motion.div>

        {/* The only control on the screen, and the only thing here that opts back into pointer
            events — the rest of the loader is inert so the globe underneath stays draggable.
            Before this existed a traveler who spotted a wrong date at t=40s had no exit but a
            reload, which destroys the run; the anxious user was the one most likely to kill a
            call that was nearly finished. */}
        {onCancel && cancelReady && (
          <button
            type="button"
            onClick={onCancel}
            className="value-in glass-itinerary pointer-events-auto rounded-full px-4 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Facts, still and upright. Outside the role="status" region above so a screen reader
          can reach them without them being announced; the whole set is keyed so it cross-fades
          as one page turn rather than three lines flickering out of step. Nothing here moves
          in space — that is the entire point of the rewrite, and the reason the previous
          orbiting version is gone. */}
      {facts.length > 0 && (
        <div className="fact-static">
          <div key={factSet} className="fact-static-group flex flex-col items-center gap-1.5">
            {visibleFacts.map((fact) => (
              <p key={fact} className="fact-static-line glass-itinerary">
                {fact}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
