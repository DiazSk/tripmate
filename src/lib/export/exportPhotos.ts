import { fetchSummary, resolveTitle, WIKI_HEADERS, WIKI_TIMEOUT_MS, type Summary } from "../wikiTitle";
import type { Trip } from "../types";
import type { ExportPhotos } from "./itineraryHtml";

/** A single image this large is a mistake, not a photo — skip it rather than bloat the file. */
export const MAX_IMAGE_BYTES = 400_000;
/** Whole-file ceiling on inlined imagery. A trip long enough to exceed it loses day thumbs from
 *  the tail; the cover is fetched first and is never the thing dropped. */
export const MAX_TOTAL_BYTES = 1_200_000;
/** Wall-clock cap on the whole photo walk. A trip with many stops can trigger dozens of
 *  sequential Wikipedia round-trips; without a deadline a single slow/rate-limited run blocks
 *  the export instead of just shipping fewer photos. */
const PHOTO_WALK_DEADLINE_MS = 15_000;

export function withinBudget(bytes: number, spent: number): boolean {
  return bytes <= MAX_IMAGE_BYTES && spent + bytes <= MAX_TOTAL_BYTES;
}

interface Budget {
  spent: number;
  deadline: number;
}

async function summaryFor(name: string): Promise<Summary | null> {
  const title = await resolveTitle(name);
  if (!title) return null;
  return fetchSummary(title);
}

async function toDataUri(url: string, budget: Budget): Promise<string | null> {
  const res = await fetch(url, { headers: WIKI_HEADERS, signal: AbortSignal.timeout(WIKI_TIMEOUT_MS) });
  if (!res.ok) return null;
  const type = res.headers.get("content-type") ?? "image/jpeg";
  if (!type.startsWith("image/")) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!withinBudget(bytes.length, budget.spent)) return null;
  budget.spent += bytes.length;
  return `data:${type};base64,${bytes.toString("base64")}`;
}

/**
 * Wikimedia rejects an arbitrary thumbnail width with a 400 — measured on
 * `Altstadt_Zürich_2015.jpg`, every one of 640/800/1024/1200 fails and only 1280 succeeds,
 * because the permitted widths are per-file. `Special:FilePath?width=` resizes server-side and
 * snaps to the nearest rendered size, so it is the only safe way to ask for a specific scale.
 * Never hand-build a `/thumb/.../<w>px-` URL.
 */
function filePathUrl(originalUrl: string, width: number): string | null {
  const parts = originalUrl.split("?")[0].split("/");
  const file = parts.includes("thumb") ? parts[parts.length - 2] : parts.pop();
  if (!file) return null;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${file}?width=${width}`;
}

/**
 * Every slot degrades to null independently. A photo miss is the expected case, not an error:
 * the chosen design renders a plain station node where a thumb is absent, which is exactly why
 * a per-stop photo grid was rejected — its holes were visible and these are not.
 */
export async function collectExportPhotos(trip: Trip): Promise<ExportPhotos> {
  const budget: Budget = { spent: 0, deadline: Date.now() + PHOTO_WALK_DEADLINE_MS };
  const days = trip.itinerary.days;

  let cover: string | null = null;
  try {
    const s = await summaryFor(trip.destination.split(",")[0].trim());
    const original = s?.originalimage?.source;
    const url = original ? filePathUrl(original, 1080) : null;
    cover = (url && (await toDataUri(url, budget))) || null;
    if (!cover && s?.thumbnail?.source) cover = await toDataUri(s.thumbnail.source, budget);
  } catch (err) {
    console.warn("export cover photo lookup failed", err);
    cover = null;
  }

  const dayPhotos: (string | null)[] = [];
  for (const day of days) {
    let thumb: string | null = null;
    if (Date.now() > budget.deadline) {
      dayPhotos.push(thumb);
      continue;
    }
    // The first stop whose name Wikipedia actually recognises. Generic stops ("Lunch in Altstadt
    // neighborhood") correctly resolve to nothing, so this walks past them.
    for (const stop of day.stops) {
      if (Date.now() > budget.deadline) break;
      try {
        const s = await summaryFor(stop.name);
        const src = s?.thumbnail?.source;
        if (src) {
          thumb = await toDataUri(src, budget);
          if (thumb) break;
        }
      } catch (err) {
        // Upstream hiccup on one stop must not cost the day its photo — try the next stop.
        console.warn(`export day photo lookup failed for "${stop.name}"`, err);
      }
    }
    dayPhotos.push(thumb);
  }

  return { cover, days: dayPhotos };
}
