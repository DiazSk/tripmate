"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { HandleSSOCallback } from "@clerk/nextjs";

export default function Callback() {
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
