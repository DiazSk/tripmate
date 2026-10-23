import { LEGACY_OWNER, isValidOwnerId } from "../owner";

/**
 * The anonymous owner id a device holds in its cookie, when it is a different owner from the one the
 * request resolved to (a signed-in device holds both). Null for anything that must never take or
 * give an analytics answer: nothing, the same owner, the shared legacy bucket, a malformed id, or an
 * account's own id (it names someone else's answer, and appears in their avatar URL).
 */
export function deviceOwner(cookieOwner: string | undefined, ownerId: string, isAccountOwner: (id: string) => boolean): string | null {
  if (!cookieOwner || cookieOwner === ownerId || cookieOwner === LEGACY_OWNER) return null;
  if (!isValidOwnerId(cookieOwner) || isAccountOwner(cookieOwner)) return null;
  return cookieOwner;
}

/** Every owner row a consent answer is written to, so a No reaches each id this device could be captured under. */
export function consentOwners(ownerId: string, cookieOwner: string | undefined, isAccountOwner: (id: string) => boolean): string[] {
  const device = deviceOwner(cookieOwner, ownerId, isAccountOwner);
  return device ? [ownerId, device] : [ownerId];
}

/**
 * The rows one answer is written to, and they are not symmetric. A No goes to every owner the
 * device holds, so it reaches each id this device could be captured under. A Yes goes only to the
 * request's own owner: written to a signed-in device's anonymous row as well, it would be inherited
 * by the next account to sign in from this browser, who has said nothing.
 */
export function consentWriteOwners(yes: boolean, ownerId: string, cookieOwner: string | undefined, isAccountOwner: (id: string) => boolean): string[] {
  return yes ? [ownerId] : consentOwners(ownerId, cookieOwner, isAccountOwner);
}
