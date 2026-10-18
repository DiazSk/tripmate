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
 * The same identity, for a client that does not have a cookie jar we can reach.
 *
 * A cookie is a browser mechanism, and the React Native app is not a browser. Its networking
 * layer swallows `Set-Cookie` into a native store that JS cannot read, and — the part that
 * actually breaks things — it *overwrites* a hand-set `Cookie` header with whatever that store
 * holds. Observed on the mobile app: a request went out carrying
 * `tripmate_owner=<A>,tripmate_owner=<B>`, two stale ids the store had accumulated from earlier
 * responses and neither of them the one the client had chosen. So a trip and the profile written
 * milliseconds apart in one flow landed under different owners, and promoting the draft answered
 * 404 because the caller was no longer the person who had created it.
 *
 * The header is not a second identity scheme — the proxy folds it straight into the cookie the
 * rest of the app already reads, so `currentOwnerId()` and every route below it are untouched.
 * Same validation, same legacy fallback, same lack of any authorization claim (see below).
 */
export const OWNER_HEADER = "x-tripmate-owner";

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
 *
 * **A development-migration affordance, and production does not have it.** The bucket exists so a
 * developer's own `tripmate.db`, `curl`, the perf scripts and the bench harness — none of which
 * carry a cookie — keep seeing what they saw before ownership existed. A deployment has no such
 * history to protect and, worse, a shared bucket anyone can name: `"local"` passes the same shape
 * check as a UUID, so `X-TripMate-Owner: local` was enough to write into it, and because every
 * anonymous read is widened to include it, whatever was written appeared on every anonymous
 * visitor's `/trips` wall. In production the three functions below therefore refuse it: it is not
 * a valid id, it is never the fallback, and it is never added to a read.
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
 * drafts list and no explanation. Anything that fails falls back to the legacy bucket — in
 * development; in production it falls back to a fresh identity (see `resolveOwnerId`).
 *
 * **`"local"` is valid only outside production.** `env` defaults to `process.env.NODE_ENV` so no
 * caller has to pass it; it is a parameter so a test can exercise both modes without mutating the
 * process environment (`node --test` leaves NODE_ENV unset, which takes the development branch).
 * The proxy validates both the `X-TripMate-Owner` header and the cookie with this function, so in
 * production a `"local"` claim fails there and the proxy mints a real owner instead of adopting it.
 */
export function isValidOwnerId(value: string | undefined | null, env = process.env.NODE_ENV): boolean {
  if (!value) return false;
  if (value === LEGACY_OWNER) return env !== "production";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * The owner to use for this request: the cookie if it is one of ours, else the legacy bucket.
 *
 * The fallback is what keeps every non-browser caller working unchanged — `curl`, the perf scripts,
 * the bench harness and the browser's very first request all arrive with no cookie, and all of them
 * should see the same thing they saw before ownership existed rather than an empty list.
 *
 * **In production there is no such bucket to fall back to.** A request that reaches here with no
 * valid cookie (the proxy normally mints one first, so this is a defence in depth) gets a fresh,
 * throwaway owner: it sees nothing, and whatever it writes belongs to nobody who can name it
 * later, rather than landing in a pool every other cookieless caller can read and write.
 */
export function resolveOwnerId(raw: string | undefined | null, env = process.env.NODE_ENV): string {
  return isValidOwnerId(raw, env) ? (raw as string) : env === "production" ? newOwnerId() : LEGACY_OWNER;
}

/**
 * Which owners a read should match: the caller's, plus the legacy bucket.
 *
 * Reads are widened, writes are not — a new row always carries exactly one owner. See LEGACY_OWNER
 * for why the pre-ownership rows stay visible. Returns one entry when the caller *is* the legacy
 * bucket, so a cookieless client doesn't ask the database for the same value twice.
 *
 * **A signed-in account is never widened, and that is a privacy boundary rather than a tidy-up.**
 * The legacy bucket is *shared* — every row written before ownership existed lives in it and is
 * visible to whoever asks. That was harmless while the only readers were anonymous browsers of a
 * single-player app, which is the case LEGACY_OWNER was written for. Once real accounts exist and
 * the app is deployed, widening would show every person who signed up the entire pre-ownership
 * history of the app, under the heading "my memories". So an account reads its own rows and
 * nothing else; anonymous visitors keep the migration affordance exactly as before.
 *
 * `signedIn` has to be passed rather than derived: an account id and an anonymous cookie id are
 * both UUIDv4 by design, so nothing about the value distinguishes them. It defaults to `false` so
 * every existing caller keeps its previous behaviour — the same additive shape `owner_id` itself
 * was introduced with.
 *
 * **In production nobody is widened.** The bucket is a development-migration affordance (see
 * LEGACY_OWNER) and a deployment has no shared bucket, so every caller reads exactly its own
 * rows. `env` follows `signedIn` rather than replacing it, so existing two-argument callers are
 * unchanged.
 */
export function readableOwners(ownerId: string, signedIn = false, env = process.env.NODE_ENV): string[] {
  if (signedIn || env === "production") return [ownerId];
  return ownerId === LEGACY_OWNER ? [LEGACY_OWNER] : [ownerId, LEGACY_OWNER];
}

/**
 * Which owners a *write* may match: exactly one, ever.
 *
 * The counterpart to `readableOwners`, and the rule that function's own docblock already states —
 * "reads are widened, writes are not". Both `PATCH` and `DELETE` on `/api/trips/[id]` called
 * `readableOwners` instead, which handed every caller the legacy bucket along with their own id.
 * Measured against a running server: a request carrying nothing but a trip id overwrote a
 * legacy-owned itinerary to zero days, then deleted the row, both 200. The comment above that
 * PATCH said it existed to stop precisely that.
 *
 * Returned as a list rather than a boolean so the call sites keep the shape they already had
 * (`owners.includes(trip.owner_id)`) and the two rules read as a pair.
 *
 * **What this cannot fix, because nothing at this layer can.** A caller with no cookie resolves to
 * LEGACY_OWNER and so still matches a legacy row exactly. Those rows are unattributable by
 * definition — that is what the bucket means — and no check here can tell the person who wrote one
 * from a stranger who sent no cookie. What changed is that their ids are no longer handed out: a
 * trip is read by id only by its owner, and sharing mints a separate revocable token instead
 * (`trips.share_token`). The bucket is a dev-migration affordance and stays one.
 */
export function writableOwners(ownerId: string): string[] {
  return [ownerId];
}
