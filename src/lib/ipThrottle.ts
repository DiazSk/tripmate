/**
 * Secondary, noise-reducer-only guard — the daily spend cap (spendCap.ts) is the real backstop.
 * A per-IP limit alone doesn't hold up (shared IPs/NAT), so this only exists to stop one actor
 * from burning through the whole cap alone. In-memory and per-process: resets on redeploy, which
 * is fine since the spend cap survives restarts (it's DB-backed) and this doesn't need to.
 *
 * Separate buckets exist because a cheap route must not spend the model routes' budget, or be held to it.
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 3;

/** Bounds the map: a stream of distinct IPs (real or forged) cannot grow it without limit. */
const MAX_KEYS = 10_000;

const recentByBucketAndIp = new Map<string, number[]>();

/**
 * The client's IP, or null when there is no per-IP signal at all, which is the case this guard
 * must sit out.
 *
 * `x-real-ip` first: it is the header Railway documents for the client address, and its edge
 * overwrites it, so a client cannot choose it. The leftmost `x-forwarded-for` entry, which this
 * used to read, is whatever the client sent if a proxy appends rather than replaces, so rotating
 * it bought a fresh bucket per request. It stays as the fallback for a tunnel or proxy that sets
 * no `x-real-ip`. ponytail: Railway forum threads report `x-real-ip` carrying a CDN edge address
 * when its CDN is in the path, which would put several visitors in one bucket; if that shows up,
 * switch to the deployment's trusted hop instead of guessing here.
 */
export function clientIp(req: { headers: { get(name: string): string | null } }): string | null {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || null;
}

/** Drops every key whose window has emptied, then, if still over the cap, the oldest-inserted. */
function sweep(now: number): void {
  for (const [key, times] of recentByBucketAndIp) {
    if (times.every((t) => now - t >= WINDOW_MS)) recentByBucketAndIp.delete(key);
  }
  for (const key of recentByBucketAndIp.keys()) {
    if (recentByBucketAndIp.size <= MAX_KEYS) break;
    recentByBucketAndIp.delete(key);
  }
}

export function isThrottled(
  req: { headers: { get(name: string): string | null } },
  opts: { bucket?: string; max?: number } = {}
): boolean {
  // **Gated on having a per-IP signal, not on the transport.** It used to require
  // `LLM_TRANSPORT === "api"`, on the reasoning that only the deployed environment both has an
  // `x-forwarded-for` and costs money. The first half of that is the real condition and the
  // second half is not: a CLI-transport server reached through a tunnel has real, distinct
  // client IPs and is spending a subscription's rate limit plus minutes of one laptop's CPU per
  // generation — and under the old gate it had no throttle whatsoever.
  //
  // Absent header still means sit out, for the original reason: a direct localhost request has
  // no signal, every caller would share one bucket, and a normal dev session would trip this.
  const ip = clientIp(req);
  if (!ip) return false;
  const bucket = opts.bucket ?? "model";
  const max = opts.max ?? MAX_PER_WINDOW;
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const recent = (recentByBucketAndIp.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  recentByBucketAndIp.set(key, recent);
  if (recentByBucketAndIp.size > MAX_KEYS) sweep(now);
  return recent.length > max;
}

/** For tests only. */
export function throttleKeyCount(): number {
  return recentByBucketAndIp.size;
}
