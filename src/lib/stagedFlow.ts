import { FlowNodeSpec } from "./pipelineFlows";

export type StagedStepId =
  | "submit"
  | "fetch"
  | "qa"
  | "reconcile"
  | "poi"
  | "trip-context"
  | "generation";

/** The staged pipeline drawn as one flow, mirroring `FLOWS` in pipelineFlows.ts for the legacy
 *  routes. `fetch` and `qa` share a concurrent group because 2a is fired unawaited while the
 *  traveler answers 2b — the diagram brackets them rather than chaining an arrow that would
 *  misstate the timing. Keep in sync with the routes under src/app/api/trip-*. */
export const STAGED_NODES: (FlowNodeSpec & { id: StagedStepId; route: string })[] = [
  {
    id: "submit",
    label: "1 · Submit + validate",
    route: "POST /api/trip-submit",
    variant: "external",
    description:
      "Validates destination and dates (end ≥ start, not in the past) and soft-resolves the destination via Open-Meteo. A geocode miss is reported, never fatal.",
    input: "destination, startDate, endDate",
    output: "validated params + destinationResolved",
  },
  {
    id: "fetch",
    label: "2a · Fetch track",
    route: "POST /api/trip-fetch",
    variant: "external",
    description:
      "Preference-independent data, fanned out with Promise.allSettled: date math, coords/timezone/region, weather (+historical fallback), sunrise/sunset, public holidays, candidate POIs. Each source fails soft on its own.",
    input: "destination, startDate, endDate",
    output: "raw_fetch (per-field available flags)",
    concurrentGroup: "tracks",
  },
  {
    id: "qa",
    label: "2b · Q&A track",
    route: "in-page form",
    variant: "external",
    description:
      "The traveler's answers, collected while 2a is still in flight. Only the POI picker waits on 2a's candidate list; everything else is answerable immediately.",
    input: "user input",
    output: "user_answers (normalized flags)",
    concurrentGroup: "tracks",
  },
  {
    id: "reconcile",
    label: "3 · Join / barrier",
    route: "POST /api/trip-prepare",
    variant: "external",
    description:
      "Gated on both tracks. Applies every partial-failure rule in one place: missing weather → seasonal, no transport data → walk+transit, no candidates → the traveler's own POIs. Only zero POIs from either source is a real error.",
    input: "raw_fetch + user_answers",
    output: "reconciled state + notes[]",
  },
  {
    id: "poi",
    label: "4 · POI detail",
    route: "POST /api/trip-prepare",
    variant: "external",
    description:
      "For the selected POIs only: opening hours and closed-days from OSM/Overpass, plus pairwise travel times (haversine + circuity correction). One POI failing degrades just that POI.",
    input: "selected POIs + transport modes",
    output: "poi_details + travelLegs",
  },
  {
    id: "trip-context",
    label: "5 · Build trip-context",
    route: "POST /api/trip-generate",
    variant: "cache",
    description:
      "Deterministic, no LLM. Digests both bundles into compact fact lines — facts only, no planning instructions, since the rules live in the skill. Degraded fields state their default inline.",
    input: "reconciled + poi_details",
    output: "trip-context.md",
  },
  {
    id: "generation",
    label: "6 · Generation",
    route: "POST /api/trip-generate",
    traceType: "generate",
    variant: "llm",
    description:
      "The single LLM call. Skill rules + trip-context facts + a fixed ask, shelled out to the Claude CLI and logged to llm_traces like every other model call.",
    input: "skill + trip-context + prompt",
    output: "itinerary.md",
  },
];
