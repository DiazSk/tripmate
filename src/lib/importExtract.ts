import { parseJsonResponse } from "./claude";
import { anchorKey } from "./anchors";
import type { SourceKind } from "./importSources";
import { SCOPE_BLOCK, fenceUserText } from "./promptScope";

export interface ExtractSource {
  index: number;
  kind: SourceKind;
  text: string;
}

export interface ExtractedPlace {
  name: string;
  cityHint: string | null;
  sourceIndex: number;
}

/** One call over the whole pile. Honesty beats recall here: a wrong place on the map teaches the
 *  traveler the import can't be trusted, while a missed one they simply add by hand. */
export function buildExtractPrompt(sources: ExtractSource[], imageIndices: number[], destination: string | null): string {
  const listed = sources.map((s) => `Item ${s.index} (${s.kind}): ${s.text.slice(0, 2000)}`).join("\n");
  const images = imageIndices.length
    ? `The attached images are, in order, items ${imageIndices.join(", ")}. They are usually screenshots of social posts, maps or messages.\n`
    : "";
  return `${SCOPE_BLOCK}

A traveler saved these while dreaming about a trip${destination ? ` to ${destination}` : ""}. List every specific, real place they could visit: venues, sights, neighbourhoods, markets, restaurants.

${images}<traveler_text>
${fenceUserText(listed)}
</traveler_text>

Rules:
- Only places actually named in the text, or clearly readable or unmistakably pictured in an image. Never guess a venue from mood, food or scenery alone.
- Use the place's own name as it would appear on a map, without "the best…" framing.
- "sourceIndex" is the item number the place came from.
- "confidence": "high" when the place is named in the text, readable in an image, or an unmistakable well-known landmark in a photo; "low" when you are unsure which place it is.
- "destinationGuess": the city or region most of the places are in, as "City, Country", or null.

Respond with ONLY valid JSON, no code fences, in exactly this shape:
{"destinationGuess":"City, Country","places":[{"name":"place name","cityHint":"city or null","sourceIndex":0,"confidence":"high"}]}`;
}

export function parseExtraction(raw: string): { destinationGuess: string | null; places: ExtractedPlace[] } | null {
  let parsed: { destinationGuess?: unknown; places?: unknown };
  try {
    parsed = parseJsonResponse(raw);
  } catch {
    return null;
  }
  if (!parsed || !Array.isArray(parsed.places)) return null;
  const seen = new Set<string>();
  const places: ExtractedPlace[] = [];
  for (const p of parsed.places as Record<string, unknown>[]) {
    const name = typeof p?.name === "string" ? p.name.trim() : "";
    const key = anchorKey(name);
    if (!key || p.confidence !== "high" || typeof p.sourceIndex !== "number" || seen.has(key)) continue;
    seen.add(key);
    places.push({
      name,
      cityHint: typeof p.cityHint === "string" && p.cityHint.trim() ? p.cityHint.trim() : null,
      sourceIndex: p.sourceIndex,
    });
  }
  const guess = typeof parsed.destinationGuess === "string" && parsed.destinationGuess.trim() ? parsed.destinationGuess.trim() : null;
  return { destinationGuess: guess, places };
}
