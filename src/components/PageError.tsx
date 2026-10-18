"use client";

import Link from "next/link";
import InlineNote from "@/components/InlineNote";

/**
 * A page that could not be shown, at page scale: the section note in a card of its own, with a way
 * forward. Shared by the route boundaries (`error.tsx`, `not-found.tsx`) so that a failed page reads
 * as one thing wherever it fails (copy rows G-15 to G-17, M-01).
 *
 * `retry` is the boundary's own `retry` (Next 16): it re-fetches the segment on the server as well
 * as re-rendering, which is what a failed server read needs. `reset` alone would replay the same
 * error payload. A `muted` tone is for a page that is simply not there, which is not a failure to
 * load and so carries no "Couldn't load" tag.
 */
export default function PageError({
  title,
  tone = "error",
  retry,
  links,
  children,
}: {
  title: string;
  tone?: "error" | "muted";
  retry?: () => void;
  links: { href: string; label: string; primary?: boolean }[];
  children: React.ReactNode;
}) {
  return (
    <main className="map-chrome-hidden pointer-events-auto flex min-h-full items-center justify-center p-5 pt-[calc(var(--nav-h)+1.25rem)] sm:p-6 sm:pt-[calc(var(--nav-h)+1.5rem)]">
      <div className="glass-itinerary is-opaque w-full max-w-xl rounded-2xl p-3">
        <InlineNote
          size="section"
          tone={tone}
          title={title}
          action={retry ? { label: "Try again", onClick: retry } : undefined}
          footer={links.length ? links.map((l) => (
            <Link key={l.href} href={l.href} className={`err-btn ${l.primary ? "err-btn-signal" : "err-btn-quiet"}`}>
              {l.label}
            </Link>
          )) : undefined}
        >
          {children}
        </InlineNote>
      </div>
    </main>
  );
}
