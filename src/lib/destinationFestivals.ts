import { runComposioTool } from "./composio";
import { DEFAULT_TIMEOUT_MS, parseJsonResponse, runClaude } from "./claude";

const SEARCH_SLUG = "COMPOSIO_SEARCH_WEB";

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

/** Calendar dates are parsed as UTC midnight in this app — see CLAUDE.md. A month label built
 *  from local accessors can name the wrong month for a date near a month boundary. */
function monthYearLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function distilCitations(raw: unknown): WebCitation[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const c = entry as Record<string, unknown> | null;
    return {
      title: typeof c?.title === "string" ? c.title : null,
      url: typeof c?.url === "string" ? c.url : null,
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
  const data = raw as { answer?: unknown; citations?: unknown } | null;
  return typeof data?.answer === "string" && data.answer.trim().length > 0 && Array.isArray(data.citations) && data.citations.length > 0;
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
 * Verified live: the structured `COMPOSIO_SEARCH_EVENT` tool returns zero results for forward
 * dates ("Google hasn't returned any results"), so this uses a plain web search instead, whose
 * `answer` field came back with real names/dates and a `citations[]` array of real source URLs.
 * The dates live only in prose tied to citation markers, not a structured per-item field — a
 * regex across the phrasing variety observed would be the fragile, confidently-wrong kind of
 * parser, so a bounded extraction call reads it instead.
 *
 * Resolves `null` on a failed search. Resolves `[]`, with **no model call attempted**, when the
 * search succeeded but returned nothing extractable — see `hasExtractableContent`.
 */
export async function fetchFestivals(
  destination: string,
  startDate: string,
  runId?: string
): Promise<Festival[] | null> {
  const data = await runComposioTool(SEARCH_SLUG, {
    query: `festivals events in ${destination} ${monthYearLabel(startDate)}`,
  });
  if (data === null) return null;
  if (!hasExtractableContent(data)) return [];

  const { answer, citations: rawCitations } = data as { answer: string; citations: unknown };
  const citations = distilCitations(rawCitations);

  try {
    const prompt = buildFestivalExtractionPrompt(answer, citations);
    const { result: raw } = await runClaude(prompt, "context", DEFAULT_TIMEOUT_MS, { runId });
    return parseJsonResponse<Festival[]>(raw);
  } catch {
    return null;
  }
}
