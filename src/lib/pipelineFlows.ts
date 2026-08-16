export type Kind = "generate" | "refine" | "rebalance" | "place-detail";

/** Matches `llm_traces.type` for nodes backed by a real logged call. External nodes (geocode/
 *  weather) have no trace row at all, so they carry no trace type. */
export type TraceType = "context" | "generate" | "refine" | "critique" | "rebalance" | "place-detail";

export type NodeVariant = "external" | "cache" | "llm";

export interface FlowNodeSpec {
  /** Unique within its flow — also what the live-status map and node-detail panel key off. */
  id: string;
  traceType?: TraceType;
  label: string;
  variant: NodeVariant;
  /** Plain-English: what actually happens here and why — not just the data shape. */
  description: string;
  /** What goes into this step, in plain terms — shown always, not just once real data exists. */
  input: string;
  /** What comes out of this step. */
  output: string;
  /** Nodes sharing a `concurrentGroup` value fire at the same time (neither waits on the other) —
   *  drawn side by side under a bracket rather than in the arrow chain. */
  concurrentGroup?: string;
}

export interface FlowSpec {
  kind: Kind;
  trigger: string;
  route: string;
  /** One-line narrative of the whole flow, read top to bottom before the diagram. */
  summary: string;
  /** Rough real-world duration, from actual runs — sets expectations, doesn't promise anything. */
  typicalDuration: string;
  nodes: FlowNodeSpec[];
}

/**
 * The whole LLM agent architecture, one flow per entry point that can ever spawn a Claude call.
 * Node shapes and descriptions are read directly off the real prompt builders in
 * `src/lib/itineraryPrompt.ts` and the routes in `src/app/api/itinerary/route.ts` /
 * `src/app/api/place-detail/route.ts` — keep this in sync if those change.
 */
