import { NextRequest, NextResponse } from "next/server";
import { runClaude } from "@/lib/claude";
import { extractModel } from "@/lib/llmConfig";
import { buildExtractPrompt, parseExtraction } from "@/lib/importExtract";
import { gatherSources, readImportRequest } from "@/lib/importRequest";
import { normalizeAnchors } from "@/lib/anchors";
import { geocodeAnchors } from "@/lib/anchorGeocode";
import { geocodeDestinationCached } from "@/lib/serverFetchCached";
import type { Anchor } from "@/lib/types";

/**
 * Chaos in: a pile of screenshots, links and notes → the places in it, geocoded.
 *
 * Nothing here blocks the trip. Every item that can't be read is returned in `unread` with the
 * sentence the wizard shows, and the plan can be generated with whatever did resolve. Images are
 * never written anywhere — the trace keeps a size marker (see imageTraceMarker in claude.ts).
 */

const EXTRACT_TIMEOUT_MS = 60_000;

export async function POST(req: NextRequest) {
  const request = await readImportRequest(req, "import");
  if (request instanceof NextResponse) return request;
  const { items, destination } = request;
  const { sources, images, imageIndices, unread, direct } = await gatherSources(items);

  let destinationGuess: string | null = null;
  const extracted: Anchor[] = [];
  if (sources.length > 0 || images.length > 0) {
    try {
      const { result } = await runClaude(
        buildExtractPrompt(sources, imageIndices, destination),
        "extract",
        EXTRACT_TIMEOUT_MS,
        { model: extractModel(), images }
      );
      const parsed = parseExtraction(result);
      destinationGuess = parsed?.destinationGuess ?? null;
      for (const p of parsed?.places ?? []) {
        extracted.push({ name: p.name, lat: null, lng: null, priority: "want", source: "import" });
      }
      const found = new Set((parsed?.places ?? []).map((p) => p.sourceIndex));
      for (const idx of imageIndices) {
        if (!found.has(idx)) unread.push({ index: idx, reason: "No places found in this screenshot. Try one where the names are visible." });
      }
    } catch (err) {
      console.error("[import] extract failed", err);
      for (const idx of imageIndices) unread.push({ index: idx, reason: "This screenshot couldn’t be read just now. Press Find the places to try it again." });
      for (const s of sources) unread.push({ index: s.index, reason: "This couldn’t be read just now. Press Find the places to try it again." });
    }
  }

  let places = normalizeAnchors({ anchors: [...direct.map((d) => d.anchor), ...extracted] });
  const city = destination ?? destinationGuess;
  if (city && places.some((p) => p.lat === null)) {
    const geo = await geocodeDestinationCached(city).catch(() => null);
    if (geo) places = await geocodeAnchors(places, { lat: geo.lat, lon: geo.lon });
  }
  unread.sort((a, b) => a.index - b.index);
  return NextResponse.json({ destinationGuess, places, unread });
}
