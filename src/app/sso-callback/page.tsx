"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HandleSSOCallback } from "@clerk/nextjs";
import { clerkClientConfigured } from "@/lib/clerkConfig";

function Callback() {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/trips";
  const finish = `/signin/finish?next=${encodeURIComponent(next)}`;
  return (
    <HandleSSOCallback
      navigateToApp={({ decorateUrl }) => {
        const url = decorateUrl(finish);
        if (url.startsWith("http")) window.location.href = url;
        else router.push(url);
      }}
      // Extra verification or missing sign-up fields: back to the form, which can show them.
      navigateToSignIn={() => router.push(`/signin?next=${encodeURIComponent(next)}`)}
      navigateToSignUp={() => router.push(`/signin?next=${encodeURIComponent(next)}`)}
    />
  );
}

/** Apple and Google come back here. `HandleSSOCallback` renders Clerk's captcha element itself. */
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
