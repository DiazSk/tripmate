"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useSignIn, useSignUp } from "@clerk/nextjs";

import ErrorNote from "@/components/ErrorNote";
import { clerkMessage, unsupportedStepMessage } from "@/lib/clerkError";
import { safeNextPath } from "@/lib/safeNext";

const FIELD =
  "w-full rounded-md border border-card-border bg-white/10 px-3 py-2.5 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/25";

/** What the code field is for. `client-trust` is Clerk's Device Trust: a password sign-in from a new browser. */
type CodePurpose = "verify-signup" | "sign-in-code" | "client-trust" | "reset";

const CODE_COPY: Record<CodePurpose, string> = {
  "verify-signup": "We sent a 6-digit code to confirm your email.",
  "sign-in-code": "We sent a 6-digit code to sign you in.",
  "client-trust": "New browser — we sent a 6-digit code to confirm it's you.",
  reset: "We sent a 6-digit code. Enter it with your new password.",
};

/**
 * Sign in, make an account, or get back in — one screen, a mode toggle and a code step.
 *
 * **Nothing here is a gate.** Every path ends at `/signin/finish`, which claims what this browser
 * made signed out and routes on; see `FinishSignIn`.
 */
export default function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const finishUrl = `/signin/finish?next=${encodeURIComponent(next)}`;

  const { signIn } = useSignIn();
  const { signUp } = useSignUp();

  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [purpose, setPurpose] = useState<CodePurpose | null>(null);
  const [busy, setBusy] = useState(false);
  // `/signin/finish` sends a traveller back here with `?error=account` when Clerk signed them in
  // but this server saw no account for the session.
  const [error, setError] = useState<string | null>(
    params.get("error") === "account"
      ? "Signed in with Clerk, but this server couldn't find your account. Try again."
      : null,
  );

  const creating = mode === "up";

  /** Runs one Clerk step; a returned or thrown error is shown and stops the chain. */
  async function step(run: () => Promise<{ error?: unknown } | void>): Promise<boolean> {
    try {
      const result = await run();
      if (result && result.error) {
        setError(clerkMessage(result.error));
        return false;
      }
      return true;
    } catch (err) {
      setError(clerkMessage(err));
      return false;
    }
  }

  async function done(kind: "in" | "up") {
    const resource = kind === "up" ? signUp : signIn;
    if (await step(() => resource.finalize({ navigate: () => {} }))) router.push(finishUrl);
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (creating) {
      const ok =
        (await step(() => signUp.password({ emailAddress: email, password, firstName: name.trim() || undefined }))) &&
        (signUp.status === "complete" || (await step(() => signUp.verifications.sendEmailCode())));
      if (ok) {
        if (signUp.status === "complete") await done("up");
        else setPurpose("verify-signup");
      }
    } else if (await step(() => signIn.password({ emailAddress: email, password }))) {
      if (signIn.status === "complete") await done("in");
      else if (signIn.status === "needs_client_trust") {
        if (await step(() => signIn.mfa.sendEmailCode())) setPurpose("client-trust");
      } else setError(unsupportedStepMessage(signIn));
    }
    setBusy(false);
  }

  async function emailMeACode() {
    if (!email) return setError("Enter your email first.");
    setBusy(true);
    setError(null);
    if ((await step(() => signIn.create({ identifier: email }))) && (await step(() => signIn.emailCode.sendCode()))) {
      setPurpose("sign-in-code");
    }
    setBusy(false);
  }

  async function forgotPassword() {
    if (!email) return setError("Enter your email first.");
    setBusy(true);
    setError(null);
    if (
      (await step(() => signIn.create({ identifier: email }))) &&
      (await step(() => signIn.resetPasswordEmailCode.sendCode()))
    ) {
      setPassword("");
      setPurpose("reset");
    }
    setBusy(false);
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!purpose) return;
    setBusy(true);
    setError(null);
    const finished = (kind: "in" | "up") => (kind === "up" ? signUp : signIn).status === "complete";
    let kind: "in" | "up" = "in";
    let ok: boolean;
    if (purpose === "verify-signup") {
      kind = "up";
      ok = await step(() => signUp.verifications.verifyEmailCode({ code }));
    } else if (purpose === "sign-in-code") {
      ok = await step(() => signIn.emailCode.verifyCode({ code }));
    } else if (purpose === "client-trust") {
      ok = await step(() => signIn.mfa.verifyEmailCode({ code }));
    } else {
      // A rejected new password (breached, too weak) leaves the code already verified and the
      // status at `needs_new_password`; verifying again would error, so the retry skips it.
      ok =
        (signIn.status === "needs_new_password" || (await step(() => signIn.resetPasswordEmailCode.verifyCode({ code })))) &&
        (await step(() => signIn.resetPasswordEmailCode.submitPassword({ password, signOutOfOtherSessions: true })));
    }
    // A step can succeed without finishing (sign-up missing fields, a second factor): say so
    // rather than re-enabling the button on nothing, as `submitPassword` does.
    if (ok) {
      if (finished(kind)) await done(kind);
      else setError(unsupportedStepMessage(kind === "up" ? signUp : signIn));
    }
    setBusy(false);
  }

  async function social(strategy: "oauth_apple" | "oauth_google") {
    setError(null);
    await step(() =>
      signIn.sso({
        strategy,
        redirectCallbackUrl: `/sso-callback?next=${encodeURIComponent(next)}`,
        redirectUrl: finishUrl,
      }),
    );
  }

  const LINK = "min-h-11 text-sm font-medium text-foreground underline underline-offset-4";
  const SUBMIT =
    "w-full rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-60";
  const SECONDARY =
    "w-full rounded-full border border-card-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-white/10 disabled:opacity-60";

  return (
    <main className="map-chrome-hidden min-h-full px-5 pt-[calc(var(--nav-h)+1.25rem)] pb-16 sm:px-6 sm:pt-[calc(var(--nav-h)+1.5rem)] sm:pb-24">
      {/* `pointer-events-auto`: AppShell's scroll container is `pointer-events-none` so the globe
          stays draggable; without opting back in, clicks would reach the canvas, not the form. */}
      <div className="pointer-events-auto mx-auto w-full max-w-sm">
        <h1 className="font-display text-2xl font-semibold text-foreground">
          {purpose ? "Check your email" : creating ? "Make an account" : "Welcome back"}
        </h1>
        <p className="pt-2 text-sm text-muted">
          {purpose
            ? `${CODE_COPY[purpose]} (${email})`
            : creating
              ? "Your trips and travel profile stay with you — on this browser and on your phone."
              : "Sign in to find your trips wherever you are."}
        </p>

        {purpose ? (
          <form onSubmit={submitCode} className="space-y-3 pt-7">
            <div>
              <label htmlFor="code" className="block pb-1.5 text-xs font-medium text-muted">Code</label>
              <input
                id="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className={FIELD}
              />
            </div>
            {purpose === "reset" && (
              <div>
                <label htmlFor="new-password" className="block pb-1.5 text-xs font-medium text-muted">New password</label>
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={FIELD}
                />
              </div>
            )}
            {error && <ErrorNote>{error}</ErrorNote>}
            <button type="submit" disabled={busy} className={SUBMIT}>
              {busy ? "One moment…" : "Continue"}
            </button>
            <button
              type="button"
              className={LINK}
              onClick={() => {
                setPurpose(null);
                setCode("");
                setError(null);
              }}
            >
              Use a different email
            </button>
          </form>
        ) : (
          <>
            <form onSubmit={submitPassword} className="space-y-3 pt-7">
              {creating && (
                <div>
                  <label htmlFor="name" className="block pb-1.5 text-xs font-medium text-muted">Name</label>
                  <input id="name" type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" className={FIELD} />
                </div>
              )}
              <div>
                <label htmlFor="email" className="block pb-1.5 text-xs font-medium text-muted">Email</label>
                <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={FIELD} />
              </div>
              <div>
                <label htmlFor="password" className="block pb-1.5 text-xs font-medium text-muted">Password</label>
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
              {!creating && (
                <div className="flex flex-wrap gap-x-4">
                  <button type="button" className={LINK} onClick={emailMeACode} disabled={busy}>Email me a code instead</button>
                  <button type="button" className={LINK} onClick={forgotPassword} disabled={busy}>Forgot password?</button>
                </div>
              )}
              {error && <ErrorNote>{error}</ErrorNote>}
              <button type="submit" disabled={busy} className={SUBMIT}>
                {busy ? "One moment…" : creating ? "Create account" : "Sign in"}
              </button>
            </form>
            {/* Clerk's bot protection mounts here for custom sign-up flows. */}
            {creating && <div id="clerk-captcha" />}

            <div className="space-y-2 pt-4">
              <button type="button" className={SECONDARY} onClick={() => social("oauth_apple")}>Continue with Apple</button>
              <button type="button" className={SECONDARY} onClick={() => social("oauth_google")}>Continue with Google</button>
            </div>

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
          </>
        )}

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
