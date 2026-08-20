import Link from "next/link";

/**
 * Carries the copy the client-side load error used to show for an unknown id ("That trip isn't
 * saved here"), now reached through `notFound()` from the server page — which means it also
 * returns a real 404 status instead of a 200 with a message in it.
 *
 * Shaped like `/trip/latest`'s empty state rather than a bare error, because the two say almost
 * the same thing to a visitor and should not look like different products.
 */
export default function TripNotFound() {
  return (
    <main className="pointer-events-auto flex min-h-full items-center justify-center p-8">
      {/* `is-opaque` — no TripView mounts here, so no globe. Kept identical to `/trip/latest`'s
          empty card, per the note above. */}
      <div className="glass-itinerary is-opaque max-w-md rounded-2xl p-6 text-center">
        <h1 className="font-display text-lg font-semibold text-foreground">
          That trip isn&rsquo;t saved here
        </h1>
        <p className="mt-2 text-sm text-muted">
          The link may be from a different device — trips live in this app&rsquo;s own local
          storage, not in an account that follows you between them.
        </p>
        <Link
          href="/trips"
          className="mt-4 inline-block rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-foreground"
        >
          See your memories
        </Link>
      </div>
    </main>
  );
}
