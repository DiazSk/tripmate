"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { HandleSSOCallback } from "@clerk/nextjs";

export default function Callback() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") ?? "/trips";
  // Which provider this was, from the form's own redirect, so the form can name it (copy row S-14).
  const provider = search.get("provider");
  const finish = `/signin/finish?next=${encodeURIComponent(next)}${provider ? `&method=${encodeURIComponent(provider)}` : ""}`;
  const backToForm = `/signin?next=${encodeURIComponent(next)}&error=sso${provider ? `&provider=${encodeURIComponent(provider)}` : ""}`;
  return (
    <HandleSSOCallback
      navigateToApp={({ decorateUrl }) => {
        const url = decorateUrl(finish);
        if (url.startsWith("http")) window.location.href = url;
        else router.push(url);
      }}
      // Extra verification or missing sign-up fields: back to the form, with the reason (S-14). It
      // used to arrive with no sign that anything had gone wrong.
      navigateToSignIn={() => router.push(backToForm)}
      navigateToSignUp={() => router.push(backToForm)}
    />
  );
}
