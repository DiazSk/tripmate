import { safeNextPath } from "./safeNext";

/**
 * Where a successful sign-in lands. "New" is the server's answer (`needsOnboarding` from the claim
 * call), not the client's guess: Clerk does not report new-vs-returning for Apple and Google, and
 * an email sign-up that quit mid-welcome should meet the welcome again.
 */
export function afterSignInPath({ needsOnboarding, next }: { needsOnboarding: boolean; next: string }): string {
  const safe = safeNextPath(next);
  if (!needsOnboarding) return safe;
  return safe === "/trips" ? "/welcome" : `/welcome?next=${encodeURIComponent(safe)}`;
}
