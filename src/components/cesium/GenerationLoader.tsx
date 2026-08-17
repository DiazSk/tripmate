"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { STAGE_ORDER, stageMeta, StageId, StageStatus } from "@/lib/generationStages";

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

export interface StageProgress {
  stage: StageId;
  status: "pending" | StageStatus;
}

function activeStageId(stages: StageProgress[]): StageId {
  const inProgress = stages.find((s) => s.status === "start");
  if (inProgress) return inProgress.stage;
  // Nothing has started yet (the stream just opened) or every stage already finished —
  // fall back to the first stage so there is always a caption to show.
  return stages[0]?.stage ?? STAGE_ORDER[0];
}

/** The wait indicator for any long model call — shows only while `active`, rendering the
 *  five real generation stages (generationStages.ts) with their live status, plus a caption
 *  that rotates within whichever stage is currently running. Floats centered over the globe. */
export default function GenerationLoader({
  active,
  mode = "generate",
  stages,
}: {
  active: boolean;
  mode?: keyof typeof WORD;
  stages: StageProgress[];
}) {
  const { word, baseLabel } = WORD[mode];
  const activeId = activeStageId(stages);
  const [index, setIndex] = useState(0);

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

  return (
    // The live region is the outer box; its announced content is one real string that now
    // changes on a genuine stage transition (five of them, each meaningful — a stage change
    // is exactly the answer to "is this stuck") rather than only once at mount. The rotating
    // captions below stay aria-hidden, same reasoning as before: several cycle past within
    // one stage saying nothing the stage label doesn't.
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

      <div className="flex items-center gap-3" aria-hidden="true">
        {stages.map(({ stage, status }) => {
          const meta = stageMeta(mode, stage);
          return (
            <div key={stage} className="flex flex-col items-center gap-1">
              <span
                className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${
                  status === "done"
                    ? "bg-accent"
                    : status === "start"
                      ? "animate-pulse bg-accent/60"
                      : status === "skipped"
                        ? "bg-white/20"
                        : "bg-white/10"
                }`}
              />
              <span className="text-[10px] font-medium text-foreground/70">{meta.label}</span>
            </div>
          );
        })}
      </div>

      {/* Caption pill carries the same frosted treatment as the itinerary card
          and every other panel over the map — see .glass-itinerary in
          globals.css, which also sets --foreground, so text-foreground
          resolves to white here. */}
      <AnimatePresence mode="wait">
        <motion.div
          aria-hidden="true"
          key={caption}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2 }}
          className="glass-itinerary rounded-full px-3 py-1 text-xs font-medium text-foreground"
        >
          {caption}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
