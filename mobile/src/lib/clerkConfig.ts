/**
 * The Clerk publishable key, or undefined when this build has none. Read as the literal
 * `process.env.EXPO_PUBLIC_…` because Metro inlines only that exact expression. Without a key the
 * app runs signed-out only: no provider, no bridge, and the launch gate never opens on sign-in.
 */
export const CLERK_PUBLISHABLE_KEY: string | undefined = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || undefined;
