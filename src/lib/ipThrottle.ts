/**
 * Secondary, noise-reducer-only guard — the daily spend cap (spendCap.ts) is the real backstop.
 * A per-IP limit alone doesn't hold up (shared IPs/NAT), so this only exists to stop one actor
 * from burning through the whole cap alone. In-memory and per-process: resets on redeploy, which
 * is fine since the spend cap survives restarts (it's DB-backed) and this doesn't need to.
 *
 * One bucket per action, because a cheap route must not spend the model routes' budget, or be held
 * to it, and because a refusal has to name the action it refused (limitResponse.ts says which).
 */
export type Bucket =
  | "plan"
  | "edit"
  | "place-detail"
  | "story"
  | "import"
  | "import-plan"
  | "import-plan-complete"
  | "geocode-place";

export const LIMITS: Record<Bucket, { max: number; windowMinutes: number }> = {
  plan: { max: 3, windowMinutes: 10 },
  edit: { max: 6, windowMinutes: 10 },
  "place-detail": { max: 10, windowMinutes: 10 },
  story: { max: 6, windowMinutes: 10 },
  import: { max: 30, windowMinutes: 10 },
  "import-plan": { max: 30, windowMinutes: 10 },
  "import-plan-complete": { max: 30, windowMinutes: 10 },
  "geocode-place": { max: 60, windowMinutes: 10 },
};

/** The longest window, which is how long any key can still matter to the sweep. */
const SWEEP_AFTER_MS = Math.max(...Object.values(LIMITS).map((l) => l.windowMinutes)) * 60_000;

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
  const ip = req.headers.get("x-real-ip")?.trim() || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  // Loopback is no signal either: `next start` forwards a direct request as `x-forwarded-for: ::1`,
  // so every local caller would share one bucket and an ordinary dev session would trip it.
  // Without `x-real-ip`, a forged loopback `x-forwarded-for` sits out too, which is no worse than
  // the rotation that header already allows.
  if (!ip || /^(127\.|::1$|::ffff:127\.)/.test(ip)) return null;
  return ip;
}

/** Drops every key whose window has emptied, then, if still over the cap, the oldest-inserted. */
function sweep(now: number): void {
  for (const [key, times] of recentByBucketAndIp) {
    if (times.every((t) => now - t >= SWEEP_AFTER_MS)) recentByBucketAndIp.delete(key);
  }
  for (const key of recentByBucketAndIp.keys()) {
    if (recentByBucketAndIp.size <= MAX_KEYS) break;
    recentByBucketAndIp.delete(key);
  }
}

export type ThrottleResult =
  | { limited: false }
  | { limited: true; retryAfterSeconds: number; limit: number; windowMinutes: number };

/**
 * Whether this request is over its bucket's limit. Only an accepted request is recorded: a refused
 * one must not push the wait further out, or a traveller retrying at the countdown's end would
 * find it reset. So the wait is fixed by the oldest accepted request in the window.
 */
export function throttle(
  req: { headers: { get(name: string): string | null } },
  bucket: Bucket,
  now = Date.now()
): ThrottleResult {
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
  if (!ip) return { limited: false };
  const { max, windowMinutes } = LIMITS[bucket];
  const windowMs = windowMinutes * 60_000;
  const key = `${bucket}:${ip}`;
  const recent = (recentByBucketAndIp.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    recentByBucketAndIp.set(key, recent);
    return { limited: true, retryAfterSeconds: Math.ceil((recent[0] + windowMs - now) / 1000), limit: max, windowMinutes };
  }
  recent.push(now);
  recentByBucketAndIp.set(key, recent);
  if (recentByBucketAndIp.size > MAX_KEYS) sweep(now);
  return { limited: false };
}

/** For tests only. */
export function throttleKeyCount(): number {
  return recentByBucketAndIp.size;
}
