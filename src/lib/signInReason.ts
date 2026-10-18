/**
 * Why `/signin` was reopened with a reason in its address (copy rows S-05 and S-14):
 * `?error=account` from `/signin/finish` when Clerk signed the traveller in but this server saw no
 * account, `?error=sso&provider=` from `/sso-callback` when Apple or Google asked for a step the
 * form can't show.
 */
const PROVIDER_NAMES: Record<string, string> = { apple: "Apple", google: "Google" };

export function signInReason(params: { get(name: string): string | null }): string | null {
  const reason = params.get("error");
  if (reason === "account") {
    return "You signed in, but TripMate couldn’t open your account on this server. Sign in again; if it keeps happening, this server’s account setup needs fixing.";
  }
  if (reason === "sso") {
    // A name from a fixed list, never the address's own text; unknown reads as "that account".
    const who = PROVIDER_NAMES[params.get("provider") ?? ""] ?? "that account";
    return `Signing in with ${who} needs a step TripMate can’t show yet. Sign in with your email instead, or try ${who} again.`;
  }
  return null;
}
