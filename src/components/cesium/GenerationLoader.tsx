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

/**
 * One orbiting fact card. `side` picks the wheel; `delay` is a *negative* animation-delay,
 * which starts the animation partway through its cycle instead of waiting — that is what
 * phases the four cards apart without a JS scheduler.
 *
 * The left pair sit half a cycle apart so that wheel always has a card in flight; the right
 * pair are shifted a further quarter cycle so the two sides never reach their readable apex
 * at the same moment. Ordered left/right/left/right so that trimming the list for a short
 * fact pool still leaves both wheels occupied.
 */
const ORBIT_SLOTS = [
  { side: "left" as const, phase: 0 },
  { side: "right" as const, phase: 0.25 },
  { side: "left" as const, phase: 0.5 },
  { side: "right" as const, phase: 0.75 },
];

/** Seconds for one full sweep, matched to `--fact-cycle` in globals.css. */
const ORBIT_CYCLE_S = 13;

/** Below this the wheels don't run at all — see the comment at the render site. */
const MIN_FACTS = 3;

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
}: {
  active: boolean;
  mode?: keyof typeof WORD;
  stages: StageProgress[];
  /** True, trip-specific lines from `buildDestinationFacts`. Purely presentational here —
   *  this component never fetches and knows nothing about where they came from. */
  facts?: string[];
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
  // Each orbiting card owns an index into the pool and advances it when its own animation
  // completes a lap — at which point the card is off-screen at zero opacity, so the text
  // swap is invisible. No polling and nothing to keep in sync with the CSS clock.
  const slots = ORBIT_SLOTS.slice(0, Math.min(ORBIT_SLOTS.length, facts.length));
  const [slotFact, setSlotFact] = useState<number[]>(() => ORBIT_SLOTS.map((_, i) => i));
  const nextFactRef = useRef(ORBIT_SLOTS.length);
  const advanceSlot = (slot: number) =>
    setSlotFact((prev) => {
      const pool = facts.length;
      if (pool === 0) return prev;
      // Skip any index that another card is showing right now. A bare counter is not enough:
      // indices wrap with `% facts.length`, and the cards do not recycle in step — a slot
      // starting three-quarters through its cycle laps after a quarter of one — so a fresh
      // counter value routinely lands on the same fact a neighbour is already displaying.
      // Two wheels showing the same sentence at once is the one thing this feed must not do.
      const taken = new Set(prev.filter((_, i) => i !== slot).map((v) => v % pool));
      let candidate = nextFactRef.current++;
      for (let tried = 0; tried < pool && taken.has(candidate % pool); tried++) {
        candidate = nextFactRef.current++;
      }
      const next = [...prev];
      next[slot] = candidate;
      return next;
    });

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
  // The wheels are all-or-nothing: two or three facts cycling for a minute and a half read
  // as a stutter rather than a feed, and the caption pill is still there to carry the wait.
  const showFacts = facts.length >= MIN_FACTS;

  return (
    <>
      {/* The orbit layer is a viewport-sized sibling of the centred column below, not a child
          of it: the column is centred with a -50%/-50% translate, which would make it a
          useless coordinate origin for wheels whose centres sit off-screen. Lower z than the
          column so a card can never cover the disc, and it inherits the shell's
          pointer-events-none so the globe underneath stays draggable. */}
      {showFacts && (
        <div className="fact-orbit-layer" aria-hidden="true">
          {slots.map(({ side, phase }, i) => (
            <div
              key={i}
              className={`fact-orbit fact-orbit-${side}`}
              style={{ animationDelay: `${-phase * ORBIT_CYCLE_S}s` }}
              onAnimationIteration={() => advanceSlot(i)}
            >
              <div
                className="fact-card glass-itinerary"
                style={{ animationDelay: `${-phase * ORBIT_CYCLE_S}s` }}
              >
                {facts[slotFact[i] % facts.length]}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* The live region is the outer box; its announced content is one real string that now
          changes on a genuine stage transition (five of them, each meaningful — a stage change
          is exactly the answer to "is this stuck") rather than only once at mount. The rotating
          captions below stay aria-hidden, same reasoning as before: several cycle past within
          one stage saying nothing the stage label doesn't. The facts are hidden from it too,
          and for a sharper reason: announcing trivia every few seconds over someone waiting on
          a result is noise, not help. */}
      <div
        role="status"
        className="pointer-events-none fixed left-1/2 top-1/2 z-30 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3"
      >
        <span className="sr-only">{activeLabel ? `${baseLabel} — ${activeLabel}` : baseLabel}</span>
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
            <span className="gen-strip-pin" />
          </div>
          <div className="gen-strip-labels">
            {live.map(({ stage, status }) => (
              <span
                key={stage}
                className={`gen-strip-label ${status === "start" ? "is-active" : ""}`}
              >
                {stageMeta(mode, stage).label}
              </span>
            ))}
          </div>
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

        {/* Reduced-motion fallback for the orbiting cards, and it has to be its own element
            rather than a tweak to the wheels. The blanket reduce rule in globals.css sets
            `animation-duration: 0.01ms`, which would snap every card straight to its final
            keyframe — off-screen at zero opacity — so leaning on it would silently delete the
            facts for exactly the people who can't get them any other way. Both halves are
            always rendered and CSS picks one, which keeps this out of JS and away from any
            hydration mismatch. */}
        {showFacts && (
          <div className="fact-static" aria-hidden="true">
            {facts.slice(0, MIN_FACTS).map((fact) => (
              <p key={fact} className="fact-static-line glass-itinerary">
                {fact}
              </p>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
