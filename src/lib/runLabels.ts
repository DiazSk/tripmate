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

export function formatMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
