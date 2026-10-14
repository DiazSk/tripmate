import { useSignIn, useSignUp } from '@clerk/expo';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Pass, PassBelow, PassScreen, StubFoot, StubRows, passStyles } from '@/components/boarding-pass';
import { PaperError, PaperInput, QuietLink, SignalButton } from '@/components/polar-ui';
import { SocialSignIn } from '@/components/social-sign-in';
import { Polar, PolarFonts, PolarRadius, PolarSpace } from '@/constants/polar';
import { authMode, type AuthMode } from '@/lib/authMode';
import { clerkMessage, unsupportedStepMessage } from '@/lib/clerkError';
import { PASSWORD_MIN, authGap, gapSentence } from '@/lib/formGap';
import { useFinishAuth } from '@/lib/useFinishAuth';

type CodePurpose = 'verify-signup' | 'sign-in-code' | 'client-trust' | 'reset';

/**
 * Sign in, or make an account: the boarding pass. The web's `/signin` B, one column.
 *
 * **Nothing is gated by it.** Planning, generating and saving all work signed out under the
 * anonymous owner, and the server claims that work on session creation; the way out ("Keep
 * planning without an account") sits under the pass, always.
 *
 * **One pass, two modes, and the switch is on it.** This used to be a chooser and a form a push
 * apart, which cost the typed email whenever you picked the wrong one. The mode is state here, seeded
 * from `?mode=` so a link that asks for sign-up still opens on it (`authMode` resolves anything else
 * to sign-in). The stub fills in as you type: the passenger is your name making an account, else
 * the part of the email before the @.
 */
