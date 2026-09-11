/**
 * Resolving a stop's free-text name to a Wikipedia article title.
 *
 * Extracted from `src/app/api/place-photo/route.ts` when the HTML export needed the same
 * decision. Two copies of a containment rule is one copy too many: they drift, and the drift
 * shows up as one surface finding a photo the other refuses.
 */
import { TTL, cached } from "./fetchCache";

export const WIKI_HEADERS = { "User-Agent": "TripMate/1.0 (personal project)" };

/** Wall-clock cap on each outbound call. Without a signal, undici lets a hung upstream sit for
 *  ~5 minutes and the request that triggered it hangs with it — the literal "the page is stuck"
 *  failure. An abort throws, which is the same shape as any other network failure here, so it
 *  lands on the fail-soft path that already exists rather than adding a new error surface. */
export const WIKI_TIMEOUT_MS = 8_000;

// Strip diacritics so romanization variants match (e.g. "Tenryū-ji" vs. "Tenryu-ji").
export function foldDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

async function searchTitle(query: string): Promise<string | null> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
    query
  )}&format=json&srlimit=1`;
  const res = await fetch(url, {
    headers: WIKI_HEADERS,
    signal: AbortSignal.timeout(WIKI_TIMEOUT_MS),
  });
  // Upstream failure (commonly a rate limit) — throw rather than returning null, so the caller
  // can tell "lookup failed, retry later" apart from "this place genuinely has no photo".
  if (!res.ok) throw new Error(`wikipedia search ${res.status}`);
  const data = await res.json();
  return data.query?.search?.[0]?.title ?? null;
}

// Full-text search can surface an unrelated top hit for generic phrases (e.g. "Lunch
// at Kyoto Station area"). Only trust it when the resolved title is actually contained
// in the stop name — real landmark names pass this easily, unrelated matches don't.
export function passesContainment(title: string, name: string): boolean {
  const bareTitle = foldDiacritics(title.replace(/\s*\([^)]*\)$/, "").toLowerCase());
  return foldDiacritics(name.toLowerCase()).includes(bareTitle);
}

// The model's stop names are often a real landmark plus marketing/descriptive suffixes
// ("Colosseum & Roman Forum (Skip-the-Line Tour)"), which as a single search query dilute
// Wikipedia's full-text ranking away from the landmark's own article. Retry with
// progressively stripped-down queries — cheap, since each extra request only fires when
// the previous one already missed — before giving up. Containment is always checked
// against the full original name, not the stripped candidate, so a match on a shortened
// query still counts.
export function candidateQueries(name: string): string[] {
  const candidates = [name];
  const noParenthetical = name.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (noParenthetical !== name) candidates.push(noParenthetical);
  const beforeConjunction = noParenthetical.split(/\s+(?:&|and)\s+/i)[0].trim();
  if (beforeConjunction && beforeConjunction !== noParenthetical) candidates.push(beforeConjunction);
  return candidates;
}

/**
 * A stop name → a Wikipedia article title, or `null` when there genuinely isn't one.
 *
 * **Cached, and the boxing is the point.** This function has two different nulls: "searched, and
 * nothing matched" (a real answer) and "could not reach Wikipedia" (a throw, from `searchTitle`).
 * `cached()` refuses to write `null` — correctly, since that is how the rest of the app spells
 * "could not ask" — so the real negative is boxed as `{ title: null }` to get past that rule.
 *
 * Caching the negative is most of the win here, not an edge case. A trip is full of stop names
 * like "Lunch in Pienza centro" that will never match an article, and each one costs **three**
 * Wikipedia searches (`candidateQueries` retries progressively stripped-down forms) to conclude
 * nothing — on every render, of every day tab, on every reload. One row now answers all of it.
 *
 * A genuine outage still throws, so `/api/place-photo` keeps returning 503 for it rather than a
 * 200 with a null photo — the distinction that route's own comments are careful about.
 */
export async function resolveTitle(name: string): Promise<string | null> {
  // The raw name, unfolded and untrimmed: `candidateQueries` and `passesContainment` do all the
  // normalising downstream, so this function is deterministic on exactly this string.
  const boxed = await cached(`wikititle:${name}`, TTL.STATIC, async () => {
    try {
      for (const query of candidateQueries(name)) {
        const title = await searchTitle(query);
        if (title && passesContainment(title, name)) return { title };
      }
      return { title: null as string | null };
    } catch {
      // Wikipedia unreachable or rate-limiting. Not an answer, so not stored.
      return null;
    }
  });

  if (boxed === null) throw new Error("wikipedia search unavailable, and nothing cached");
  return boxed.title;
}

/** Superset of what each caller reads off a page summary: `exportPhotos.ts` wants the
 *  thumbnail/original image, `place-photo/route.ts` additionally wants `extract`. */
export interface Summary {
  thumbnail?: { source?: string };
  originalimage?: { source?: string };
  extract?: string;
}

/** The one place that calls Wikipedia's summary endpoint. Previously duplicated in
 *  `exportPhotos.ts` (with a timeout) and `place-photo/route.ts` (without one) — the
 *  timeout is not optional, it's what keeps an undici fetch from sitting for ~5 minutes. */
export async function fetchSummary(title: string): Promise<Summary> {
  // Keyed on the resolved *title*, not the stop name that produced it, so several stop names
  // pointing at one article share a single row. Shorter TTL than the title lookup: an article's
  // title is effectively permanent, while its lead image and extract do get edited.
  const summary = await cached(`wikisum:${title}`, TTL.SLOW, async () => {
    try {
      const res = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
        { headers: WIKI_HEADERS, signal: AbortSignal.timeout(WIKI_TIMEOUT_MS) }
      );
      if (!res.ok) return null;
      return (await res.json()) as Summary;
    } catch {
      return null;
    }
  });

  // A `{}` summary — a real page with no thumbnail and no extract — is a legitimate answer and
  // caches like any other. Only an unreachable Wikipedia lands here, and it keeps this function's
  // original throwing contract so `/api/place-photo` still answers 503 rather than "no photo".
  if (summary === null) throw new Error("wikipedia summary unavailable, and nothing cached");
  return summary;
}
