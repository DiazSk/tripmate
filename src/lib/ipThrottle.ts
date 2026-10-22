/**
 * Secondary, noise-reducer-only guard — the daily spend cap (spendCap.ts) is the real backstop.
 * A per-IP limit alone doesn't hold up (shared IPs/NAT), so this only exists to stop one actor
 * from burning through the whole cap alone. In-memory and per-process: resets on redeploy, which
 * is fine since the spend cap survives restarts (it's DB-backed) and this doesn't need to.
 *
 * One bucket per action, because a cheap route must not spend the model routes' budget, or be held
 * to it, and because a refusal has to name the action it refused (limitResponse.ts says which).
 */
import { isIPv6 } from "node:net";

export type Bucket =
  | "plan"
  | "edit"
  | "place-detail"
  | "story"
  | "import"
  | "import-plan"
  | "import-plan-complete"
  | "geocode-place"
  | "idea"
  | "context"
  | "lookup"
  | "refusal";

export const LIMITS: Record<Bucket, { max: number; windowMinutes: number }> = {
  plan: { max: 3, windowMinutes: 10 },
  edit: { max: 6, windowMinutes: 10 },
  "place-detail": { max: 10, windowMinutes: 10 },
  story: { max: 6, windowMinutes: 10 },
  import: { max: 30, windowMinutes: 10 },
  "import-plan": { max: 30, windowMinutes: 10 },
  "import-plan-complete": { max: 30, windowMinutes: 10 },
  "geocode-place": { max: 60, windowMinutes: 10 },
  idea: { max: 20, windowMinutes: 10 },
  // destination-context: two model calls and a paid Brave search per request, and the wizard fires it
  // on leaving the basics step, so a person plans a handful an hour, not a handful a minute.
  context: { max: 10, windowMinutes: 10 },
  // The free lookups (Overpass, Wikimedia, ...). 600, not 120: the trip page fires one /api/place-photo per
  // stop per page load (deduped in memory only), so a 40-stop trip opened three times is already 120, and a
  // 429'd photo is not cached, so it keeps retrying. This stops a loop, not a traveller.
  lookup: { max: 600, windowMinutes: 10 },
  // Internal: counts refusals by the AI scope guard. Never answered as a 429.
  refusal: { max: 30, windowMinutes: 10 },
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
  const raw = req.headers.get("x-real-ip")?.trim() || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  // Loopback is no signal either: `next start` forwards a direct request as `x-forwarded-for: ::1`,
  // so every local caller would share one bucket and an ordinary dev session would trip it.
  // Without `x-real-ip`, a forged loopback `x-forwarded-for` sits out too, which is no worse than
  // the rotation that header already allows.
  if (!raw || /^(127\.|::1$|::ffff:127\.)/.test(raw)) return null;
  const ip = isIPv6(raw) ? ipv6Key(raw) : raw;
  return /^127\./.test(ip) ? null : ip;
}

/**
 * An IPv6 client is a /64, not an address: a residential connection is handed a whole /64, so keying
 * on the full address let one person rotate through 2^64 buckets. `::ffff:a.b.c.d` is IPv4 in an
 * IPv6 wrapper and keys as `a.b.c.d`. Node has no expander, so this writes the four hextets out.
 */
function ipv6Key(addr: string): string {
  let a = addr.split("%")[0].toLowerCase();
  // An embedded dotted tail ("64:ff9b::1.2.3.4") is two hextets.
  const v4 = a.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [b0, b1, b2, b3] = v4.slice(1).map(Number);
    a = a.slice(0, v4.index) + ((b0 << 8) | b1).toString(16) + ":" + ((b2 << 8) | b3).toString(16);
  }
  const [head, tail] = a.split("::");
  const h = head ? head.split(":") : [];
  const t = tail === undefined ? [] : tail ? tail.split(":") : [];
  const groups = tail === undefined ? h : [...h, ...Array<string>(8 - h.length - t.length).fill("0"), ...t];
  const n = groups.map((g) => parseInt(g, 16));
  if (n.slice(0, 5).every((g) => g === 0) && n[5] === 0xffff) {
    return `${n[6] >> 8}.${n[6] & 255}.${n[7] >> 8}.${n[7] & 255}`;
  }
  return `${n.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
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
