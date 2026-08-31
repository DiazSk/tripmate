/**
 * Secondary, noise-reducer-only guard — the daily spend cap (spendCap.ts) is the real backstop.
 * A per-IP limit alone doesn't hold up (shared IPs/NAT), so this only exists to stop one actor
 * from burning through the whole cap alone. In-memory and per-process: resets on redeploy, which
 * is fine since the spend cap survives restarts (it's DB-backed) and this doesn't need to.
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 3;

const recentByIp = new Map<string, number[]>();

function clientIp(req: { headers: { get(name: string): string | null } }): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

export function isThrottled(req: { headers: { get(name: string): string | null } }): boolean {
  // Only the deployed/API-transport environment has a real per-IP signal (a proxy sets
  // x-forwarded-for) and only it needs protecting. Local CLI-transport dev has no such header —
  // every request lands in one shared "unknown" bucket — so gate on transport the same way
  // spendCap.ts no-ops when unconfigured, rather than let a normal local session trip this.
  if (process.env.LLM_TRANSPORT !== "api") return false;
  const ip = clientIp(req);
  const now = Date.now();
  const recent = (recentByIp.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  recentByIp.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}
