import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { clerkConfigured } from "@/lib/clerkConfig";

/**
 * Copy row T-17 (also T-98, the print page), reached through `notFound()` from the server page —
 * which means it also returns a real 404 status instead of a 200 with a message in it. An unknown
 * id and another owner's trip land here alike, so the page never confirms that an id is real.
 *
 * Shaped like `/trip/latest`'s empty state rather than a bare error, because the two say almost
 * the same thing to a visitor and should not look like different products.
 */
export default async function TripNotFound() {
  // `auth()` needs Clerk's middleware, which only runs with both keys; without them nobody signs in.
  const signedOut = clerkConfigured() && !(await auth()).userId;
  return (
    <main className="pointer-events-auto flex min-h-full items-center justify-center p-8">
      {/* `is-opaque` — no TripView mounts here, so no globe. Kept identical to `/trip/latest`'s
          empty card, per the note above. */}
      <div className="glass-itinerary is-opaque max-w-md rounded-2xl p-6 text-center">
        <h1 className="font-display text-lg font-semibold text-foreground">That trip isn&rsquo;t here.</h1>
        <p className="mt-2 text-sm text-muted">
          It may have been deleted, or it belongs to another account. If you kept it while signed in, sign in to open it.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link href="/trips" className="inline-block rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-foreground">
            See your memories
          </Link>
          {signedOut && (
            <Link href="/signin" className="inline-block rounded-full border border-card-border px-4 py-2 text-sm font-medium text-foreground">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
