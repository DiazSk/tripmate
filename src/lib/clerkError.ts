/** Copy rows S-02 and S-03: Clerk threw and gave nothing a traveller could read. */
export const SIGN_IN_OFFLINE = "You’re offline, so you couldn’t be signed in. Try again once you’re back online.";
export const SIGN_IN_UNEXPLAINED =
  "Sign-in didn’t finish, and the sign-in service didn’t say why. Try again, or email yourself a code instead.";

/**
 * The sentence to show for a failed Clerk call (copy rows S-01 to S-03). Clerk's own wording when it
 * has some, not a rewrite: it already separates a wrong password from an unknown email from a rate
 * limit, and those are different things to do next. A bare thrown error carries `e.message`
 * ("Failed to fetch", "Network Error"), which is a browser's word for a dropped request and says
 * nothing to a traveller, so it is never shown: offline says so, anything else says the service gave
 * no reason.
 */
export function clerkMessage(error: unknown, online = typeof navigator === "undefined" ? true : navigator.onLine): string {
  if (error && typeof error === "object") {
    const e = error as { errors?: { message?: string; longMessage?: string }[]; longMessage?: string };
    const first = e.errors?.[0];
    const readable = first?.longMessage || first?.message || e.longMessage;
    if (readable) return readable;
  }
  return online ? SIGN_IN_UNEXPLAINED : SIGN_IN_OFFLINE;
}

/** Clerk's field names, said the way a traveller would read them. */
const FIELD_NAMES: Record<string, string> = {
  username: "a username",
  phone_number: "a phone number",
  first_name: "your first name",
  last_name: "your last name",
  legal_accepted: "acceptance of the terms",
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
  console.warn("Clerk step did not complete", { status: resource.status, missingFields: resource.missingFields });
  const missing = resource.missingFields ?? [];
  if (missing.length > 0) {
    const named = missing.map((field) => FIELD_NAMES[field] ?? field.replace(/_/g, " "));
    const list = named.length === 1 ? named[0] : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
    return `TripMate can't finish this sign-up: it also needs ${list}, which the app doesn't ask for yet.`;
  }
  if (resource.status === "needs_second_factor") {
    return "This account uses two-step verification, which TripMate doesn't support yet.";
  }
  return GENERAL;
}
