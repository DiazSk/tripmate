import { PostHog } from "posthog-node";
import { after } from "next/server";
import { analyticsConsent } from "../db";
import { analyticsIdFor, distinctIdFromCookies, isInternalUser } from "./ids";

/**
 * Server-side analytics: what the server alone knows (a plan was written, a trip kept), sent only
 * for testers who said yes, and sent after the response so a slow or down PostHog can never be why
 * a request is slow. Entirely off when NEXT_PUBLIC_POSTHOG_KEY is unset. Every failure is swallowed
 * with one warning — analytics must not be a reason for anything to fail.
 */

export type ServerEvent =
  | "plan_written" | "plan_failed" | "trip_kept" | "draft_cleared" | "idea_read"
  | "chat_edit_answered" | "stop_changed" | "trip_shared" | "shared_trip_opened" | "trips_claimed";

export type Platform = "web" | "phone";

export interface Who {
  ownerId: string;
  clerkUserId: string | null;
  cookieHeader: string | null;
  /** Phase 1 measures the web only; the Expo app's requests are recognised and dropped. */
  platform?: Platform;
}

type Client = { capture(e: object): void; flush?: () => Promise<void> };
type Scheduler = (fn: () => void | Promise<void>) => void;

/** The cookie's id is client-supplied, so it is bounded before it is trusted as a key. */
const MAX_DISTINCT_ID = 200;

let client: Client | null = null;
let schedule: Scheduler = (fn) => after(fn);

export function setAnalyticsClientForTest(c: Client | null): void {
  client = c;
}

/** Tests run the callback synchronously; `after()` throws outside a request. */
export function setSchedulerForTest(s: Scheduler | null): void {
  schedule = s ?? ((fn) => after(fn));
}

function getClient(key: string): Client {
  // flushAt: 1 because events are rare and per-request; batching would only delay them past the
  // end of a short-lived process.
  return (client ??= new PostHog(key, { host: process.env.NEXT_PUBLIC_POSTHOG_HOST, flushAt: 1, flushInterval: 0 }));
}

/**
 * Who a route handler is answering, for `captureServer`. The phone is told apart by the bearer
 * token only the Expo app sends. Clerk is asked only when configured (its `auth()` cannot run
 * without the middleware), and imported lazily so this module stays loadable outside a request.
 */
export async function whoFromRequest(
  req: Request,
  resolve: () => Promise<{ ownerId: string; clerkUserId: string | null }> = defaultResolve,
): Promise<Who & { platform: Platform }> {
  const { ownerId, clerkUserId } = await resolve();
  return {
    ownerId,
    clerkUserId,
    cookieHeader: req.headers.get("cookie"),
    platform: /^Bearer\s/i.test(req.headers.get("authorization") ?? "") ? "phone" : "web",
  };
}

async function defaultResolve(): Promise<{ ownerId: string; clerkUserId: string | null }> {
  const { currentOwnerId } = await import("../ownerRequest");
  const { clerkConfigured } = await import("../clerkConfig");
  const clerkUserId = clerkConfigured() ? (await (await import("@clerk/nextjs/server")).auth()).userId : null;
  return { ownerId: await currentOwnerId(), clerkUserId };
}

export function captureServer(
  who: Who,
  event: ServerEvent,
  properties: Record<string, string | number | boolean | null>,
): void {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || who.platform === "phone") return;
  try {
    const signedIn = who.clerkUserId !== null;
    const secret = process.env.ANALYTICS_ID_SECRET;
    const distinctId = signedIn
      ? secret ? analyticsIdFor(who.ownerId, secret) : null
      : distinctIdFromCookies(who.cookieHeader, key);
    if (!distinctId || distinctId.length > MAX_DISTINCT_ID) return;
    if (analyticsConsent(who.ownerId) !== true) return;

    const props = {
      ...properties,
      platform: who.platform ?? "web",
      // Server events carry the server's IP, so without this PostHog would geolocate the host.
      $geoip_disable: true,
      signed_in: signedIn,
      internal: isInternalUser(who.clerkUserId, process.env.ANALYTICS_INTERNAL_USER_IDS),
    };
    schedule(async () => {
      try {
        const c = getClient(key);
        c.capture({ distinctId, event, properties: props });
        await c.flush?.();
      } catch (e) {
        console.warn("[analytics] send failed:", e instanceof Error ? e.message : e);
      }
    });
  } catch (e) {
    console.warn("[analytics] capture failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * Erases one person from PostHog when a tester withdraws consent. Needs a personal API key limited
 * to deleting people (POSTHOG_PERSONAL_API_KEY); without it this does nothing. The persons API
 * lives on the app host, not the ingestion host the SDKs post to, so it has its own setting.
 * Deletion is irreversible, so only a person who really owns this distinct id is deleted: the
 * lookup filter is not trusted to have been applied.
 */
export async function requestDeletion(distinctId: string): Promise<void> {
  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;
  if (!apiKey || !projectId) return;
  try {
    const host = (process.env.POSTHOG_APP_HOST || "https://us.posthog.com").replace(/\/+$/, "");
    const headers = { Authorization: `Bearer ${apiKey}` };
    const base = `${host}/api/projects/${encodeURIComponent(projectId)}/persons`;
    const found = await fetch(`${base}/?distinct_id=${encodeURIComponent(distinctId)}`, { headers });
    if (!found.ok) throw new Error(`lookup ${found.status}`);
    const people = ((await found.json()) as { results?: { id?: string; distinct_ids?: string[] }[] }).results ?? [];
    if (people.length === 0) return; // never captured anything: nothing to erase
    const id = people.find((p) => p.distinct_ids?.includes(distinctId))?.id;
    if (!id) throw new Error("lookup returned no person with that distinct id; nothing deleted");
    const del = await fetch(`${base}/${encodeURIComponent(id)}/?delete_events=true&delete_recordings=true`, { method: "DELETE", headers });
    if (!del.ok) throw new Error(`delete ${del.status}`);
  } catch (e) {
    console.warn("[analytics] deletion request failed:", e instanceof Error ? e.message : e);
  }
}
