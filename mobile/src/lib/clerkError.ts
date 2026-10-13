/** The sentence for a failed Clerk call — Clerk's own wording, which already says what to do next. */
export function clerkMessage(error: unknown, fallback = "That didn't work. Try again."): string {
  if (!error || typeof error !== 'object') return fallback;
  const e = error as { errors?: { message?: string; longMessage?: string }[]; longMessage?: string; message?: string };
  const first = e.errors?.[0];
  return first?.longMessage || first?.message || e.longMessage || e.message || fallback;
}

/** The traveller closed the Apple or Google sheet. Not an error, and never shown as one. */
const CANCEL_CODES = new Set(['ERR_REQUEST_CANCELED', 'SIGN_IN_CANCELLED', '-5']);
export function isCancellation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && CANCEL_CODES.has(String((error as { code?: unknown }).code)));
}
