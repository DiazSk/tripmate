import { runComposioTool } from "./composio";

const TOOL_SLUG = "COMPOSIO_SEARCH_NEWS";
const MAX_NOTES = 5;

export interface SafetyNote {
  note: string;
  severity: "low" | "medium" | "high";
  sourceUrl: string | null;
}

/**
 * A keyword heuristic, not a model call — deliberately, and the two reasons matter differently.
 * The weaker one: severity is subjective and a keyword match is a real ceiling (a well-written
 * article that avoids these exact words gets under-classified — ponytail: keyword heuristic,
 * revisit with a model pass over the real snippet if misclassification shows up in practice). The
 * one that actually decided this: the news data is already real and well-structured (title,
 * source, date), so an LLM step here adds nothing but a chance to invent a severity that isn't in
 * the source at all — which is the exact defect this module exists to remove.
 */
export function classifySeverity(text: string): "low" | "medium" | "high" {
  if (/attack|terroris|kidnap|explosion|shooting|do not travel/i.test(text)) return "high";
  if (/scam|pickpocket|theft|robbery|crime|advisory|unrest|protest|warn/i.test(text)) return "medium";
  return "low";
}

/**
 * Pure. `note` is built from the article's own title and source — never model-written — so
 * every word a traveler reads traces back to something a real outlet actually published.
 */
export function distilSafetyNotes(raw: unknown, limit = MAX_NOTES): SafetyNote[] {
  const results = (raw as { news_results?: unknown } | null)?.news_results;
  if (!Array.isArray(results)) return [];

  const notes: SafetyNote[] = [];
  for (const entry of results) {
    const r = entry as Record<string, unknown> | null;
    const title = typeof r?.title === "string" ? r.title.trim() : "";
    if (!title) continue;

    const source = typeof r?.source === "string" ? r.source.trim() : null;
    notes.push({
      note: source ? `${title} — ${source}` : title,
      severity: classifySeverity(`${title} ${typeof r?.snippet === "string" ? r.snippet : ""}`),
      sourceUrl: typeof r?.link === "string" ? r.link : null,
    });
    if (notes.length >= limit) break;
  }
  return notes;
}

/**
 * Real, dated safety coverage for a destination. `hl: "en"` and a specific query both matter —
 * verified live: a loose query without them returned Arabic-dated results and an off-topic
 * article about a different country. Resolves `null` on failure, per the house convention; the
 * caller must degrade to an empty section, never back to invention.
 */
export async function fetchSafetyNotes(destination: string): Promise<SafetyNote[] | null> {
  const data = await runComposioTool(TOOL_SLUG, {
    query: `${destination} tourist safety advisory scam warning`,
    hl: "en",
  });
  return data === null ? null : distilSafetyNotes(data);
}
