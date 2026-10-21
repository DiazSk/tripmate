import { useSignIn } from '@clerk/expo';
import { router } from 'expo-router';
import { useState } from 'react';

import { GlassField, GlassStep, Note, SignalCapsule, useClerkStep } from '@/components/glass-auth';
import { clerkCode, clerkMessage } from '@/lib/clerkError';
import { afterEmail, looksLikeEmail } from '@/lib/emailFirst';

/**
 * The address, and nothing else. `signIn.create({ identifier })` is the question: an unknown
 * address goes on to make the account, a known one to its password, and one without a password
 * (made with Apple or Google) to a code by email (`afterEmail`).
 */
export default function SignInEmail() {
  const { signIn } = useSignIn();
  const { error, setError, step } = useClerkStep();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  async function next() {
    const address = email.trim();
    if (!looksLikeEmail(address)) return setError('That doesn’t look like an email address.');
    setBusy(true);
    setError(null);
    let failure: unknown;
    try {
      failure = (await signIn.create({ identifier: address })).error;
    } catch (err) {
      failure = err;
    }
    const code = failure ? (clerkCode(failure) ?? 'unknown') : undefined;
    const where = afterEmail(code, signIn.supportedFirstFactors ?? []);
    if (where === null) setError(clerkMessage(failure));
    else if (where === 'create') router.push({ pathname: '/signin/create', params: { email: address } });
    else if (where === 'password') router.push({ pathname: '/signin/password', params: { email: address } });
    else if (where === 'code') {
      if (await step(() => signIn.emailCode.sendCode())) router.push({ pathname: '/signin/code', params: { purpose: 'sign-in-code', email: address, step: '2' } });
    } else if (where === 'social-only') setError('This email signs in with Apple or Google. Go back and use that button.');
    setBusy(false);
  }

  return (
    <GlassStep step={1} title="What’s your email?" sub="We’ll sign you in, or make your account if you’re new.">
      <GlassField
        icon="envelope"
        autoFocus
        value={email}
        onChangeText={(v) => {
          setEmail(v);
          setError(null);
        }}
        placeholder="name@example.com"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        autoComplete="email"
        textContentType="username"
        returnKeyType="next"
        onSubmitEditing={next}
        invalid={!!error}
        accessibilityLabel="Email"
      />
      <Note error={error} />
      <SignalCapsule title="Continue" onPress={next} busy={busy} />
    </GlassStep>
  );
}
