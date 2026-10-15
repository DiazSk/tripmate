import { useSignIn, useSignUp } from '@clerk/expo';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Glass, GlassStep, Note, PlainButton, glassText, useClerkStep } from '@/components/glass-auth';
import { Polar } from '@/constants/polar';
import { unsupportedStepMessage } from '@/lib/clerkError';
import { useFinishAuth } from '@/lib/useFinishAuth';

type Purpose = 'verify-signup' | 'sign-in-code' | 'client-trust' | 'reset';

const TITLE: Record<Purpose, string> = {
  'verify-signup': 'Confirm your email',
  'sign-in-code': 'Check your email',
  'client-trust': 'New device, quick check',
  reset: 'Reset your password',
};

const RESEND_S = 30;

/**
 * The one code screen for four jobs: six cells over one real input, so typing, pasting and the
 * code iOS lifts from Mail (`oneTimeCode`) all land in the same place, and a full code submits
 * itself. Clerk keeps the in-flight sign-in or sign-up on its client, so this screen picks up
 * exactly where the last one left it; only the purpose and the address travel as params.
 *
 * A reset verifies the code here and chooses the password on the next screen, so each screen
 * asks for one thing.
 */
export default function SignInCode() {
  const { purpose: raw, email = '' } = useLocalSearchParams<{ purpose?: string; email?: string }>();
  const purpose: Purpose = raw && Object.hasOwn(TITLE, raw) ? (raw as Purpose) : 'sign-in-code';
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const finish = useFinishAuth();
  const { error, setError, step } = useClerkStep();
  const input = useRef<TextInput>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(true);
  const [resendIn, setResendIn] = useState(RESEND_S);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function submit(value: string) {
    setBusy(true);
    setError(null);
    let ok: boolean;
    if (purpose === 'verify-signup') ok = await step(() => signUp.verifications.verifyEmailCode({ code: value }));
    else if (purpose === 'sign-in-code') ok = await step(() => signIn.emailCode.verifyCode({ code: value }));
    else if (purpose === 'client-trust') ok = await step(() => signIn.mfa.verifyEmailCode({ code: value }));
    else ok = await step(() => signIn.resetPasswordEmailCode.verifyCode({ code: value }));

    if (!ok) setCode('');
    else if (purpose === 'reset') router.push({ pathname: '/signin/reset', params: { email } });
    else {
      // A step can succeed without finishing (sign-up missing fields, a second factor): say so
      // rather than leaving the traveller on a filled code.
      const resource = purpose === 'verify-signup' ? signUp : signIn;
      if (resource.status === 'complete') {
        if (await step(() => resource.finalize({ navigate: () => {} }))) await finish();
      } else setError(unsupportedStepMessage(resource));
    }
    setBusy(false);
  }

  async function resend() {
    setError(null);
    const send =
      purpose === 'verify-signup'
        ? () => signUp.verifications.sendEmailCode()
        : purpose === 'client-trust'
          ? () => signIn.mfa.sendEmailCode()
          : purpose === 'reset'
            ? () => signIn.resetPasswordEmailCode.sendCode()
            : () => signIn.emailCode.sendCode();
    if (await step(send)) setResendIn(RESEND_S);
  }

  const next = Math.min(code.length, 5);

  return (
    <GlassStep
      step={3}
      title={TITLE[purpose]}
      sub={
        <>
          A six-digit code went to <Text style={glassText.strong}>{email}</Text>. It fills in from Mail.
        </>
      }>
      {/* The cells are drawing only; the one TextInput over them is what is typed into. */}
      <Pressable onPress={() => input.current?.focus()} style={styles.code} accessible={false}>
        {Array.from({ length: 6 }, (_, i) => (
          <Glass key={i} style={styles.cell} ring={error ? Polar.alertNight : focused && i === next && !busy ? Polar.signal : null}>
            <Text style={styles.digit}>{code[i] ?? ''}</Text>
          </Glass>
        ))}
        <TextInput
          ref={input}
          value={code}
          // Ignored while a code is being checked, rather than `editable={false}`: that takes the
          // keyboard away, and a wrong code wants it back at once for the retry.
          onChangeText={(v) => {
            if (busy) return;
            const digits = v.replace(/\D/g, '').slice(0, 6);
            setCode(digits);
            setError(null);
            if (digits.length === 6) void submit(digits);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardType="number-pad"
          keyboardAppearance="dark"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={6}
          autoFocus
          caretHidden
          accessibilityLabel="Six-digit code"
          style={styles.codeInput}
        />
      </Pressable>
      <Note error={error} />
      {busy ? (
        <View style={styles.wait}>
          <ActivityIndicator color={Polar.ice} />
          <Text style={styles.waitText}>Checking the code…</Text>
        </View>
      ) : (
        <PlainButton
          title={resendIn > 0 ? `Send a new code in 0:${String(resendIn).padStart(2, '0')}` : 'Send a new code'}
          disabled={resendIn > 0}
          onPress={resend}
        />
      )}
    </GlassStep>
  );
}

const styles = StyleSheet.create({
  code: { flexDirection: 'row', gap: 8 },
  cell: { flex: 1, height: 58, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  digit: { fontSize: 26, fontWeight: '600', color: Polar.ice, fontVariant: ['tabular-nums'] },
  // Over the cells and invisible, so a tap anywhere on them lands in it and autofill has a target.
  codeInput: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0.02, color: 'transparent', fontSize: 16 },
  wait: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 44 },
  waitText: { fontSize: 15, color: Polar.frost68 },
});
