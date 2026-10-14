import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { clerkClientConfigured } from "@/lib/clerkConfig";
import SignInForm from "./SignInForm";
import { SignInPassFrame } from "./SignInPassFrame";

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
 * The fallback is the page's own frame (the night photograph and a pass), so the shell renders
 * immediately and nothing jumps when the client half arrives.
 */
export default function SignInPage() {
  // The form's Clerk hooks throw without a provider, and the layout mounts one only when the publishable
  // key exists. That key, not the runtime-only secret, because this page is prerendered at build. Say so plainly instead of crashing: accounts are optional here, planning is not gated.
  if (!clerkClientConfigured()) {
    return (
      <SignInPassFrame>
        <div className="sp-plain">
          <h1 className="sp-title">Accounts aren&apos;t set up</h1>
          <p className="sp-lead">Accounts aren&apos;t set up on this server yet. You can keep planning without one.</p>
          <p>
            <Link href="/" className="sp-link">
              Back to planning
            </Link>
          </p>
        </div>
      </SignInPassFrame>
    );
  }
  return (
    <Suspense
      fallback={
        <SignInPassFrame>
          <div className="sp-plain" aria-busy="true">
            <h1 className="sp-title">Welcome back</h1>
          </div>
        </SignInPassFrame>
      }
    >
      <SignInForm />
    </Suspense>
  );
}
