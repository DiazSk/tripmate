/** Trust boundary for POST /api/saved-places: the body comes from any client. Malformed places
 *  are dropped; a malformed request is rejected with a reason. */
export const SAVED_SOURCES = ["screenshot", "video", "tiktok", "youtube", "gmaps", "url", "text", "instagram"] as const;
export type SavedSource = (typeof SAVED_SOURCES)[number];

const MAX_PLACES = 40;
const MAX_TEXT = 120;

type Row = { name: string; lat: number | null; lng: number | null; city: string | null; source: SavedSource; url: string | null };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown) => (typeof v === "string" && v.trim() && v.trim().length <= MAX_TEXT ? v.trim() : null);

export function parseSavedPlacesBody(body: unknown): { rows: Row[] } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!SAVED_SOURCES.includes(b.source as SavedSource)) return { error: "Unknown source." };
  const source = b.source as SavedSource;
  if (source === "instagram") {
    let url: URL;
    try {
      url = new URL(String(b.url));
    } catch {
      return { error: "An Instagram reminder needs its link." };
    }
    const host = url.hostname.replace(/^www\./, "");
    if (url.protocol !== "https:" || !(host === "instagram.com" || host.endsWith(".instagram.com"))) {
      return { error: "An Instagram reminder needs its link." };
    }
    return { rows: [{ name: "Instagram post", lat: null, lng: null, city: null, source, url: url.toString() }] };
  }
  if (!Array.isArray(b.places)) return { error: "Expected a list of places." };
  if (b.places.length > MAX_PLACES) return { error: `Up to ${MAX_PLACES} places at a time.` };
  const city = text(b.city);
  const rows = (b.places as Record<string, unknown>[]).flatMap((p) => {
    const name = text(p?.name);
    return name ? [{ name, lat: num(p.lat), lng: num(p.lng), city, source, url: null }] : [];
  });
  return { rows };
}