export default function AuthPassScreen() {
  const [mode, setMode] = useState<AuthMode>(authMode(useLocalSearchParams<{ mode?: string }>().mode));
  const creating = mode === 'signup';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const finish = useFinishAuth();

  /**
   * Live, not greyed. DESIGN.md says to avoid disabled and handle the empty case at submit, where
   * focus moves to the field. Derived every render, so filling the field clears the sentence.
   */
  const gap = authGap(email, password);
  const [asked, setAsked] = useState(false);
  const emailField = useRef<TextInput>(null);
  const passwordField = useRef<TextInput>(null);

  /** One Clerk step; an error is shown and stops the chain. */
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

  const toCode = (purpose: CodePurpose) =>
    router.push({ pathname: '/signin/code', params: { purpose, email: email.trim(), passenger: passenger() } });

  async function submit() {
    if (gap) {
      setAsked(true);
      (gap.field === 'email' ? emailField : passwordField).current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    if (creating) {
      const ok =
        (await step(() => signUp.password({ emailAddress: email.trim(), password, firstName: name.trim() || undefined }))) &&
        (signUp.status === 'complete' || (await step(() => signUp.verifications.sendEmailCode())));
      if (ok) {
        if (signUp.status === 'complete') {
          if (await step(() => signUp.finalize({ navigate: () => {} }))) await finish();
        } else toCode('verify-signup');
      }
    } else if (await step(() => signIn.password({ emailAddress: email.trim(), password }))) {
      if (signIn.status === 'complete') {
        if (await step(() => signIn.finalize({ navigate: () => {} }))) await finish();
      } else if (signIn.status === 'needs_client_trust') {
        if (await step(() => signIn.mfa.sendEmailCode())) toCode('client-trust');
      } else setError(unsupportedStepMessage(signIn));
    }
    setBusy(false);
  }

  /** Code-first routes (a sign-in code, a reset) need only the address. */
  async function withEmailOnly(send: () => Promise<{ error?: unknown } | void>, purpose: 'sign-in-code' | 'reset') {
    if (!email.trim()) {
      setAsked(true);
      emailField.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    if ((await step(() => signIn.create({ identifier: email.trim() }))) && (await step(send))) toCode(purpose);
    setBusy(false);
  }

  function passenger() {
    return (creating && name.trim()) || email.trim().split('@')[0] || 'You';
  }

  function switchTo(next: AuthMode) {
    setMode(next);
    setError(null);
    setAsked(false);
  }

  const sentence = asked ? gapSentence(gap, error ?? undefined) : null;

  return (
    <PassScreen below={<PassBelow />}>
      <Pass
        stage={creating ? 'Check-in' : 'Boarding'}
        head={
          <View style={styles.switch} accessibilityRole="radiogroup" accessibilityLabel="Sign in or make an account">
            {(['login', 'signup'] as const).map((m) => (
              <Pressable
                key={m}
                accessibilityRole="radio"
                accessibilityState={{ checked: mode === m }}
                onPress={() => switchTo(m)}
                style={[styles.switchOption, mode === m && styles.switchOn]}>
                <Text style={[styles.switchText, mode === m && styles.switchTextOn]}>{m === 'login' ? 'Sign in' : 'New account'}</Text>
              </Pressable>
            ))}
          </View>
        }
        stub={
          <>
            <StubRows passenger={passenger()} />
            <StubFoot
              label="Seat"
              figure={<Text style={passStyles.seat}>ANY</Text>}
              note="No account is needed to plan. This only keeps what you plan."
            />
          </>
        }>
        <Text style={passStyles.title} accessibilityRole="header">
          {creating ? 'Make an account' : 'Welcome back'}
        </Text>
        <Text style={passStyles.lead}>
          {creating ? 'Your trips and travel profile stay with you, on this phone and on the web.' : 'Sign in to find your trips wherever you are.'}
        </Text>

        <View style={styles.fields}>
          {creating ? (
            <PaperInput
              label="Name"
              note="Optional"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
            />
          ) : null}
          <PaperInput
            ref={emailField}
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
          />
          {/* `textContentType` is what lets iOS offer the keychain entry, and it has to say which of
              the two this is, or it proposes a new password on a sign-in. */}
          <PaperInput
            ref={passwordField}
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete={creating ? 'new-password' : 'current-password'}
            textContentType={creating ? 'newPassword' : 'password'}
          />
          <Text style={passStyles.hint}>At least {PASSWORD_MIN} characters.</Text>
        </View>

        {error ? <PaperError>{error}</PaperError> : null}
        {/* Muted rather than alert: an unfilled field is not a failure. */}
        {sentence ? (
          <Text style={passStyles.hint} accessibilityLiveRegion="polite">
            {sentence}
          </Text>
        ) : null}

        <SignalButton large title={creating ? 'Create account' : 'Sign in'} onPress={submit} busy={busy} accessibilityHint={gap?.reason} />

        {creating ? null : (
          <View style={styles.links}>
            <QuietLink title="Email me a code instead" disabled={busy} onPress={() => withEmailOnly(() => signIn.emailCode.sendCode(), 'sign-in-code')} />
            <QuietLink title="Forgot password?" disabled={busy} onPress={() => withEmailOnly(() => signIn.resetPasswordEmailCode.sendCode(), 'reset')} />
          </View>
        )}

        <SocialSignIn disabled={busy} />

        <View style={styles.switchLine}>
          <Text style={passStyles.hint}>{creating ? 'Have an account?' : 'New here?'}</Text>
          <QuietLink title={creating ? 'Sign in' : 'Make one'} onPress={() => switchTo(creating ? 'login' : 'signup')} />
        </View>
      </Pass>
    </PassScreen>
  );
}

const styles = StyleSheet.create({
  switch: { flexDirection: 'row', padding: 3, borderRadius: PolarRadius.sm, backgroundColor: Polar.veil05 },
  switchOption: { minHeight: 36, paddingHorizontal: 12, justifyContent: 'center', borderRadius: PolarRadius.hairline },
  switchOn: { backgroundColor: Polar.ice, shadowColor: Polar.ink, shadowOpacity: 0.12, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
  switchText: { fontFamily: PolarFonts.sansSemi, fontSize: 13, color: Polar.charcoal },
  switchTextOn: { color: Polar.ink },
  fields: { gap: PolarSpace.s3, marginTop: PolarSpace.s1 },
  links: { flexDirection: 'row', flexWrap: 'wrap', columnGap: PolarSpace.s4, marginTop: -PolarSpace.s2 },
  switchLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
