import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { needsOnboarding, readProfile } from "@/lib/db";
import WelcomeFlow from "./WelcomeFlow";

/** Only ever reached from sign-up. Signed out goes to sign in; already welcomed goes to Trips. */
export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/signin?next=/welcome");
  if (!needsOnboarding(session.user.id)) redirect("/trips");
  const { next } = await searchParams;
  // A relative path only — never `//host`, never a scheme — so the Ready link cannot leave the site.
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/trips";
  return (
    <Suspense>
      <WelcomeFlow
        user={{ id: session.user.id, name: session.user.name ?? "", image: session.user.image ?? null }}
        profile={readProfile(session.user.id)}
        next={safeNext}
      />
    </Suspense>
  );
}
