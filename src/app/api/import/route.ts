import { NextRequest, NextResponse } from "next/server";
import { runClaude, type ImageInput } from "@/lib/claude";
import { extractModel } from "@/lib/llmConfig";
import { classifyItem, parseGoogleMapsUrl, readLink, resolveFinalUrl, type ImportItem } from "@/lib/importSources";
import { buildExtractPrompt, parseExtraction, type ExtractSource } from "@/lib/importExtract";
import { normalizeAnchors } from "@/lib/anchors";
import { geocodeAnchors } from "@/lib/anchorGeocode";
import { geocodeDestinationCached } from "@/lib/serverFetchCached";
import { isThrottled } from "@/lib/ipThrottle";
import { isOverDailyCap } from "@/lib/spendCap";
import type { Anchor } from "@/lib/types";

/**
 * Chaos in: a pile of screenshots, links and notes → the places in it, geocoded.
 *
 * Nothing here blocks the trip. Every item that can't be read is returned in `unread` with the
 * sentence the wizard shows, and the plan can be generated with whatever did resolve. Images are
 * never written anywhere — the trace keeps a size marker (see imageTraceMarker in claude.ts).
 */

const MAX_IMAGES = 20;
const MAX_OTHER = 20;
// Next 16 truncates route-handler bodies at 10MB (middlewareClientMaxBodySize) regardless of
// this constant, so a larger cap here is unreachable; matching it keeps the friendly 413.
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const EXTRACT_TIMEOUT_MS = 60_000;
const MEDIA = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(req: NextRequest) {
  if (isThrottled(req, { bucket: "import", max: 30 })) {
    // One import is one short extract call; a traveller shares several screenshots in a row;
    // the daily spend cap (isOverDailyCap) stays the real backstop.
    return NextResponse.json({ error: "Too many requests — slow down and try again shortly." }, { status: 429 });
  }
  if (isOverDailyCap()) {
    return NextResponse.json({ error: "Demo budget for today has been used up — try again tomorrow." }, { status: 503 });
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "That's a lot at once — try fewer screenshots." }, { status: 413 });
  }
  // The header above is a fast path only — it's client-supplied and a chunked request can omit
  // it entirely. This counts the bytes actually read off the stream, so a spoofed or missing
  // header can't bypass the cap.
  const reader = req.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let tooBig = false;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        tooBig = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
  }
  if (tooBig) {
    return NextResponse.json({ error: "That's a lot at once — try fewer screenshots." }, { status: 413 });
  }
  let body: { items?: unknown; destination?: unknown };
  try {
    body = JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const destination = typeof body.destination === "string" && body.destination.trim() ? body.destination.trim() : null;
  const items = (Array.isArray(body.items) ? body.items : []).filter(
    (i): i is ImportItem =>
      (i?.kind === "image" && MEDIA.has(i.mediaType) && typeof i.data === "string" && i.data.length > 0) ||
      (i?.kind === "url" && typeof i.url === "string") ||
      (i?.kind === "text" && typeof i.text === "string" && i.text.trim().length > 0)
  );
  if (items.filter((i) => i.kind === "image").length > MAX_IMAGES || items.filter((i) => i.kind !== "image").length > MAX_OTHER) {
    return NextResponse.json({ error: `Up to ${MAX_IMAGES} screenshots and ${MAX_OTHER} links or notes at a time.` }, { status: 413 });
  }

  const unread: { index: number; reason: string }[] = [];
  const direct: Anchor[] = [];
  const sources: ExtractSource[] = [];
  const images: ImageInput[] = [];
  const imageIndices: number[] = [];

  await Promise.all(
    items.map(async (item, index) => {
      const kind = classifyItem(item);
      if (item.kind === "image") {
        images.push({ mediaType: item.mediaType, data: item.data });
        imageIndices.push(index);
        return;
      }
      if (item.kind === "text" || kind === "text") {
        sources.push({ index, kind: "text", text: item.kind === "text" ? item.text : item.url });
        return;
      }
      if (kind === "instagram") {
        unread.push({ index, reason: "Instagram links need a screenshot" });
        return;
      }
      if (kind === "gmaps") {
        const place = parseGoogleMapsUrl(item.url) ?? parseGoogleMapsUrl((await resolveFinalUrl(item.url)) ?? "");
        if (place) direct.push({ name: place.name, lat: place.lat, lng: place.lng, priority: "want", source: "import" });
        else unread.push({ index, reason: "Couldn't open this link" });
        return;
      }
      const link = await readLink(item.url);
      if (link) sources.push({ index, kind, text: [link.title, link.text].filter(Boolean).join("\n") });
      else unread.push({ index, reason: "Couldn't open this link" });
    })
  );
  // Images are pushed before any await, so they are already in item order; links finish in any
  // order and are sorted so the prompt reads top to bottom.
  sources.sort((a, b) => a.index - b.index);

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
        if (!found.has(idx)) unread.push({ index: idx, reason: "Couldn't read this screenshot" });
      }
    } catch (err) {
      console.error("[import] extract failed", err);
      for (const idx of imageIndices) unread.push({ index: idx, reason: "Couldn't read this screenshot" });
      for (const s of sources) unread.push({ index: s.index, reason: "Couldn't read this" });
    }
  }

  let places = normalizeAnchors({ anchors: [...direct, ...extracted] });
  const city = destination ?? destinationGuess;
  if (city && places.some((p) => p.lat === null)) {
    const geo = await geocodeDestinationCached(city).catch(() => null);
    if (geo) places = await geocodeAnchors(places, { lat: geo.lat, lon: geo.lon });
  }
  unread.sort((a, b) => a.index - b.index);
  return NextResponse.json({ destinationGuess, places, unread });
}
