export type AuthMode = 'login' | 'signup';

/**
 * Which form to draw, from a route parameter — which is to say, from outside the app.
 *
 * **`login` for anything unrecognised, not a thrown error.** `useLocalSearchParams` hands back
 * `string | string[] | undefined`, and the form is reachable by cold-start deep link, so the
 * parameter can be missing, doubled or misspelled. A branch on `mode === 'signup'` alone would
 * have rendered the login form anyway; naming the default makes that deliberate rather than
 * accidental, and the falsy case is the one a stale `/signin/form` link actually produces.
 */
export function authMode(raw: string | string[] | undefined): AuthMode {
  return raw === 'signup' ? 'signup' : 'login';
}
