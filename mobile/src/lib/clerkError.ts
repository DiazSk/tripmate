/** The sentence for a failed Clerk call — Clerk's own wording, which already says what to do next. */
export function clerkMessage(error: unknown, fallback = "That didn't work. Try again."): string {
  if (!error || typeof error !== 'object') return fallback;
  const e = error as { errors?: { message?: string; longMessage?: string }[]; longMessage?: string; message?: string };
  const first = e.errors?.[0];
  return first?.longMessage || first?.message || e.longMessage || e.message || fallback;
}

/** Clerk's machine-readable reason (`form_identifier_not_found`, …), for branching rather than showing. */
export function clerkCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const e = error as { errors?: { code?: string }[]; code?: unknown };
  return e.errors?.[0]?.code ?? (typeof e.code === 'string' ? e.code : undefined);
}

/** The traveller closed the Apple or Google sheet. Not an error, and never shown as one. */
const CANCEL_CODES = new Set(['ERR_REQUEST_CANCELED', 'SIGN_IN_CANCELLED', '-5']);
export function isCancellation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && CANCEL_CODES.has(String((error as { code?: unknown }).code)));
}

/** Clerk's field names, said the way a traveller would read them. */
const FIELD_NAMES: Record<string, string> = {
  username: 'a username',
  phone_number: 'a phone number',
  first_name: 'your first name',
  last_name: 'your last name',
  legal_accepted: 'acceptance of the terms',
};

const GENERAL = "This account needs a sign-in step TripMate doesn't support yet.";

/**
 * What to say when a Clerk step succeeded but did not finish, instead of one sentence for every
 * case. The common cause is the Clerk dashboard requiring a field these forms do not collect (a
 * required username is how this was found), so that case names the field. The raw status goes to
 * the console as well: the traveller should not read about dashboards, but a developer needs to
 * know which setting to change.
 */
export function unsupportedStepMessage(resource: { status?: string | null; missingFields?: readonly string[] }): string {
  console.warn('Clerk step did not complete', { status: resource.status, missingFields: resource.missingFields });
  const missing = resource.missingFields ?? [];
  if (missing.length > 0) {
    const named = missing.map((field) => FIELD_NAMES[field] ?? field.replace(/_/g, ' '));
    const list = named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
    return `TripMate can't finish this sign-up: it also needs ${list}, which the app doesn't ask for yet.`;
  }
  if (resource.status === 'needs_second_factor') {
    return "This account uses two-step verification, which TripMate doesn't support yet.";
  }
  return GENERAL;
}
