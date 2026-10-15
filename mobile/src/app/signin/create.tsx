import { useSignUp } from '@clerk/expo';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Text, type TextInput } from 'react-native';

import { GlassField, GlassStep, Note, PasswordField, SignalCapsule, glassText, useClerkStep } from '@/components/glass-auth';
import { passwordToGo } from '@/lib/emailFirst';
import { PASSWORD_MIN } from '@/lib/formGap';
import { useFinishAuth } from '@/lib/useFinishAuth';

/**
 * An address Clerk has not seen: a name if they like, and a password. The rule is counted down as
 * it is typed rather than refused after the press, and iOS is told the rule (`passwordRules`) so a
 * suggested strong password already meets it.
 */
export default function SignInCreate() {
  const { email = '' } = useLocalSearchParams<{ email?: string }>();
  const { signUp } = useSignUp();
  const finish = useFinishAuth();
  const { error, setError, step } = useClerkStep();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const passwordField = useRef<TextInput>(null);
  const left = passwordToGo(password);

  async function submit() {
    if (left !== null) {
      setError(`Use at least ${PASSWORD_MIN} characters.`);
      passwordField.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const ok =
      (await step(() => signUp.password({ emailAddress: email, password, firstName: name.trim() || undefined }))) &&
      (signUp.status === 'complete' || (await step(() => signUp.verifications.sendEmailCode())));
    if (ok) {
      if (signUp.status === 'complete') {
        if (await step(() => signUp.finalize({ navigate: () => {} }))) await finish();
      } else router.push({ pathname: '/signin/code', params: { purpose: 'verify-signup', email } });
    }
    setBusy(false);
  }

  return (
    <GlassStep step={2} title="Make your account" sub={email}>
      <GlassField
        icon="person"
        value={name}
        onChangeText={setName}
        placeholder="Name (optional)"
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        returnKeyType="next"
        onSubmitEditing={() => passwordField.current?.focus()}
        accessibilityLabel="Name, optional"
      />
      <PasswordField
        ref={passwordField}
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
      <SignalCapsule title="Create account" onPress={submit} busy={busy} />
    </GlassStep>
  );
}
