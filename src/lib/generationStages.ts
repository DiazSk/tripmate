export type StageId = "geocode" | "context" | "generate" | "critique" | "placing";
export type StageStatus = "start" | "done" | "skipped";

export interface StageEvent {
  stage: StageId;
  status: StageStatus;
}

/** The five stages a generate/refine call reports, in the order they occur. Stage ids
 *  deliberately match the node ids in `FLOWS` for `kind: "generate"` in pipelineFlows.ts, so
 *  the developer-facing pipeline diagram and this traveler-facing loader name the same
 *  steps — but the text below is written for someone waiting on a holiday, not a developer
 *  reading a trace, so it is not shared with FLOWS' own descriptions. */
export const STAGE_ORDER: readonly StageId[] = ["geocode", "context", "generate", "critique", "placing"];

export interface StageMeta {
  /** Short label for the stage's row in the loader — not the rotating caption. */
  label: string;
  /** Rotates every 2.5s while this stage is the active one. Never empty. */
  captions: string[];
}

const GENERATE_META: Record<StageId, StageMeta> = {
  geocode: {
    label: "Locating",
    captions: ["Finding your destination…", "Pulling the real forecast…"],
  },
  context: {
    label: "Context",
    captions: ["Checking festivals and events…", "Reading local safety notes…"],
  },
  generate: {
    label: "Planning",
    captions: [
      "Charting the route…",
      "Scouting places to stay…",
      "Plotting the best stops…",
      "Balancing the budget…",
      "Writing the day-by-day plan…",
    ],
  },
  critique: {
    label: "Reviewing",
    captions: ["Double-checking the budget…", "Reviewing stop timing…"],
  },
  placing: {
    label: "Placing",
    captions: ["Correcting map coordinates…"],
  },
};

/** Refine reuses most of the same stage set — geocode and placing are always skipped (the
 *  previous itinerary's coordinates are reused, not refetched), and generate/context/critique
 *  get refine-flavored captions to match the "Rethinking" word GenerationLoader already shows
 *  for this mode. */
const REFINE_META: Record<StageId, StageMeta> = {
  ...GENERATE_META,
  context: {
    label: "Context",
    captions: ["Re-checking festivals and events…"],
  },
  generate: {
    label: "Reworking",
    captions: [
      "Reading your notes…",
      "Reworking the days…",
      "Rebalancing the budget…",
      "Finalizing the changes…",
    ],
  },
  critique: {
    label: "Reviewing",
    captions: ["Re-checking the budget…", "Re-checking stop timing…"],
  },
};

export function stageMeta(mode: "generate" | "refine", stage: StageId): StageMeta {
  return (mode === "refine" ? REFINE_META : GENERATE_META)[stage];
}