export const FLOWS: FlowSpec[] = [
  {
    kind: "generate",
    trigger: "Generate itinerary",
    route: 'POST /api/itinerary · kind="generate"',
    summary:
      "Weather/geocoding and destination context are fetched at the same time (neither waits on the other), then Generation writes the itinerary in one shot, then Critique re-reads its own output and can silently fix it before you ever see it.",
    typicalDuration: "~2–4 minutes",
    nodes: [
      {
        id: "geocode",
        label: "Geocode + Weather",
        variant: "external",
        description:
          "Plain REST calls to Open-Meteo (free, no key) — turns \"Kyoto, Japan\" into coordinates, then pulls the real forecast for your dates. Not Claude at all; runs purely so Generation can favor indoor stops on rainy days.",
        input: "destination, startDate, endDate",
        output: "lat/lng + per-day forecast",
        concurrentGroup: "kickoff",
      },
      {
        id: "context",
        traceType: "context",
        label: "Context Retrieval",
        variant: "cache",
        description:
          "Asks Claude for festivals/safety notes/shopping/trends for this city+month — but only if nobody has asked in the last 30 days. A cache hit returns the saved answer with zero Claude calls; only a miss actually spawns one.",
        input: "destination, startDate, endDate",
        output: "festivals/safety/shopping/trends text block",
        concurrentGroup: "kickoff",
      },
      {
        id: "generate",
        traceType: "generate",
        label: "Generation",
        variant: "llm",
        description:
          "The one prompt that actually invents your trip: one long text block with the destination, dates, budget, tier, the real weather, your interests, and the context above, asking for a full day-by-day plan back as JSON. This is the slow one.",
        input: "destination, dates, budget, tier, weather, preferences, context",
        output: '{ days: [{ date, weather, summary, lodging, stops[] }] }',
      },
      {
        id: "critique",
        traceType: "critique",
        label: "Critique / Validation",
        variant: "llm",
        description:
          "A second, independent Claude call: hands the itinerary Generation just wrote back to Claude and asks it to check its own budget math, stop timing, and whether it actually used the context/interests — a QA pass you never see run. If it finds nothing, the itinerary is untouched; if it finds problems, its corrected days silently replace the originals.",
        input: "the generated itinerary + budget + context + interest tags",
        output: '{ issues: string[], revisedDays: DayPlan[] | null } — revisedDays swapped in when present',
      },
      {
        id: "placing",
        label: "Coordinate Correction",
        variant: "external",
        description:
          "Corrects each stop's lat/lng against OSM/Overpass — the model's own coordinates are often badly wrong (measured: Fushimi Inari 11km off). Names it resolves get real positions; anything unmatched keeps the model's guess. Skipped entirely if the initial geocode failed, since there's no reference point to correct against.",
        input: "generated stop names + destination coordinates",
        output: "corrected lat/lng per matched stop",
      },
    ],
  },
  {
    kind: "refine",
    trigger: "Regenerate (feedback loop)",
    route: 'POST /api/itinerary · kind="refine"',
    summary:
      "Same route and same shape as Generate, just triggered by different input: instead of starting cold, it hands Claude the itinerary you already have plus the feedback you typed, and still runs the same Critique pass afterward.",
    typicalDuration: "~2–3 minutes",
    nodes: [
      {
        id: "context",
        traceType: "context",
        label: "Context Retrieval",
        variant: "cache",
        description: "Same 30-day cache as Generate — geocode/weather aren't refetched here since the destination hasn't changed.",
        input: "destination, startDate, endDate",
        output: "festivals/safety/shopping/trends text block",
      },
      {
        id: "refine",
        traceType: "refine",
        label: "Generation (Refine)",
        variant: "llm",
        description:
          "Hands Claude the full previous itinerary plus your typed feedback (\"make day 2 cheaper\") and asks for a revised version that addresses it while keeping everything else intact.",
        input: "previousItinerary, feedback, destination, dates, budget, context",
        output: '{ days: [...] } — a revised itinerary addressing the feedback',
      },
      {
        id: "critique",
        traceType: "critique",
        label: "Critique / Validation",
        variant: "llm",
        description: "The exact same self-check Generate runs, applied to the just-refined itinerary.",
        input: "the refined itinerary + budget + context",
        output: '{ issues: string[], revisedDays: DayPlan[] | null }',
      },
    ],
  },
  {
    kind: "rebalance",
    trigger: "Rebalance overspend",
    route: 'POST /api/itinerary · kind="rebalance"',
    summary:
      "The simplest flow — one Claude call, no context lookup, no critique. Fires when a saved trip's overspend banner asks to rebalance: \"here's what's left of the trip and the budget, make it fit.\"",
    typicalDuration: "~3–5 seconds",
    nodes: [
      {
        id: "rebalance",
        traceType: "rebalance",
        label: "Rebalance",
        variant: "llm",
        description:
          "One-shot prompt over just the remaining (not-yet-happened) days and whatever budget is left — asks Claude to reduce or swap stops/lodging so the remaining days fit inside it.",
        input: "destination, tier, remainingDays, remainingBudget",
        output: "DayPlan[] — revised remaining days that fit the remaining budget",
      },
    ],
  },
  {
    kind: "place-detail",
    trigger: "Click a stop (place detail)",
    route: 'POST /api/place-detail · kind="place-detail"',
    summary:
      "Fires every time you click a stop on the itinerary — one small, fast Claude call for a travel-guide blurb about that specific place. Appends to the trip's original run if it has one, so browsing several stops shows up as more steps on that same pipeline card.",
    typicalDuration: "~5–10 seconds",
    nodes: [
      {
        id: "place-detail",
        traceType: "place-detail",
        label: "Place Detail",
        variant: "llm",
        description:
          "Asks for a compact history/best-time-to-visit/practical-tips blurb for one named place — the model has no tools, so this is purely what it already knows, not a live lookup.",
        input: "name, destination, lat, lng",
        output: '{ history, bestTime, tips: string[], duration }',
      },
    ],
  },
];
