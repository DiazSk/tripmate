const GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
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
 * Pure. `note` is built from the article's own title and domain — never model-written — so
 * every word a traveler reads traces back to something a real outlet actually published. GDELT
 * is a metadata index, not a summarizer: there's no snippet/body field on an article, so
 * `classifySeverity` runs on the title alone. That's a real accuracy reduction versus the old
 * title+snippet input, accepted rather than worked around.
 */
export function distilSafetyNotes(raw: unknown, limit = MAX_NOTES): SafetyNote[] {
  const articles = (raw as { articles?: unknown } | null)?.articles;
  if (!Array.isArray(articles)) return [];

  const notes: SafetyNote[] = [];
  for (const entry of articles) {
    const a = entry as Record<string, unknown> | null;
    const title = typeof a?.title === "string" ? a.title.trim() : "";
    if (!title) continue;

    const domain = typeof a?.domain === "string" ? a.domain.trim() : null;
    notes.push({
      note: domain ? `${title} — ${domain}` : title,
      severity: classifySeverity(title),
      sourceUrl: typeof a?.url === "string" ? a.url : null,
    });
    if (notes.length >= limit) break;
  }
  return notes;
}

/**
 * Real, dated safety coverage for a destination, from GDELT's free DOC 2.0 API (no key). GDELT
 * ANDs every bare word in `query` against an article's full text, not just its title, with no
 * proximity requirement — verified live, the brief's original 6-word query
 * (`tourist safety advisory scam warning`) returned zero results for every destination tried,
 * because requiring all 6 words to co-occur anywhere in one article is unrealistic. Cut to
 * `tourist safety` + `sourcelang:english` (the closest GDELT equivalent to the old `hl: "en"`):
 * verified live against Paris and Bangkok, both returned genuinely on-topic, English-language,
 * safety/travel-relevant articles. Resolves `null` on failure, per the house convention; the
 * caller must degrade to an empty section, never back to invention.
 */
export async function fetchSafetyNotes(destination: string): Promise<SafetyNote[] | null> {
  try {
    const url = new URL(GDELT_URL);
    url.searchParams.set("query", `${destination} tourist safety sourcelang:english`);
    url.searchParams.set("mode", "artlist");
    url.searchParams.set("format", "json");
    url.searchParams.set("maxrecords", "10");
    url.searchParams.set("sort", "datedesc");
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return distilSafetyNotes(await res.json());
  } catch {
    return null;
  }
}
