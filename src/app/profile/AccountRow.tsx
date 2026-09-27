"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { signOut } from "@/lib/authClient";

/**
 * Who this profile belongs to, and the way out.
 *
 * Takes the account from the server rather than calling `useSession()`, so it paints correct on
 * the first frame like everything else on this page — a row that says "not signed in" for a beat
 * and then corrects itself is worse than no row.
 *
 * Signed out, this is the one place in the app that asks for an account, and it asks by naming
 * what it is for. Nothing here is a gate: the profile still saves against the anonymous owner, and
 * signing in later brings it along.
 */
export default function AccountRow({ email }: { email: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (!email) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-card-border pb-5">
        <p className="text-sm text-muted">
          Not signed in — this profile lives on this browser only.
        </p>
        <Link
          href="/signin?next=/profile"
          className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-card-border pb-5">
      <p className="min-w-0 text-sm text-muted">
        Signed in as <span className="text-foreground">{email}</span>
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await signOut();
          // `refresh()` rather than a reload: every owner-scoped server component on this route
          // and the next one has to re-read, and leaving the router cache holding the signed-in
          // render would show this traveller their trips after they asked to be signed out.
          router.refresh();
          router.push("/");
        }}
        className="min-h-11 text-sm font-medium text-muted underline underline-offset-4 transition-colors hover:text-foreground disabled:opacity-60"
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
