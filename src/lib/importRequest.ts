import { NextRequest, NextResponse } from "next/server";
import type { ImageInput } from "./claude";
import type { ExtractSource } from "./importExtract";
import { classifyItem, parseGoogleMapsUrl, readLink, resolveFinalUrl, type ImportItem } from "./importSources";
import { throttle } from "./ipThrottle";
import { capResponse, limitResponse } from "./limitResponse";
import { dailyCapResumesAt } from "./spendCap";
import type { Anchor } from "./types";

/**
 * The front half of every import route: throttle, spend cap, a body read that counts real bytes,
 * the item filter, and sorting items into text, images and Maps places. Shared by `/api/import`
 * and `/api/import-plan` so the two cannot drift on what they accept.
 */

const MAX_IMAGES = 20;
const MAX_OTHER = 20;
// Next 16 truncates route-handler bodies at 10MB (middlewareClientMaxBodySize) regardless of
// this constant, so a larger cap here is unreachable; matching it keeps the friendly 413.
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const MEDIA = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function readImportRequest(
  req: NextRequest,
  bucket: "import" | "import-plan"
): Promise<{ items: ImportItem[]; destination: string | null } | NextResponse> {
  // One import is one short model call; a traveller shares several screenshots in a row, so the
  // allowance is 30 (LIMITS); the daily spend cap stays the real backstop.
  const limit = throttle(req, bucket);
  if (limit.limited) return limitResponse(limit, bucket);
  const capped = dailyCapResumesAt();
  if (capped) return capResponse(capped);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "That's a lot at once. Try fewer screenshots." }, { status: 413 });
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
    return NextResponse.json({ error: "That's a lot at once. Try fewer screenshots." }, { status: 413 });
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
  return { items, destination };
}

export interface GatheredSources {
  sources: ExtractSource[];
  images: ImageInput[];
  imageIndices: number[];
  unread: { index: number; reason: string }[];
  /** Google Maps links, already placed, with the item they came from. */
  direct: { index: number; anchor: Anchor }[];
}

export async function gatherSources(items: ImportItem[]): Promise<GatheredSources> {
  const unread: { index: number; reason: string }[] = [];
  const direct: { index: number; anchor: Anchor }[] = [];
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
        unread.push({ index, reason: "Instagram doesn’t let TripMate open its links. Add a screenshot of the post instead." });
        return;
      }
      if (kind === "gmaps") {
        const place = parseGoogleMapsUrl(item.url) ?? parseGoogleMapsUrl((await resolveFinalUrl(item.url)) ?? "");
        if (place) direct.push({ index, anchor: { name: place.name, lat: place.lat, lng: place.lng, priority: "want", source: "import" } });
        else unread.push({ index, reason: "This map link doesn’t say which place it is. Paste the place’s name, or a screenshot." });
        return;
      }
      const link = await readLink(item.url);
      if (link) sources.push({ index, kind, text: [link.title, link.text].filter(Boolean).join("\n") });
      else unread.push({ index, reason: "This page didn’t open for TripMate. It may be private or down. Paste the place names instead." });
    })
  );
  // Images are pushed before any await, so they are already in item order; links finish in any
  // order and are sorted so the prompt reads top to bottom.
  sources.sort((a, b) => a.index - b.index);
  return { sources, images, imageIndices, unread, direct };
}
