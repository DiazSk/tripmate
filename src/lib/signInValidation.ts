/**
 * The sign-in form's field checks (copy rows S-10 to S-12). The browser's own bubbles said the same
 * things in its own voice and position ("Please include an '@'…"), so the form turns them off and
 * says them under the field, in the page's.
 */

/** The shortest password Clerk accepts — this instance's own setting, mirrored so the browser can say so before the request. Change it with the Clerk dashboard, not on its own. */
export const PASSWORD_MIN = 15;

export const EMAIL_EMPTY = "Enter your email.";
export const EMAIL_MALFORMED = "That doesn’t look like an email address. Check it for typos.";
export const PASSWORD_SHORT = `Use at least ${PASSWORD_MIN} characters. A sentence you’ll remember works well.`;

/** The same test the browser's `type="email"` applies: something, an @, something. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/;

export function signInProblems(email: string, password: string): { email?: string; password?: string } {
  const e = email.trim();
  return {
    email: !e ? EMAIL_EMPTY : !EMAIL_SHAPE.test(e) ? EMAIL_MALFORMED : undefined,
    password: password.length < PASSWORD_MIN ? PASSWORD_SHORT : undefined,
  };
}
