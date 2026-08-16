export const KIND_LABELS: Record<string, string> = {
  generate: "Generate",
  refine: "Refine",
  rebalance: "Rebalance",
  "place-detail": "Place Detail",
};

export const STEP_LABELS: Record<string, string> = {
  context: "Context Retrieval",
  generate: "Generation",
  refine: "Generation (Refine)",
  critique: "Critique/Validation",
  rebalance: "Rebalance",
  "place-detail": "Place Detail Enrichment",
  chat: "Chat Edit",
  "element-edit": "Element Edit",
};

/** Trace `type`s that all originate from an `llm_runs.kind === "refine"` run —
 *  itinerary refine-with-feedback, whole-trip chat edits, and single-element
 *  edits all share that `kind` even though their trace `type` now differs
 *  (see the chat/element-edit split). Anything that needs "the primary step
 *  of a refine-kind run" must check membership in this list, not equality
 *  against "refine". */
export const REFINE_KIND_TYPES = ["refine", "chat", "element-edit"];

export function formatMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
