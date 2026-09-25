import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
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

const LINK_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 512 * 1024;

export interface LinkDeps {
  fetch: typeof fetch;
  lookup: (host: string) => Promise<string>;
}

const defaultLinkDeps: LinkDeps = {
  fetch: (...args) => fetch(...args),
  lookup: async (host) => (await dnsLookup(host)).address,
};

/**
 * https only, public addresses only, every redirect hop re-checked, bounded time.
 * ponytail: checks the address, then lets fetch resolve again — a DNS-rebinding host could answer
 * differently the second time. Pin the socket to the checked address if this ever serves more
 * than a demo beta.
 */
async function guardedFetch(url: string, deps: LinkDeps): Promise<{ res: Response; url: string } | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let u: URL;
    try {
      u = new URL(current);
    } catch {
      return null;
    }
    if (u.protocol !== "https:") return null;
    try {
      const host = u.hostname.replace(/^\[|\]$/g, "");
      const address = isIP(host) ? host : await deps.lookup(host);
      if (!isPublicAddress(address)) return null;
      const res = await deps.fetch(u.toString(), {
        redirect: "manual",
        signal: AbortSignal.timeout(LINK_TIMEOUT_MS),
        headers: { "user-agent": "TripMate/1.0 (+place import)" },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) return null;
        current = new URL(location, u).toString();
        continue;
      }
      return res.ok ? { res, url: current } : null;
    } catch {
      return null;
    }
  }
  return null;
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_BODY_BYTES));
}

const decodeEntities = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

function metaContent(html: string, prop: string): string {
  const m =
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i")) ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, "i"));
  return m ? decodeEntities(m[1]) : "";
}

/** What a link says about itself: an oEmbed caption for TikTok/YouTube, title + og tags otherwise.
 *  `null` means the link could not be read — never "it said nothing". */
export async function readLink(url: string, deps: LinkDeps = defaultLinkDeps): Promise<{ title: string; text: string } | null> {
  const kind = classifyItem({ kind: "url", url });
  if (kind === "tiktok" || kind === "youtube") {
    const endpoint =
      kind === "tiktok"
        ? `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`
        : `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`;
    const got = await guardedFetch(endpoint, deps);
    if (!got) return null;
    try {
      const json = JSON.parse(await readCapped(got.res)) as { title?: unknown };
      return typeof json.title === "string" ? { title: json.title, text: "" } : null;
    } catch {
      return null;
    }
  }
  const got = await guardedFetch(url, deps);
  if (!got) return null;
  const html = await readCapped(got.res);
  const title = metaContent(html, "og:title") || decodeEntities(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "");
  const text = metaContent(html, "og:description") || metaContent(html, "description");
  return title || text ? { title, text } : null;
}

/** Where a link ends up after redirects — for Maps short links, whose target URL carries the place. */
export async function resolveFinalUrl(url: string, deps: LinkDeps = defaultLinkDeps): Promise<string | null> {
  const got = await guardedFetch(url, deps);
  return got?.url ?? null;
}
