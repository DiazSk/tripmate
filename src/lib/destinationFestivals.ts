import { DEFAULT_TIMEOUT_MS, parseJsonResponse, runClaude } from "./claude";

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const MAX_RESULTS_FOR_EXTRACTION = 8;

export interface Festival {
  name: string;
  dates: string;
  note: string;
  sourceUrl: string | null;
}

interface WebCitation {
  title: string | null;
  url: string | null;
}

interface BraveResult {
  title: string | null;
  description: string | null;
  url: string | null;
}

/** Calendar dates are parsed as UTC midnight in this app — see CLAUDE.md. A month label built
 *  from local accessors can name the wrong month for a date near a month boundary. */
function monthYearLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function distilBraveResults(raw: unknown, limit = MAX_RESULTS_FOR_EXTRACTION): BraveResult[] {
  const results = (raw as { web?: { results?: unknown } } | null)?.web?.results;
  if (!Array.isArray(results)) return [];
  return results.slice(0, limit).map((entry) => {
    const r = entry as Record<string, unknown> | null;
    return {
      title: typeof r?.title === "string" ? r.title : null,
      description: typeof r?.description === "string" ? r.description : null,
      url: typeof r?.url === "string" ? r.url : null,
    };
  });
}

/**
 * Whether the search actually returned anything to extract from.
 *
 * This gate is the whole safety property of this module: when it's false, `fetchFestivals`
 * returns `[]` in code and never calls the model at all. An LLM asked to "find festivals" with no
 * real material in front of it is exactly today's bug; skipping the call is what makes that
 * structurally impossible rather than merely discouraged by a prompt instruction.
 */
export function hasExtractableContent(raw: unknown): boolean {
  return distilBraveResults(raw).some((r) => r.title?.trim() && r.description?.trim());
}

/**
 * Synthesizes the old Composio `{ answer, citations }` shape from Brave's plain results list, so
 * `buildFestivalExtractionPrompt`'s tested contract (cite by `[n]`, never invent a date) needs no
 * changes. Each usable result becomes one numbered line, doubling as its own citation entry.
 */
function buildTextAndCitations(results: BraveResult[]): { text: string; citations: WebCitation[] } {
  const usable = results.filter((r) => r.title?.trim() && r.description?.trim());
  return {
    text: usable.map((r, i) => `[${i + 1}] ${r.title}: ${r.description}`).join("\n"),
    citations: usable.map((r) => ({ title: r.title, url: r.url })),
  };
}

/**
 * The extraction prompt — pure, so its constraints are testable without a live model call.
 *
 * The task is narrow on purpose: not "tell me about festivals" (unconstrained recall, today's
 * bug) but "here is real, cited text — extract only what it already says." Every instruction
 * exists to make invention harder than compliance: cite by number, carry a date only if the text
 * states one, and an item with no clear date is dropped rather than guessed.
 */
export function buildFestivalExtractionPrompt(answer: string, citations: WebCitation[]): string {
  const citationList = citations
    .map((c, i) => `[${i + 1}] ${c.title ?? "untitled"} — ${c.url ?? "no url"}`)
    .join("\n");

  return `Below is real, search-sourced text about festivals/events at a destination, with numbered citations.

TEXT:
${answer}

CITATIONS:
${citationList}

Extract a JSON array of the festivals/events explicitly named in the TEXT above. Rules:
- Only include an item that is actually named in the TEXT with a citation marker like [1].
- "dates" must be copied from what the TEXT actually states for that item. If the TEXT gives no clear date for an item, omit that item entirely rather than guessing one.
- "sourceUrl" is the URL from the CITATIONS list matching that item's citation number.
- Do not add any festival, date, or detail that is not present in the TEXT. If the TEXT names nothing extractable, respond with an empty array.

Respond with ONLY valid JSON, no markdown code fences, no commentary, in exactly this shape:
[{"name":"festival name","dates":"date range as stated","note":"one short line from the text","sourceUrl":"url or null"}]`;
}

/**
 * Real festivals for a destination's trip month, extracted only from real cited text.
 *
 * Brave's plain web search returns a results list, not a single synthesized answer string, so the
 * extraction prompt's input is built from the results list itself (numbered, doubling as its own
 * citation list) rather than a Composio-shaped `{ answer, citations }` payload. The dates live
 * only in prose, not a structured per-item field — a regex across the phrasing variety observed
 * would be the fragile, confidently-wrong kind of parser, so a bounded extraction call reads it
 * instead.
 *
 * Resolves `null` on a missing key or failed search. Resolves `[]`, with **no model call
 * attempted**, when the search succeeded but returned nothing extractable — see
 * `hasExtractableContent`.
 */
export async function fetchFestivals(
  destination: string,
  startDate: string,
  runId?: string
): Promise<Festival[] | null> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) return null;

  try {
    const url = new URL(BRAVE_SEARCH_URL);
    url.searchParams.set("q", `festivals events in ${destination} ${monthYearLabel(startDate)}`);
    const res = await fetch(url, {
      headers: { "X-Subscription-Token": apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!hasExtractableContent(data)) return [];

    const { text, citations } = buildTextAndCitations(distilBraveResults(data));
    const prompt = buildFestivalExtractionPrompt(text, citations);
    const { result: raw } = await runClaude(prompt, "context", DEFAULT_TIMEOUT_MS, { runId });
    return parseJsonResponse<Festival[]>(raw);
  } catch {
    return null;
  }
}
