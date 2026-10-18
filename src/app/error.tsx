"use client";

import { useEffect } from "react";
import PageError from "@/components/PageError";

/**
 * The root boundary: `/`, `/profile`, `/signin`, `/welcome` and anything without a boundary of its
 * own (copy rows G-15, F-17). A throw while a page renders or reads lands here instead of in
 * Next's default error page, which says nothing about whether the traveller's trips are safe.
 * It sits inside the root layout, so the navbar and the map stay.
 */
export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <PageError title="This page didn’t load." retry={retry} links={[{ href: "/trips", label: "See your memories" }]}>
      TripMate hit a problem while opening it. Your saved trips aren&rsquo;t affected.
    </PageError>
  );
}
