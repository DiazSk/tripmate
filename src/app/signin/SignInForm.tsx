"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useSignIn, useSignUp } from "@clerk/nextjs";

import GoogleMark from "@/components/GoogleMark";
import { SignInPassFrame } from "./SignInPassFrame";
import { clerkMessage, unsupportedStepMessage } from "@/lib/clerkError";
import { safeNextPath } from "@/lib/safeNext";

/**
 * The shortest password Clerk accepts — this instance's own setting, mirrored so the browser can say
 * so before the request. Change it with the Clerk dashboard, not on its own.
 */
const PASSWORD_MIN = 15;

/** What the code field is for. `client-trust` is Clerk's Device Trust: a password sign-in from a new browser. */
type CodePurpose = "verify-signup" | "sign-in-code" | "client-trust" | "reset";

const CODE_COPY: Record<CodePurpose, string> = {
  "verify-signup": "We sent a 6-digit code to confirm your email.",
  "sign-in-code": "We sent a 6-digit code to sign you in.",
  "client-trust": "New browser, so we sent a 6-digit code to confirm it's you.",
  reset: "We sent a 6-digit code. Enter it with your new password.",
};

/**
 * Sign in, make an account, or get back in — one screen, a mode toggle and a code step, drawn as
 * the canvas design "Sign in · B Boarding pass" (`SignInPassFrame`, `polar/SignInPass.css`).
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

  // The name only counts while making an account, the one mode that asks for it.
  const passenger = (creating && name.trim()) || email.trim().split("@")[0] || "You";
  const stage = purpose ? "At the gate" : creating ? "Check-in" : "Boarding";
  const title = purpose ? "Check your email" : creating ? "Make an account" : "Welcome back";
  const lead = purpose
    ? `${CODE_COPY[purpose]} (${email})`
    : creating
      ? "Your trips and travel profile stay with you, on this browser and on your phone."
      : "Sign in to find your trips wherever you are.";

  return (
    <SignInPassFrame>
      <article className="sp-pass" aria-labelledby="sp-title">
        <section className="sp-main">
          <header className="sp-head">
            <p className="tm-eyebrow sp-stage-word">{stage}</p>
            {/* Two toggle buttons in a named group, as `/trips` does: no tab keyboard contract is
                implemented, so the tab roles are not claimed. */}
            {!purpose && (
              <div className="sp-switch" role="group" aria-label="Sign in or make an account">
                {(["in", "up"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={mode === m}
                    onClick={() => {
                      setMode(m);
                      setError(null);
                    }}
                  >
                    {m === "in" ? "Sign in" : "New account"}
                  </button>
                ))}
              </div>
            )}
          </header>
          <h1 id="sp-title" className="sp-title">
            {title}
          </h1>
          <p className="sp-lead">{lead}</p>

          {purpose ? (
            <form onSubmit={submitCode} className="sp-fields">
              <div className="sp-field">
                <label htmlFor="code" className="sp-label">
                  Code
                </label>
                <div className="sp-code">
                  <input
                    id="code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    required
                    autoFocus
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  />
                  {Array.from({ length: 6 }, (_, i) => (
                    <span key={i} aria-hidden="true" className={`sp-cell${i === code.length ? " is-next" : ""}${code[i] ? " has" : ""}`}>
                      {code[i] ?? ""}
                    </span>
                  ))}
                </div>
              </div>
              {purpose === "reset" && (
                <div className="sp-field">
                  <label htmlFor="new-password" className="sp-label">
                    New password
                  </label>
                  <input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    minLength={PASSWORD_MIN}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="sp-input"
                  />
                  <p className="sp-hint">At least {PASSWORD_MIN} characters.</p>
                </div>
              )}
              {error && (
                <p className="sp-error" role="alert">
                  {error}
                </p>
              )}
              <button type="submit" disabled={busy} className="tm-signal tm-signal-lg sp-wide">
                {busy ? "One moment…" : "Continue"}
              </button>
              <button
                type="button"
                className="sp-link"
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
              <form onSubmit={submitPassword} className="sp-fields">
                {creating && (
                  <div className="sp-field">
                    <label htmlFor="name" className="sp-label">
                      Name <span className="sp-optional">Optional</span>
                    </label>
                    <input id="name" type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className="sp-input" />
                  </div>
                )}
                <div className="sp-field">
                  <label htmlFor="email" className="sp-label">
                    Email
                  </label>
                  <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="sp-input" />
                </div>
                <div className="sp-field">
                  <label htmlFor="password" className="sp-label">
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    required
                    // The browser needs telling which of the two this is, or it offers to fill a new
                    // password into a sign-in box and to autofill an old one into a sign-up box.
                    autoComplete={creating ? "new-password" : "current-password"}
                    minLength={PASSWORD_MIN}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="sp-input"
                  />
                  {creating ? (
                    <p className="sp-hint">At least {PASSWORD_MIN} characters. A sentence you will remember works well.</p>
                  ) : (
                    <div className="sp-links">
                      <button type="button" className="sp-link" onClick={emailMeACode} disabled={busy}>
                        Email me a code instead
                      </button>
                      <button type="button" className="sp-link" onClick={forgotPassword} disabled={busy}>
                        Forgot password?
                      </button>
                    </div>
                  )}
                </div>
                {error && (
                  <p className="sp-error" role="alert">
                    {error}
                  </p>
                )}
                <button type="submit" disabled={busy} className="tm-signal tm-signal-lg sp-wide">
                  {busy ? "One moment…" : creating ? "Create account" : "Sign in"}
                </button>
              </form>
              {/* Clerk's bot protection mounts here for custom sign-up flows. */}
              {creating && <div id="clerk-captcha" />}

              {/* The same "or" rule the phone draws: Apple and Google are another way to do this
                  form's one job, so they sit under it rather than beside it. */}
              <div className="sp-or" aria-hidden="true">
                <span />
                <em>or</em>
                <span />
              </div>
              <div className="sp-social">
                <button type="button" className="sp-apple" onClick={() => social("oauth_apple")}>
                  <AppleMark />
                  Continue with Apple
                </button>
                <button type="button" className="sp-google" onClick={() => social("oauth_google")}>
                  <GoogleMark />
                  Continue with Google
                </button>
              </div>

              <p className="sp-switch-line">
                {creating ? "Already have an account?" : "New here?"}
                <button
                  type="button"
                  onClick={() => {
                    setMode(creating ? "in" : "up");
                    setError(null);
                  }}
                  className="sp-link"
                >
                  {creating ? "Sign in" : "Make one"}
                </button>
              </p>
            </>
          )}
        </section>

        {/* The stub fills in from what is typed: the traveller as the passenger, this browser as
            where the trips come from, every device as where they go. At the code step it becomes
            the gate code, in the monument's own face. */}
        <aside className="sp-stub" aria-label="Your pass">
          <div className="sp-perf" aria-hidden="true" />
          <dl className="sp-rows">
            <div>
              <dt>Passenger</dt>
              <dd className="sp-passenger">{passenger}</dd>
            </div>
            <div>
              <dt>From</dt>
              <dd>This browser</dd>
            </div>
            <div>
              <dt>To</dt>
              <dd>Your phone and any browser</dd>
            </div>
            <div>
              <dt>Carrying</dt>
              <dd>Your trips and travel profile</dd>
            </div>
          </dl>
          {purpose ? (
            <div className="sp-gate">
              <p className="tm-eyebrow">Gate code</p>
              <p className="sp-gate-code" aria-hidden="true">
                {Array.from({ length: 6 }, (_, i) => (
                  <span key={i}>{code[i] ?? "·"}</span>
                ))}
              </p>
              <p className="tm-caption sp-gate-note">{CODE_COPY[purpose]}</p>
            </div>
          ) : (
            <div className="sp-gate">
              <p className="tm-eyebrow">Seat</p>
              <p className="sp-seat">ANY</p>
              <p className="tm-caption sp-gate-note">No account is needed to plan. This only keeps what you plan.</p>
            </div>
          )}
        </aside>
      </article>

      <p className="tm-caption tm-on-dark sp-below">
        Anything you planned on this browser comes with you.{" "}
        <Link href="/">Keep planning without an account</Link>
      </p>
    </SignInPassFrame>
  );
}

function AppleMark() {
  return (
    <svg width="17" height="20" viewBox="0 0 17 20" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M14.1 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9C3.6 4.8 1.9 5.8 1 7.4c-1.9 3.3-.5 8.1 1.3 10.8.9 1.3 2 2.7 3.4 2.7 1.3-.1 1.9-.9 3.5-.9s2.1.9 3.5.8c1.4 0 2.4-1.3 3.2-2.6 1-1.5 1.4-2.9 1.4-3-.1 0-2.9-1.1-2.9-4.3zM11.5 3c.7-.9 1.2-2 1.1-3.2-1 0-2.3.7-3 1.6-.7.8-1.3 2-1.1 3.1 1.1.1 2.3-.6 3-1.5z"
      />
    </svg>
  );
}
