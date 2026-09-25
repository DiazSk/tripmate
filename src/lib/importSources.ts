import { isIP } from "node:net";
import type { ImageInput } from "./claude";

/**
 * The chaos-in import's input side: what a dropped item is, and — for links — what it says.
 * Instagram is recognised only so it can be refused with a useful message: its oEmbed needs a
 * Meta app token, so a screenshot is the realistic way in.
 */

export type ImportItem =
  | { kind: "image"; mediaType: ImageInput["mediaType"]; data: string }
  | { kind: "url"; url: string }
  | { kind: "text"; text: string };

export type SourceKind = "image" | "tiktok" | "youtube" | "gmaps" | "instagram" | "url" | "text";

export function classifyItem(item: ImportItem): SourceKind {
  if (item.kind === "image") return "image";
  if (item.kind === "text") return "text";
  let host: string;
  let path: string;
  try {
    const u = new URL(item.url);
    host = u.hostname.replace(/^www\./, "");
    path = u.pathname;
  } catch {
    return "text";
  }
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
  if (host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com")) return "youtube";
  if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
  if (host === "maps.app.goo.gl" || host === "goo.gl" || (host.startsWith("google.") && path.startsWith("/maps")) || host === "maps.google.com") {
    return "gmaps";
  }
  return "url";
}

/** `/maps/place/<name>/@<lat>,<lng>` — with `!3d<lat>!4d<lng>` (the pin itself) preferred over the
 *  `@` viewport centre when both are present. Short links must be resolved by the caller first. */
export function parseGoogleMapsUrl(url: string): { name: string; lat: number; lng: number } | null {
  const place = url.match(/\/maps\/place\/([^/]+)\//);
  if (!place) return null;
  const pin = url.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  const centre = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const coords = pin ?? centre;
  if (!coords) return null;
  let name: string;
  try {
    name = decodeURIComponent(place[1].replace(/\+/g, " ")).trim();
  } catch {
    return null;
  }
  return name ? { name, lat: Number(coords[1]), lng: Number(coords[2]) } : null;
}

/** SSRF guard: only addresses on the public internet may be fetched on a traveller's behalf. */
export function isPublicAddress(ip: string): boolean {
  const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicAddress(mapped[1]);
  const version = isIP(ip);
  if (version === 4) {
    const [a, b] = ip.split(".").map(Number);
    return !(
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (version === 6) {
    const v = ip.toLowerCase();
    return !(v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || /^fe[89ab]/.test(v));
  }
  return false;
}
