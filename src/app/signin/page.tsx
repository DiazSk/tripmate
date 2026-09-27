import type { Metadata } from "next";
import { Suspense } from "react";

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
