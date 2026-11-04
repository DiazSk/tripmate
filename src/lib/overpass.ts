/**
 * The one place that knows how to ask Overpass a question.
 *
 * Overpass is OSM's free query API, and this app leans on it for five separate things: highway
 * geometry (`roads.ts`), the city outline (`cityBoundary.ts`), opening hours (`poiDetails.ts`),
 * arrival points (`api/arrival-points`), and the map's place search (`placeSearch.ts`).
 *
 * **Why this module exists.** Four of those five were pinned to `overpass-api.de` alone, while
 * `placeSearch.ts` and `exportMapData.ts` each carried their own copy of a three-mirror failover
 * loop. The reasoning recorded in `placeSearch.ts` for not sharing it was that the others "fire
 * once per destination, which is nothing like" a search box's traffic — true, and about *rate
 * limiting*, which is only one of the two ways this upstream fails.
 *
 * The other way is that the primary simply goes down, and firing once at a dead host fails every
 * time rather than rarely. Measured 2026-09-06 within a few minutes of each other:
 *
 *     overpass-api.de           000  (connection refused, then unreachable)
 *     overpass.kumi.systems     200  in 0.68s
 *     overpass.private.coffee   200  in 1.38s
 *
 * Every consumer degrades soft, so the app did not break — it quietly shipped a map with no
 * highways, no city outline and no opening hours, and said nothing. Failing across the mirrors
 * costs a little latency and nothing else: they run the same software over the same planet data.
 *
 * **The two failure modes, and why callers can't tell them apart.** `overpass-api.de` publishes a
 * slot count at `/api/status` — it is **2** for an anonymous IP. A trip page opens by firing
 * arrival-points, city-context and roads together, so the third is over the limit before anything
 * is wrong with the query. That returns 429. A dead host returns nothing at all. Both land here as
 * `null`, which is the house convention: `null` is "we could not ask", `[]` is "we asked and there
 * is nothing there". Keep that distinction at the call site — see `placeSearch.ts`, where it is
 * the difference between "search is busy" and lying about a neighbourhood having no cafés.
 */

/**
 * Tried in order. The primary first because it is the reference instance and the one whose usage
 * policy this app's `User-Agent` is a courtesy to; the mirrors after it because it is also the one
 * most likely to be saturated or down.
 */
export const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
] as const;

/**
 * Overpass's Apache front-end **406s a bare `fetch()`** — undici sends no `Accept` header by
 * default and the front-end reads that as "accepts nothing". The `User-Agent` is what these
 * instances' usage policies ask for. Neither is optional; both cost a session each to rediscover.
 */
const HEADERS = {
  "Content-Type": "text/plain",
  Accept: "*/*",
  "User-Agent": "TripMate/1.0",
} as const;

/** Overpass queues under load, so this is generous. Note the `[timeout:N]` written *inside* a
 *  query is an instruction to Overpass about its own execution budget — only the abort signal
 *  caps how long this process waits for an answer. */
const DEFAULT_TIMEOUT_MS = 30_000;

export interface OverpassElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
  members?: { type: string; ref: number; role: string }[];
}

/**
 * Index into `OVERPASS_URLS` of the last mirror that answered, tried first next time.
 *
 * Not a cache and not an optimisation for its own sake — it is what stops a dead primary being
 * paid for once per query. `cityBoundary.ts` alone fires three sequential Overpass calls, and
 * `overpass-api.de` refuses a connection in anywhere from 2s to 20s when it is down (measured,
 * three attempts in a row: 4.3s, 2.4s, 19.7s). Without this, one city outline spends up to a
 * minute failing at the same host three times before reaching a mirror that works — which is
 * exactly what it did: 60s, against 23s for the single-call `roads` on the same page load.
 *
 * Process-local and deliberately crude. It resets on failure and wraps around, so a mirror that
 * dies after being learned costs one extra attempt and then stops being preferred. Nothing
 * persists it: a fresh process re-learns on its first query, which is the correct default because
 * the primary is the reference instance and usually the right first choice.
 */
let preferredMirror = 0;

