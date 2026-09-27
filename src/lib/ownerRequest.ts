import { cookies, headers } from "next/headers";
import { auth } from "./auth";
import { OWNER_COOKIE, resolveOwnerId } from "./owner";

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
 * **A verified session wins; everything else is unchanged.** `getSession` reads the session cookie
 * that the web app carries *or* the `Authorization: Bearer` header that the mobile app carries
 * (the `bearer` plugin in `auth.ts`), so this single call covers both transports and neither
 * caller has to say which it is.
 *
 * When nobody is signed in this falls through to exactly the behaviour that existed before
 * accounts: the anonymous cookie, or the legacy bucket when there isn't one — which is what keeps
 * `curl`, the perf scripts and the bench harness working with no credentials.
 */
export async function currentOwner(): Promise<RequestOwner> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session?.user?.id) return { id: session.user.id, signedIn: true };

  const store = await cookies();
  return { id: resolveOwnerId(store.get(OWNER_COOKIE)?.value), signedIn: false };
}

/** The id alone, for the callers that never widen a read. */
export async function currentOwnerId(): Promise<string> {
  return (await currentOwner()).id;
}
