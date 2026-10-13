/**
 * The sentence to show for a failed Clerk call. Clerk's own wording, not a rewrite: it already
 * separates a wrong password from an unknown email from a rate limit, and those are different
 * things to do next.
 */
export function clerkMessage(error: unknown, fallback = "That didn't work. Try again."): string {
  if (!error || typeof error !== "object") return fallback;
  const e = error as { errors?: { message?: string; longMessage?: string }[]; longMessage?: string; message?: string };
  const first = e.errors?.[0];
  return first?.longMessage || first?.message || e.longMessage || e.message || fallback;
}
