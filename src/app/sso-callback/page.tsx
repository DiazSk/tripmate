import Link from "next/link";
import { Suspense } from "react";
import { clerkClientConfigured } from "@/lib/clerkConfig";
import Callback from "./Callback";

/**
 * Apple and Google come back here. `HandleSSOCallback` renders Clerk's captcha element itself.
 *
 * A server component on purpose: the guard reads the key through `clerkClientConfigured()`, and a
 * client bundle only inlines the literal `process.env.NEXT_PUBLIC_X`, so in the browser it would
 * always read "not configured" and disagree with the server's render.
 */
export default function SSOCallbackPage() {
  // `HandleSSOCallback` throws without a `ClerkProvider`, which the layout mounts only when the
  // publishable key exists; a stray visit to this URL should read as a page, not a crash.
  if (!clerkClientConfigured()) {
    return (
      <main className="min-h-full px-5 pt-[calc(var(--nav-h)+1.25rem)] text-sm text-muted">
        Accounts aren&apos;t set up on this server yet.{" "}
        <Link href="/" className="font-medium text-foreground underline underline-offset-4">
          Back to planning
        </Link>
      </main>
    );
  }
  return (
    <Suspense>
      <Callback />
    </Suspense>
  );
}
