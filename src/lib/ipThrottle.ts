/**
 * Secondary, noise-reducer-only guard — the daily spend cap (spendCap.ts) is the real backstop.
 * A per-IP limit alone doesn't hold up (shared IPs/NAT), so this only exists to stop one actor
 * from burning through the whole cap alone. In-memory and per-process: resets on redeploy, which
 * is fine since the spend cap survives restarts (it's DB-backed) and this doesn't need to.
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 3;

const recentByIp = new Map<string, number[]>();

/** Null when there is no per-IP signal at all, which is the case this guard must sit out. */
function clientIp(req: { headers: { get(name: string): string | null } }): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || null;
}

export function isThrottled(req: { headers: { get(name: string): string | null } }): boolean {
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
  const now = Date.now();
  const recent = (recentByIp.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  recentByIp.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}
