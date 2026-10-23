import { createHmac } from "node:crypto";

/**
 * The id PostHog knows a traveller by. It is derived from the owner id rather than being it: the
 * owner id is the bearer credential for every trip (the cookie is httpOnly for that reason), so it
 * must never reach a browser script or a third party. An HMAC under a server-only secret is stable
 * per owner, cannot be reversed, and cannot be linked to another deployment's ids.
 */
export function analyticsIdFor(ownerId: string, secret: string): string {
  return createHmac("sha256", secret).update(ownerId).digest("hex").slice(0, 32);
}

/**
 * The id posthog-js has already minted in this browser, for a server call that should join the
 * same person. posthog-js keeps it in `ph_<projectKey>_posthog` as URL-encoded JSON; anything
 * missing or unreadable is null, because analytics must never be why a request fails.
 */
export function distinctIdFromCookies(cookieHeader: string | null, projectKey: string): string | null {
  if (!cookieHeader) return null;
  const name = `ph_${projectKey}_posthog`;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue;
    try {
      const id = (JSON.parse(decodeURIComponent(part.slice(eq + 1).trim())) as { distinct_id?: unknown }).distinct_id;
      return typeof id === "string" && id ? id : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Whether a Clerk user is on the team's allowlist (comma-separated ids), whose own use is not data. */
export function isInternalUser(clerkUserId: string | null, allowlist: string | undefined): boolean {
  if (!clerkUserId || !allowlist) return false;
  return allowlist.split(",").some((id) => id.trim() === clerkUserId);
}
