/**
 * Whether this deployment has Clerk's keys. Accounts are optional here: without both keys the app
 * runs anonymously (owner cookie, legacy bucket) and only signing in is unavailable — the same
 * degrade-don't-throw rule as every other keyed integration. Clerk's middleware and `auth()` both
 * throw when the keys are absent, so everything that would call them asks this first.
 */
export function clerkConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.CLERK_SECRET_KEY) && Boolean(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}
