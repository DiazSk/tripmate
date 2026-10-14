import { useSignIn, useSignUp } from '@clerk/expo';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Pass, PassBelow, PassScreen, StubFoot, StubRows, passStyles } from '@/components/boarding-pass';
import { PaperError, PaperInput, QuietLink, SignalButton } from '@/components/polar-ui';
import { Polar, PolarFonts, PolarRadius, PolarSpace } from '@/constants/polar';
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
 * The one code screen for four jobs, drawn as the pass at the gate: six cells over one real input
 * (so typing, pasting and one-time-code autofill all work), and the stub's gate code fills in as
 * you type. Clerk keeps the in-flight sign-in or sign-up on its client, so this screen picks up
 * exactly where the pass left it; only the purpose, the address and the passenger travel as params.
 */
export default function AuthCodeScreen() {
  const { purpose: raw, email, passenger } = useLocalSearchParams<{ purpose?: string; email?: string; passenger?: string }>();
  const purpose: Purpose = raw && Object.hasOwn(COPY, raw) ? (raw as Purpose) : 'sign-in-code';
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const finish = useFinishAuth();
  const input = useRef<TextInput>(null);

  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [focused, setFocused] = useState(true);

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

  const digits = code.padEnd(6, ' ').split('');

  return (
    <PassScreen below={<PassBelow />}>
      <Pass
        stage="At the gate"
        head={<QuietLink title="Change email" onPress={() => router.back()} />}
        stub={
          <>
            <StubRows passenger={passenger || email?.split('@')[0] || 'You'} />
            <StubFoot
              label="Gate code"
              figure={
                <View style={styles.gateCode} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  {digits.map((d, i) => (
                    <Text key={i} style={styles.gateDigit}>
                      {d.trim() || '·'}
                    </Text>
                  ))}
                </View>
              }
              note="From your email, typed or filled in by the keyboard."
            />
          </>
        }>
        <Text style={passStyles.title} accessibilityRole="header">
          {COPY[purpose].title}
        </Text>
        <Text style={passStyles.lead}>
          {COPY[purpose].blurb} {email}.
        </Text>

        {/* The cells are drawing only; the one TextInput over them is what is typed into. */}
        <Pressable onPress={() => input.current?.focus()} style={styles.code} accessible={false}>
          {digits.map((d, i) => (
            <View
              key={i}
              style={[styles.cell, d.trim() ? styles.cellHas : null, focused && i === Math.min(code.length, 5) ? styles.cellNext : null]}>
              <Text style={styles.cellText}>{d.trim()}</Text>
            </View>
          ))}
          <TextInput
            ref={input}
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={6}
            autoFocus
            caretHidden
            accessibilityLabel="6-digit code"
            style={styles.codeInput}
          />
        </Pressable>

        {purpose === 'reset' ? (
          <PaperInput
            label="New password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
          />
        ) : null}

        {error ? <PaperError>{error}</PaperError> : null}
        {resent ? <Text style={passStyles.hint}>Sent again.</Text> : null}

        <SignalButton large title="Continue" onPress={submit} busy={busy} accessibilityHint={gap} />
        <QuietLink title="Send it again" onPress={resend} />
      </Pass>
    </PassScreen>
  );
}

const styles = StyleSheet.create({
  code: { flexDirection: 'row', gap: 7, marginTop: PolarSpace.s1 },
  cell: {
    flex: 1,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: PolarRadius.sm,
    borderWidth: 1,
    borderColor: 'rgba(31,42,68,0.15)',
    backgroundColor: Polar.snow,
  },
  cellHas: { borderColor: Polar.ink, backgroundColor: Polar.ice },
  cellNext: { borderColor: Polar.signal, borderWidth: 2 },
  cellText: { fontFamily: PolarFonts.condensed, fontSize: 24, color: Polar.ink },
  // Over the cells and invisible, so a tap anywhere on them lands in it and autofill has a target.
  codeInput: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0.02, color: 'transparent', fontSize: 16 },
  gateCode: { flexDirection: 'row', justifyContent: 'space-between' },
  gateDigit: { fontFamily: PolarFonts.condensed, fontSize: 34, lineHeight: 38, color: Polar.ink, fontVariant: ['tabular-nums'] },
});
