import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { clerkConfigured } from "@/lib/clerkConfig";
import SignInForm from "./SignInForm";

export const metadata: Metadata = {
  title: "Sign in · TripMate",
  description: "Keep your trips and your traveller profile on every device.",
};

/**
 * The boundary is required, not decorative.
 *
 * `SignInForm` reads `?next=` with `useSearchParams()`, and a client component that does so opts
 * the whole route out of static prerendering unless the bail-out is contained. Without this,
 * `next build` fails outright — `useSearchParams() should be wrapped in a suspense boundary at
 * page "/signin"` — rather than degrading, which is the one good thing about this particular
 * mistake: it cannot reach production silently.
 *
 * The fallback is the page's own frame with the form's space held, so the shell renders
 * immediately and nothing jumps when the client half arrives.
 */
export default function SignInPage() {
  // The form's Clerk hooks throw without a provider, and the layout mounts one only when the keys
  // exist. Say so plainly instead of crashing: accounts are optional here, planning is not gated.
  if (!clerkConfigured()) {
    return (
      <main className="map-chrome-hidden min-h-full px-5 pt-[calc(var(--nav-h)+1.25rem)] pb-16 sm:px-6 sm:pt-[calc(var(--nav-h)+1.5rem)] sm:pb-24">
        <div className="pointer-events-auto mx-auto w-full max-w-sm">
          <h1 className="font-display text-2xl font-semibold text-foreground">Accounts aren&apos;t set up</h1>
          <p className="pt-2 text-sm text-muted">
            Accounts aren&apos;t set up on this server yet. You can keep planning without one.
          </p>
          <p className="pt-5 text-sm">
            <Link href="/" className="font-medium text-foreground underline underline-offset-4">
              Back to planning
            </Link>
          </p>
        </div>
      </main>
    );
  }
  return (
    <Suspense
      fallback={
        <main className="map-chrome-hidden min-h-full px-5 pt-[calc(var(--nav-h)+1.25rem)] pb-16 sm:px-6 sm:pt-[calc(var(--nav-h)+1.5rem)] sm:pb-24">
          <div className="mx-auto w-full max-w-sm">
            <h1 className="font-display text-2xl font-semibold text-foreground">Welcome back</h1>
          </div>
        </main>
      }
    >
      <SignInForm />
    </Suspense>
  );
}
