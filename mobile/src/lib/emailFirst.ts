import { PASSWORD_MIN } from './formGap';

/**
 * Email first: one address, and the answer to it decides the rest of sign-in. This replaces the
 * Sign in / New account switch, which asked the traveller a question the server already knows.
 *
 * Here rather than in the screens for the reason `formGap.ts` gives: the screens cannot be tested.
 */

/** Enough of an address to send to Clerk; Clerk's own check is the real one. */
export const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/** How many characters a new password still needs, or null once it has enough. */
export const passwordToGo = (password: string): number | null => (password.length >= PASSWORD_MIN ? null : PASSWORD_MIN - password.length);

export type AfterEmail = 'password' | 'code' | 'create' | 'social-only';

/**
 * Where `signIn.create({ identifier })` sends the traveller next, from its error code and the
 * account's first factors. `null` means "say Clerk's error and stay".
 *
 * **An account without a password is not a dead end.** One made with Apple or Google has none, so
 * asking for a password would only ever fail: it gets a code by email if the account allows one,
 * and otherwise is pointed back at the button it was made with.
 *
 * ponytail: an instance with Clerk's enumeration protection on answers every address as known, so
 * a new address would reach the password step and fail there. Not on for TripMate; read
 * `signIn.isTransferable` after the password attempt if it ever is.
 */
export function afterEmail(errorCode: string | undefined, factors: readonly { strategy: string }[]): AfterEmail | null {
  if (errorCode === 'form_identifier_not_found') return 'create';
  if (errorCode) return null;
  if (factors.some((f) => f.strategy === 'password')) return 'password';
  if (factors.some((f) => f.strategy === 'email_code')) return 'code';
  return 'social-only';
}
