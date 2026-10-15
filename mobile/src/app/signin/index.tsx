import { router } from 'expo-router';

import { Fine, GlassButton, GlassStep, PlainButton, leaveSignIn } from '@/components/glass-auth';
import { SocialSignIn } from '@/components/social-sign-in';

/**
 * The way in: Apple, Google, or an email, over the night. Canvas design "Phone auth · 3 Glass over
 * the night".
 *
 * **Nothing is gated by it.** Planning, generating and saving all work signed out under the
 * anonymous owner, and the server claims that work on session creation; "Not now" and the close
 * button both leave without a cost.
 *
 * **No Sign in / New account switch.** The email step asks Clerk whether the address has an account
 * (`lib/emailFirst.ts`), so the traveller is never asked a question the server can answer.
 */
export default function SignInStart() {
  return (
    <GlassStep title="Your trips, on every phone and the web.">
      <SocialSignIn />
      <GlassButton icon="envelope" title="Continue with email" onPress={() => router.push('/signin/email')} />
      <PlainButton title="Not now, keep planning" onPress={leaveSignIn} />
      <Fine>No account is needed to plan. One keeps what you plan.</Fine>
    </GlassStep>
  );
}
