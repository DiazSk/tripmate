"use client";

import ErrorNote from "@/components/ErrorNote";

/**
 * Replaces the fatal `error` state the view used to carry for its own mount fetch.
 *
 * The reasoning behind that state is worth keeping verbatim, because it is the reason this file
 * exists rather than nothing: a failed read must not render the empty state, since "no trips
 * saved" and "we couldn't read your trips" look identical to a visitor and only one of them means
 * their memories are gone. Now that the read happens in the server component, a throw lands here
 * instead of in a `catch`, and the empty-state hero is never reached.
 *
 * `map-chrome-hidden` and the padding match the view's own returns so the failure occupies the
 * same box the grid would have.
 */
export default function TripsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="dashboard-page map-chrome-hidden flex min-h-full items-center p-5 pt-[calc(var(--nav-h)+1.25rem)] sm:p-6 sm:pt-[calc(var(--nav-h)+1.5rem)]">
      <div className="pointer-events-auto mx-auto w-full max-w-5xl">
        <ErrorNote>
          We couldn&rsquo;t load your memories.{" "}
          <button type="button" onClick={reset} className="underline underline-offset-2">
            Try again
          </button>
          .
        </ErrorNote>
      </div>
    </main>
  );
}
