import { cookies } from "next/headers";
import { auth, currentUser } from "@clerk/nextjs/server";
import { clerkConfigured } from "./clerkConfig";
import { getAccountImage, getOrCreateAccount, getTrip, type TripRow } from "./db";
import { OWNER_COOKIE, readableOwners, resolveOwnerId } from "./owner";

/**
 * Who this request belongs to: a signed-in account if there is one, else the anonymous cookie.
 *
 * Split from `owner.ts` on purpose: everything there is pure and unit-testable, while this reaches
 * into `next/headers` and can only run inside a request. Keeping them apart is what lets
 * `owner.test.mjs` exercise the validation and fallback rules without booting a server.
 *
 * `cookies()` is async in Next 15+ — awaiting it is not optional, and a forgotten `await` yields a
 * Promise whose `.get` is undefined rather than a type error at every call site.
 */

export interface RequestOwner {
  /** The value that goes into, and is matched against, `owner_id`. */
  id: string;
  /**
   * Whether `id` is a real account rather than a cookie.
   *
   * Read by the callers that widen a query to the legacy bucket — see `readableOwners`. It cannot
   * be inferred from `id` alone: an account id and an anonymous id are both UUIDs, deliberately.
   */
  signedIn: boolean;
}

/**
 * The owner for the request currently being served.
 *
 * **A verified session wins; everything else is unchanged.** Clerk's `auth()` reads the session
 * cookie that the web app carries *or* the `Authorization: Bearer` header that the mobile app
 * carries, so this single call covers both transports and neither caller has to say which it is.
 *
 * When nobody is signed in this falls through to exactly the behaviour that existed before
 * accounts: the anonymous cookie, or the legacy bucket when there isn't one — which is what keeps
 * `curl`, the perf scripts and the bench harness working with no credentials. With no Clerk keys
 * at all (`clerkConfigured()`) there are simply no accounts, and everything else works.
 */
export async function currentOwner(): Promise<RequestOwner> {
  const userId = clerkConfigured() ? (await auth()).userId : null;
  if (userId) return { id: getOrCreateAccount(userId).owner_id, signedIn: true };

  const store = await cookies();
  return { id: resolveOwnerId(store.get(OWNER_COOKIE)?.value), signedIn: false };
}

export interface AccountView {
  /** The owner id — what avatars and every table are keyed by, not Clerk's id. */
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

/**
 * The signed-in account as the clients display it, or null. `currentUser()` is a Clerk API call
 * (rate-limited), so this is for pages and the account endpoint — never for the per-request
 * owner check above.
 */
export async function currentAccount(): Promise<AccountView | null> {
  if (!clerkConfigured()) return null;
  const { userId } = await auth();
  if (!userId) return null;
  const user = await currentUser();
  if (!user) return null;
  const { owner_id } = getOrCreateAccount(userId);
  return {
    id: owner_id,
    email: user.primaryEmailAddress?.emailAddress ?? "",
    name: user.firstName ?? user.fullName ?? null,
    image: getAccountImage(owner_id),
  };
}

/** The id alone, for the callers that never widen a read. */
export async function currentOwnerId(): Promise<string> {
  return (await currentOwner()).id;
}

/**
 * One trip, but only for the person it belongs to.
 *
 * **Every whole-trip read goes through this, and that is the point.** Reading a trip by id was
 * left unscoped on purpose while the id doubled as the share link, and four separate routes grew
 * up around that: the page, its print view, `GET /api/trips/[id]` and the HTML export. Gating
 * three of them and missing the fourth would have left the trip readable and the fix invisible,
 * so the check lives in one function rather than four copies of a condition.
 *
 * Undefined means "no such trip" *and* "not yours", collapsed deliberately. Every caller turns it
 * into the same 404, so a stranger cannot learn that an id is real — a 403 beside a 404 is an
 * existence oracle for anybody willing to try ids.
 *
 * A trip its owner has chosen to publish is read by token instead, through
 * `getTripByShareToken` — never through here.
 */
export async function readOwnTrip(id: string): Promise<TripRow | undefined> {
  const row = getTrip(id);
  if (!row) return undefined;
  const { id: ownerId, signedIn } = await currentOwner();
  return readableOwners(ownerId, signedIn).includes(row.owner_id) ? row : undefined;
}
