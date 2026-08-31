import { cookies } from "next/headers";
import { OWNER_COOKIE, resolveOwnerId } from "./owner";

/**
 * The owner id for the request currently being served.
 *
 * Split from `owner.ts` on purpose: everything there is pure and unit-testable, while this one
 * line reaches into `next/headers` and can only run inside a request. Keeping them apart is what
 * lets `owner.test.mjs` exercise the validation and fallback rules without booting a server.
 *
 * `cookies()` is async in Next 15+ — awaiting it is not optional, and a forgotten `await` yields a
 * Promise whose `.get` is undefined rather than a type error at every call site.
 */
export async function currentOwnerId(): Promise<string> {
  const store = await cookies();
  return resolveOwnerId(store.get(OWNER_COOKIE)?.value);
}
