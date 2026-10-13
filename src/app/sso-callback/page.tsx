"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HandleSSOCallback } from "@clerk/nextjs";

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
  return (
    <Suspense>
      <Callback />
    </Suspense>
  );
}