/**
 * Run a query, falling across the mirrors. Returns the `elements` array, or `null` when no mirror
 * could answer — a timeout, a rate limit, a refused connection or a non-JSON reply all collapse to
 * `null`, because none of them are distinguishable to a caller and all of them mean the same
 * thing: we could not ask.
 *
 * `[]` is a real answer: the query ran and matched nothing.
 *
 * **`timeoutMs` is per mirror; `deadline` is for the whole call.** Without a deadline a query that
 * no mirror answers costs up to `timeoutMs` three times over. A generation paid that twice in a
 * row, measured: the tags lookup and the coordinate sweep each spent ~90s failing over dead
 * mirrors to return nothing, and the traveller watched "Almost there" for four minutes. A
 * `deadline` (epoch ms) shortens each attempt to the time left and stops trying mirrors once it
 * passes, returning `null` exactly as if every mirror had refused.
 */
export async function askOverpass(
  body: string,
  { timeoutMs = DEFAULT_TIMEOUT_MS, deadline }: { timeoutMs?: number; deadline?: number } = {}
): Promise<OverpassElement[] | null> {
  // Start at the last known-good mirror and wrap, so every mirror is still tried exactly once.
  const order = OVERPASS_URLS.map((_, i) => (preferredMirror + i) % OVERPASS_URLS.length);
  for (const index of order) {
    const url = OVERPASS_URLS[index];
    const left = deadline === undefined ? timeoutMs : Math.min(timeoutMs, deadline - Date.now());
    if (left <= 0) break;
    let responded = false;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: HEADERS,
        body,
        signal: AbortSignal.timeout(left),
      });
      responded = true;
      health.downAt[index] = null;
      if (!res.ok) continue;
      const data = (await res.json()) as { elements?: OverpassElement[]; remark?: string };

      // **Overpass reports a server-side query timeout as HTTP 200** with an empty `elements` and
      // a `remark` explaining itself. Taken at face value that reads as "there are no airports
      // near Kyoto", which is the exact null-vs-empty confusion this app's fail-soft convention
      // exists to prevent. `api/arrival-points` was the only caller that checked for it — every
      // other one has been silently accepting timed-out queries as real empty answers. Checked
      // here so all five get it, and treated as this mirror failing, so the next one is tried.
      if (typeof data.remark === "string") continue;

      preferredMirror = index;
      health.answeredSeq = ++health.seq;
      return data.elements ?? [];
    } catch (err) {
      // Refused, timed out, or answered something that is not JSON. Next mirror. Silent through
      // its whole timeout, or refused outright, is a mirror that is down; an attempt the caller's
      // deadline cut short proves nothing about it.
      const cutShort = (err as { name?: string } | null)?.name === "TimeoutError" && left < timeoutMs;
      if (!responded && !cutShort) health.downAt[index] = { at: Date.now(), seq: ++health.seq };
    }
  }
  return null;
}

/**
 * True when every mirror, at its last attempt in the past 10 minutes, gave no HTTP response at all
 * (refused, or silent through its whole timeout) and nothing has answered since. A 429, a 504 or a
 * timeout `remark` is a mirror that is up and busy, and does not count.
 *
 * For a caller that is about to wait a whole budget on Overpass for nothing it needs: a generation
 * whose own lookups already found it unreachable skips the coordinate sweep and the listing lookup
 * rather than spending 45s each on the same refusal (measured 2026-11-03: `overpass-api.de`
 * refusing, both mirrors silent, every streamed run waiting 45.0s). Every other caller keeps asking,
 * so the first answer anywhere clears it.
 *
 * ponytail: process-wide and only as fresh as the last query anyone sent. A heavy query that
 * outlasts a busy mirror's whole timeout marks it down too; the cost is one skipped sweep, which is
 * the fail-soft answer the sweep already gives. A per-host health probe is the upgrade if that ever
 * shows up.
 */
export function overpassUnreachable(now = Date.now()): boolean {
  return health.downAt.every((d) => d !== null && d.seq > health.answeredSeq && now - d.at < DOWN_FRESH_MS);
}
const DOWN_FRESH_MS = 10 * 60_000;
/**
 * `downAt`, per mirror in `OVERPASS_URLS` order: when it last refused or stayed silent through a
 * whole attempt. `seq` orders these against `answeredSeq`, since two can share a millisecond.
 *
 * On `globalThis`, not module scope, because Next can load this module once per route bundle: an
 * outage `/api/roads` had just measured was invisible to `/api/itinerary` in the same process.
 */
type Health = { downAt: ({ at: number; seq: number } | null)[]; answeredSeq: number; seq: number };
const health: Health = ((globalThis as { __tripmateOverpassHealth?: Health }).__tripmateOverpassHealth ??= {
  downAt: OVERPASS_URLS.map(() => null),
  answeredSeq: 0,
  seq: 0,
});
