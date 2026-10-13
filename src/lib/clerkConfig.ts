/**
 * Whether this deployment has Clerk's keys. Accounts are optional here: without both keys the app
 * runs anonymously (owner cookie, legacy bucket) and only signing in is unavailable — the same
 * degrade-don't-throw rule as every other keyed integration. Clerk's middleware and `auth()` both
 * throw when the keys are absent, so everything that would call them asks this first.
 */
export function clerkConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.CLERK_SECRET_KEY) && Boolean(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}

/**
 * Whether the browser side of Clerk can run: the publishable key alone. It is baked into the build
 * (Dockerfile build arg), so prerendered pages and runtime agree; the secret is runtime-only and is
 * checked server-side by `clerkConfigured()`.
 */
export function clerkClientConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}
