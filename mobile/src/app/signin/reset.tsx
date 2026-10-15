import { useSignIn } from '@clerk/expo';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';

import { GlassStep, Note, PasswordField, SignalCapsule, glassText, useClerkStep } from '@/components/glass-auth';
import { unsupportedStepMessage } from '@/lib/clerkError';
import { passwordToGo } from '@/lib/emailFirst';
import { PASSWORD_MIN } from '@/lib/formGap';
import { useFinishAuth } from '@/lib/useFinishAuth';

/**
 * The reset's last screen, reached only from a verified code (`code.tsx`), so the sign-in is at
 * `needs_new_password`. A rejected password (breached, too weak) keeps it there, which is why a
 * retry here needs no second code. Other devices are signed out with it.
 */
export default function SignInReset() {
  const { email = '' } = useLocalSearchParams<{ email?: string }>();
  const { signIn } = useSignIn();
  const finish = useFinishAuth();
  const { error, setError, step } = useClerkStep();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const left = passwordToGo(password);

  async function submit() {
    if (left !== null) return setError(`Use at least ${PASSWORD_MIN} characters.`);
    setBusy(true);
    setError(null);
    if (await step(() => signIn.resetPasswordEmailCode.submitPassword({ password, signOutOfOtherSessions: true }))) {
      if (signIn.status === 'complete') {
        if (await step(() => signIn.finalize({ navigate: () => {} }))) await finish();
      } else setError(unsupportedStepMessage(signIn));
    }
    setBusy(false);
  }

  return (
    <GlassStep
      step={3}
      title="Choose a new password"
      sub={
        <>
          For <Text style={glassText.strong}>{email}</Text>. Your other devices are signed out.
        </>
      }>
      <PasswordField
        fresh
        autoFocus
        value={password}
        onChangeText={(v) => {
          setPassword(v);
          setError(null);
        }}
        returnKeyType="go"
        onSubmitEditing={submit}
        invalid={!!error}
        accessibilityLabel="New password"
      />
      <Note error={error}>
        {left === null ? <Text style={glassText.ok}>Long enough</Text> : `At least ${PASSWORD_MIN} characters · ${left} to go`}
      </Note>
      <SignalCapsule title="Save and sign in" onPress={submit} busy={busy} />
    </GlassStep>
  );
}
