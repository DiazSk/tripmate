import { redirect } from "next/navigation";
import { Suspense } from "react";
import { needsOnboarding, readProfile } from "@/lib/db";
import { currentAccount } from "@/lib/ownerRequest";
import { safeNextPath } from "@/lib/safeNext";
import WelcomeFlow from "./WelcomeFlow";

/** Only ever reached after sign-up. Signed out goes to sign in; already welcomed goes to Trips. */
export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const account = await currentAccount();
  if (!account) redirect("/signin?next=/welcome");
  if (!needsOnboarding(account.id)) redirect("/trips");
  const { next } = await searchParams;
  return (
    <Suspense>
      <WelcomeFlow
        user={{ id: account.id, name: account.name ?? "", image: account.image }}
        profile={readProfile(account.id)}
        next={safeNextPath(next)}
      />
    </Suspense>
  );
}
