"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

import { signIn, signUp } from "@/lib/authClient";
import { useToast } from "@/lib/toast";
import ErrorNote from "@/components/ErrorNote";
import { ACCOUNT_CREATED_KEY } from "@/components/AccountReceipt";

const FIELD =
  "w-full rounded-md border border-card-border bg-white/10 px-3 py-2.5 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/25";

/**
 * Sign in, or make an account, on one screen.
 *
 * Deliberately one route with a mode toggle rather than `/signin` and `/signup`. The two forms
 * differ by a single field, and somebody who typed their email into the wrong one should not have
 * to retype it — the toggle keeps what they have entered.
 *
 * **Nothing here is a gate.** The landing page, the plan wizard and generation all stay reachable
 * signed out, and a traveller arrives at this screen because they chose to keep something, not
 * because the app stopped them. What signing in buys is stated plainly rather than assumed: the
 * trips made on this device follow the account (`claimAnonymousOwner`, via the session hook), so
 * this is additive and there is nothing to lose by doing it later.
 */
export default function SignInForm() {
  const router = useRouter();
  const toast = useToast();
  const params = useSearchParams();
  // Where to land afterwards. `/trips` by default because the memories wall is the thing signing
  // in actually changes — arriving back at a page that looks identical is a poor confirmation.
  const next = params.get("next") ?? "/trips";

  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const creating = mode === "up";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const result = creating
      ? await signUp.email({ email, password, name: name.trim() || email.split("@")[0] })
      : await signIn.email({ email, password });

    if (result.error) {
      // The library's own message, not a rewrite of it: it already distinguishes a wrong password
      // from an email that is already registered, and those are different things to do next.
      setError(result.error.message ?? "That didn't work. Try again.");
      setBusy(false);
      return;
    }

    const who = result.data?.user?.name?.trim() || null;

    if (creating) {
      /**
       * Hand the count to the receipt rather than announcing it here.
       *
       * The claim has already run server-side by this point (`session.create.after`), so this list
       * *is* the post-claim set — for an account made seconds ago, every trip on it arrived that
       * way. `sessionStorage` because the confirmation belongs on the page being navigated to, and
       * survives exactly one client-side navigation and no reloads, which is the lifetime wanted.
       *
       * Best-effort: a failed count writes `0`, which the receipt still renders truthfully. Never
       * block the redirect on it — the traveller has an account either way.
       */
      let claimed = 0;
      try {
        const res = await fetch("/api/trips?status=saved");
        if (res.ok) {
          const body = (await res.json()) as { trips?: unknown[] };
          claimed = Array.isArray(body.trips) ? body.trips.length : 0;
        }
      } catch {
        // Counted as none rather than not shown — see above.
      }
      sessionStorage.setItem(ACCOUNT_CREATED_KEY, String(claimed));
    } else {
      // Signing in is the ordinary act, and its only invisible result is that the trips on the
      // destination page are now yours. That is exactly what `toast.tsx` reserves itself for.
      toast.show(
        who ? `Signed in as ${who}` : "Signed in",
        "Your trips and travel profile are here."
      );
    }

    // `refresh()` before navigating, and this is load-bearing rather than belt-and-braces.
    // `/trips` and `/profile` are server components that read the owner at render time; without
    // refreshing, Next can serve them from the client router cache as they looked a moment ago —
    // signed out, and empty. The claim has already run server-side by this point.
    router.refresh();
    // A new account is welcomed first; `next` rides along so Ready can offer the way back.
    router.push(creating ? `/welcome${next !== "/trips" ? `?next=${encodeURIComponent(next)}` : ""}` : next);
  }

  return (
    <main className="map-chrome-hidden min-h-full px-5 pt-[calc(var(--nav-h)+1.25rem)] pb-16 sm:px-6 sm:pt-[calc(var(--nav-h)+1.5rem)] sm:pb-24">
      {/* `pointer-events-auto`: this sits inside AppShell's `pointer-events-none` scroll container,
          which is what keeps the globe underneath draggable. Without opting back in, every click
          would pass through to the canvas instead of reaching the form. */}
      <div className="pointer-events-auto mx-auto w-full max-w-sm">
        <h1 className="font-display text-2xl font-semibold text-foreground">
          {creating ? "Make an account" : "Welcome back"}
        </h1>
        <p className="pt-2 text-sm text-muted">
          {creating
            ? "Your trips and travel profile stay with you — on this browser and on your phone."
            : "Sign in to find your trips wherever you are."}
        </p>

        <form onSubmit={submit} className="space-y-3 pt-7">
          {creating && (
            <div>
              <label htmlFor="name" className="block pb-1.5 text-xs font-medium text-muted">
                Name
              </label>
              <input
                id="name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Optional"
                className={FIELD}
              />
            </div>
          )}

          <div>
            <label htmlFor="email" className="block pb-1.5 text-xs font-medium text-muted">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={FIELD}
            />
          </div>

          <div>
            <label htmlFor="password" className="block pb-1.5 text-xs font-medium text-muted">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              // The browser needs telling which of the two this is, or it offers to fill a new
              // password into a sign-in box and to autofill an old one into a sign-up box.
              autoComplete={creating ? "new-password" : "current-password"}
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={FIELD}
            />
            {creating && <p className="pt-1.5 text-xs text-muted">At least 8 characters.</p>}
          </div>

          {/* `ErrorNote` rather than a bare paragraph: this was the only use of `--danger` in the
              app, a token nothing else defines, with a hard-coded hex fallback. Every other error
              in this product is this component. */}
          {error && <ErrorNote>{error}</ErrorNote>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            {busy ? "One moment…" : creating ? "Create account" : "Sign in"}
          </button>
        </form>

        <p className="pt-5 text-sm text-muted">
          {creating ? "Already have an account?" : "New here?"}{" "}
          <button
            type="button"
            onClick={() => {
              setMode(creating ? "in" : "up");
              setError(null);
            }}
            className="min-h-11 font-medium text-foreground underline underline-offset-4"
          >
            {creating ? "Sign in" : "Make one"}
          </button>
        </p>

        <p className="pt-2 text-sm text-muted">
          Or{" "}
          <Link href="/" className="font-medium text-foreground underline underline-offset-4">
            keep planning without an account
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
