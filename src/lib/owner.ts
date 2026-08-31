import { randomUUID } from "crypto";
import { LOCAL_OWNER } from "./travelerProfile";

/**
 * Who a trip belongs to, decided by a cookie this app mints on first visit.
 *
 * There is no login here and this does not pretend to be one. It answers a narrower question —
 * *which browser wrote this?* — which is the only thing a drafts list actually needs: a plan you
 * generated and abandoned should come back to you and to nobody else. An id in a cookie does that
 * without asking anyone to create an account for a trip they have not decided to take yet.
 *
 * What it deliberately is NOT: an authorization boundary. The id is a bearer value in a
 * non-httpOnly-by-necessity world — anyone holding it is treated as its owner, and a trip's own
 * URL stays reachable by id so a shared link keeps working (see `getTrip`, deliberately unscoped).
 * If real accounts arrive, this column is where they attach; `traveler_profile.owner_id` was added
 * as insurance for exactly that and this is the same shape.
 */

/** Read by the proxy and by every server component that lists trips. */
export const OWNER_COOKIE = "tripmate_owner";

/**
 * 400 days — the ceiling Chrome clamps `Max-Age` to, so asking for more silently gets this anyway.
 *
 * Deliberately far longer than `DRAFT_TTL_DAYS`. The cookie is the identity; the 30-day sweep is a
 * property of the drafts themselves. A cookie that expired first would orphan a traveler from
 * drafts that are still well inside their own retention window — the identity has to outlive the
 * thing it identifies, not the other way round.
 */
export const OWNER_COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;

/**
 * The value a row carries when nobody can say whose it is.
 *
 * Every trip written before ownership existed is backfilled to this, and rows holding it stay
 * visible to *every* browser. That is a migration affordance, not the steady state: those rows
 * predate the cookie, so there is no honest way to attribute them, and hiding them would read to
 * the one person who has been using this app as though their trips had been deleted. Rows written
 * from here on carry a real owner and are visible only to it.
 */
export const LEGACY_OWNER = LOCAL_OWNER;

/** A fresh identity. UUIDv4 — opaque, unguessable, and already the id format everywhere else. */
export function newOwnerId(): string {
  return randomUUID();
}

/**
 * Whether a cookie value is one we minted.
 *
 * Validated rather than trusted because it reaches a SQL parameter and a client can send anything.
 * It is parameterised at every call site, so this is not what stops injection — it stops a junk
 * value from silently becoming a *real, distinct owner*, which would hand the sender an empty
 * drafts list and no explanation. Anything that fails falls back to the legacy bucket.
 */
export function isValidOwnerId(value: string | undefined | null): boolean {
  if (!value) return false;
  if (value === LEGACY_OWNER) return true;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * The owner to use for this request: the cookie if it is one of ours, else the legacy bucket.
 *
 * The fallback is what keeps every non-browser caller working unchanged — `curl`, the perf scripts,
 * the bench harness and the browser's very first request all arrive with no cookie, and all of them
 * should see the same thing they saw before ownership existed rather than an empty list.
 */
export function resolveOwnerId(raw: string | undefined | null): string {
  return isValidOwnerId(raw) ? (raw as string) : LEGACY_OWNER;
}

/**
 * Which owners a read should match: the caller's, plus the legacy bucket.
 *
 * Reads are widened, writes are not — a new row always carries exactly one owner. See LEGACY_OWNER
 * for why the pre-ownership rows stay visible. Returns one entry when the caller *is* the legacy
 * bucket, so a cookieless client doesn't ask the database for the same value twice.
 */
export function readableOwners(ownerId: string): string[] {
  return ownerId === LEGACY_OWNER ? [LEGACY_OWNER] : [ownerId, LEGACY_OWNER];
}
