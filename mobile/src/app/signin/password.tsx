import { useSignIn } from '@clerk/expo';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { GlassButton, GlassStep, Note, Pair, PasswordField, SignalCapsule, useClerkStep } from '@/components/glass-auth';
import { unsupportedStepMessage } from '@/lib/clerkError';
import { useFinishAuth } from '@/lib/useFinishAuth';

type Busy = 'password' | 'code' | 'reset' | null;

/**
 * A known address, its password. The two other ways on are buttons rather than links, side by
 * side under the action: a sign-in code by email, and a reset. A new device (Clerk's client trust)
 * is a code step too, so the traveller meets it as one more screen and not as an error.
 */
export default function SignInPassword() {
  const { email = '' } = useLocalSearchParams<{ email?: string }>();
  const { signIn } = useSignIn();
  const finish = useFinishAuth();
  const { error, setError, step } = useClerkStep();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<Busy>(null);

  const toCode = (purpose: 'sign-in-code' | 'client-trust' | 'reset') => router.push({ pathname: '/signin/code', params: { purpose, email } });

  async function submit() {
    if (!password) return setError('Add your password, or have a code emailed instead.');
    setBusy('password');
    setError(null);
    if (await step(() => signIn.password({ emailAddress: email, password }))) {
      if (signIn.status === 'complete') {
        if (await step(() => signIn.finalize({ navigate: () => {} }))) await finish();
      } else if (signIn.status === 'needs_client_trust') {
        if (await step(() => signIn.mfa.sendEmailCode())) toCode('client-trust');
      } else setError(unsupportedStepMessage(signIn));
    }
    setBusy(null);
  }

  /** Code-first routes need only the address, which this sign-in already carries. */
  async function byCode(which: 'code' | 'reset') {
    setBusy(which);
    setError(null);
    const send = which === 'code' ? () => signIn.emailCode.sendCode() : () => signIn.resetPasswordEmailCode.sendCode();
    if ((await step(() => signIn.create({ identifier: email }))) && (await step(send))) toCode(which === 'code' ? 'sign-in-code' : 'reset');
    setBusy(null);
  }

  return (
    <GlassStep step={2} title="Welcome back" sub={email}>
      <PasswordField
        autoFocus
        value={password}
        onChangeText={(v) => {
          setPassword(v);
          setError(null);
        }}
        returnKeyType="go"
        onSubmitEditing={submit}
        invalid={!!error}
        accessibilityLabel="Password"
      />
      <Note error={error} />
      <SignalCapsule title="Sign in" onPress={submit} busy={busy === 'password'} />
      <Pair>
        <GlassButton small title="Email a code" onPress={() => byCode('code')} busy={busy === 'code'} />
        <GlassButton small title="Forgot password" onPress={() => byCode('reset')} busy={busy === 'reset'} />
      </Pair>
    </GlassStep>
  );
}
