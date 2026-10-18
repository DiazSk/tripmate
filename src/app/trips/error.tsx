"use client";

import { useEffect } from "react";
import PageError from "@/components/PageError";

/**
 * Replaces the fatal `error` state the view used to carry for its own mount fetch (copy row M-01).
 *
 * The reasoning behind that state is worth keeping, because it is the reason this file exists
 * rather than nothing: a failed read must not render the empty state, since "no trips saved" and
 * "we couldn't read your trips" look identical to a visitor and only one of them means their
 * memories are gone. The read happens in the server component, so a throw lands here instead of in
 * a `catch`, and the empty-state hero is never reached. The sentence says the trips are still saved.
 */
export default function TripsError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <PageError title="Your memories didn’t load." retry={retry} links={[]}>
      TripMate couldn&rsquo;t read your trips just now; they&rsquo;re still saved.
    </PageError>
  );
}
