"use client";

import { useEffect } from "react";
import PageError from "@/components/PageError";

/** A throw while the trip page renders or reads (copy row G-16). The trip itself was not touched. */
export default function TripError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <PageError title="This trip didn’t open." retry={retry} links={[{ href: "/trips", label: "See your memories" }]}>
      TripMate couldn&rsquo;t load it just now. Nothing in it was changed.
    </PageError>
  );
}
