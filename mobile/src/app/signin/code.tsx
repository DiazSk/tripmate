import { useSignIn, useSignUp } from '@clerk/expo';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FieldTrough, PillButton, PrimaryButton, TextField } from '@/components/form';
import { BAND_RATIO_FORM, SceneWindow } from '@/components/scene-band';
import { Notice } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { Colors, MaxContentWidth, Spacing } from '@/constants/theme';
import { clerkMessage, unsupportedStepMessage } from '@/lib/clerkError';
import { PASSWORD_MIN } from '@/lib/formGap';
import { useFinishAuth } from '@/lib/useFinishAuth';

type Purpose = 'verify-signup' | 'sign-in-code' | 'client-trust' | 'reset';

const COPY: Record<Purpose, { title: string; blurb: string }> = {
  'verify-signup': { title: 'Confirm your email', blurb: 'We sent a 6-digit code to' },
  'sign-in-code': { title: 'Check your email', blurb: 'We sent a 6-digit sign-in code to' },
  'client-trust': { title: 'New device', blurb: "To confirm it's you, we sent a 6-digit code to" },
  reset: { title: 'Choose a new password', blurb: 'Enter the 6-digit code we sent to' },
};

/**
 * The one code screen for four jobs. Clerk keeps the in-flight sign-in or sign-up on its client, so
 * this screen picks up exactly where `form.tsx` left it; only the purpose and the address travel as
 * params. Inside the `signin/` group, so the photograph behind and the transition stay as they are.
 */
export default function AuthCodeScreen() {
  const { purpose: raw, email } = useLocalSearchParams<{ purpose?: string; email?: string }>();
  const purpose: Purpose = raw && Object.hasOwn(COPY, raw) ? (raw as Purpose) : 'sign-in-code';
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const finish = useFinishAuth();
  const insets = useSafeAreaInsets();

  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  async function step(run: () => Promise<{ error?: unknown } | void>): Promise<boolean> {
    try {
      const result = await run();
      if (result && result.error) {
        setError(clerkMessage(result.error));
        return false;
      }
      return true;
    } catch (err) {
      setError(clerkMessage(err));
      return false;
    }
  }

  /** Why Continue would get nowhere yet. The button stays live and says so on press (DESIGN.md). */
  const gap =
    code.trim().length !== 6
      ? 'Enter the 6-digit code.'
      : purpose === 'reset' && password.length < PASSWORD_MIN
        ? `Use at least ${PASSWORD_MIN} characters for your new password.`
        : undefined;

  async function submit() {
    if (gap) {
      setError(gap);
      return;
    }
    setBusy(true);
    setError(null);
    const resource = purpose === 'verify-signup' ? signUp : signIn;
    let ok: boolean;
    if (purpose === 'verify-signup') {
      ok = await step(() => signUp.verifications.verifyEmailCode({ code }));
    } else if (purpose === 'sign-in-code') {
      ok = await step(() => signIn.emailCode.verifyCode({ code }));
    } else if (purpose === 'client-trust') {
      ok = await step(() => signIn.mfa.verifyEmailCode({ code }));
    } else {
      // A rejected new password (breached, too weak) leaves the code already verified and the
      // status at `needs_new_password`; verifying again would error, so the retry skips it.
      ok =
        (signIn.status === 'needs_new_password' || (await step(() => signIn.resetPasswordEmailCode.verifyCode({ code })))) &&
        (await step(() => signIn.resetPasswordEmailCode.submitPassword({ password, signOutOfOtherSessions: true })));
    }
    // A step can succeed without finishing (sign-up missing fields, a second factor): say so
    // rather than re-enabling the button on nothing.
    if (ok) {
      if (resource.status === 'complete') {
        if (await step(() => resource.finalize({ navigate: () => {} }))) await finish();
      } else setError(unsupportedStepMessage(resource));
    }
    setBusy(false);
  }

  async function resend() {
    setError(null);
    const sent =
      purpose === 'verify-signup'
        ? await step(() => signUp.verifications.sendEmailCode())
        : purpose === 'client-trust'
          ? await step(() => signIn.mfa.sendEmailCode())
          : purpose === 'reset'
            ? await step(() => signIn.resetPasswordEmailCode.sendCode())
            : await step(() => signIn.emailCode.sendCode());
    setResent(sent);
  }

  return (
    <View style={styles.flex}>
      <SceneWindow ratio={BAND_RATIO_FORM} />
      <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.regular }]}
          keyboardShouldPersistTaps="handled">
          <ThemedText type="title">{COPY[purpose].title}</ThemedText>
          <ThemedText type="detail" themeColor="muted" style={styles.blurb}>
            {COPY[purpose].blurb} {email}.
          </ThemedText>
          <View style={styles.form}>
            <FieldTrough>
              <TextField
                label="Code"
                value={code}
                onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                autoFocus
              />
              {purpose === 'reset' ? (
                <TextField
                  label="New password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="new-password"
                  textContentType="newPassword"
                />
              ) : null}
            </FieldTrough>
            {error ? <Notice>{error}</Notice> : null}
            {resent ? (
              <ThemedText type="detail" themeColor="muted" style={styles.hint}>
                Sent again.
              </ThemedText>
            ) : null}
            <PrimaryButton title="Continue" onPress={submit} busy={busy} accessibilityHint={gap} />
            <PillButton title="Send it again" onPress={resend} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { flex: 1, backgroundColor: Colors.canvas },
  content: { paddingHorizontal: Spacing.read, paddingTop: Spacing.regular, maxWidth: MaxContentWidth, width: '100%', alignSelf: 'center' },
  blurb: { paddingTop: Spacing.tight },
  form: { paddingTop: Spacing.regular, gap: Spacing.read },
  hint: { paddingHorizontal: Spacing.hair },
});
