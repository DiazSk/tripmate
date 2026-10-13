import { useSignIn, useSignUp } from '@clerk/expo';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FieldTrough, PillButton, PrimaryButton, TextField } from '@/components/form';
import { SceneWindow } from '@/components/scene-band';
import { SocialSignIn } from '@/components/social-sign-in';
import { Notice } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { Colors, MaxContentWidth, Spacing } from '@/constants/theme';
import { authMode } from '@/lib/authMode';
import { ratioToFit } from '@/lib/bandRatio';
import { clerkMessage, unsupportedStepMessage } from '@/lib/clerkError';
import { PASSWORD_MIN, authGap, gapSentence } from '@/lib/formGap';
import { useFinishAuth } from '@/lib/useFinishAuth';

/**
 * Sign in, or make an account — the second of the two screens this flow is.
 *
 * **Nothing is gated by it, and that distinction is the whole design.** This used to say "nothing in
 * this app is behind it", which was true when it could only be reached from Trips or Profile and is
 * now false in the literal sense: `+native-intent.tsx` opens a signed-out launch on the chooser,
 * and the root layout anchors `(tabs)` so Home sits directly behind the modal. What remains true is
 * that it demands nothing. Planning, generating and saving all work signed out under the anonymous
 * owner, and the server claims that work on session creation.
 *
 * **The way out is back, and the escape capsule lives one screen up.** This screen has one action,
 * because the mode was chosen before you arrived — the switch that used to sit here (`Create an
 * account instead`) is the chooser now, which also retires a collision where `Create account` sat
 * directly above `Sign in` and a press on the lower one silently flipped the form. What the split
 * costs is that a typed email does not cross between the modes; the arrangement this replaced kept
 * it, and the docblock that argued for it was right about that much. Judged worth one screen with
 * one job — carrying the address as a param is the fix if it ever bites. Note that the presentation
 * is `fullScreenModal`, not a sheet: there is no swipe-down here, so `signin/_layout.tsx` anchors
 * the chooser beneath this to keep back a real way out even on a direct deep link.
 */
/**
 * Each mode's stack, measured like the chooser's: 24 padding, the title (25), the blurb (8 + 19 a
 * line), the form block (24, the trough at 52 a row, 16 gaps, the 15pt hint, the 52pt button),
 * log in's two quiet links (16 + 44 + 4 + 44), the social block (16, the "or" rule 15, 12, Apple
 * 52, 12, Google 44) and 58 of bottom inset. Sign up has a third row and a two-line blurb but no
 * links. Android has no Apple button (52 + 12). The photo takes what these leave — about 0.29 and
 * 0.33 of an 874pt window — so Apple and Google are on screen without scrolling.
 */
const STACK_PT = {
  login: Platform.OS === 'ios' ? 621 : 557,
  signup: Platform.OS === 'ios' ? 584 : 520,
};

export default function AuthFormScreen() {
  // The mode is the route's, not this screen's — you arrived by choosing it. See `authMode` for
  // why an unrecognised parameter resolves rather than throws.
  const creating = authMode(useLocalSearchParams<{ mode?: string }>().mode) === 'signup';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const finish = useFinishAuth();

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

  const toCode = (purpose: 'verify-signup' | 'sign-in-code' | 'client-trust' | 'reset') =>
    router.push({ pathname: '/signin/code', params: { purpose, email: email.trim() } });

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
        (await step(() =>
          signUp.password({ emailAddress: email.trim(), password, firstName: name.trim() || undefined }),
        )) && (signUp.status === 'complete' || (await step(() => signUp.verifications.sendEmailCode())));
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

  /**
   * Live, not greyed. The same rule the wizard follows: DESIGN.md says to avoid disabled and
   * handle the empty case at submit, where focus moves to the field. Derived every render, so
   * filling the field clears the sentence without a reset.
   */
  const gap = authGap(email, password);
  const [asked, setAsked] = useState(false);
  const emailField = useRef<TextInput>(null);
  const passwordField = useRef<TextInput>(null);

  return (
    <View style={styles.flex}>
      <SceneWindow ratio={ratioToFit(height, creating ? STACK_PT.signup : STACK_PT.login)} />
      <KeyboardAvoidingView
        style={styles.page}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* The bottom inset is applied here rather than by wrapping in a `SafeAreaView`, because
            the band above has to reach the top edge and a `SafeAreaView` would inset that too.
            Without it the last row — the escape out of this screen — sits under the home
            indicator, where a tap does not reliably reach it. */}
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + Spacing.regular },
          ]}
          keyboardShouldPersistTaps="handled">
          <ThemedText type="title">{creating ? 'Make an account' : 'Welcome back'}</ThemedText>
          <ThemedText type="detail" themeColor="muted" style={styles.blurb}>
            {creating
              ? 'Your trips and travel profile stay with you — on this phone and on the web.'
              : 'Sign in to find your trips wherever you are.'}
          </ThemedText>

          <View style={styles.form}>
            <FieldTrough>
              {creating ? (
                <TextField
                  label="Name"
                  value={name}
                  onChangeText={setName}
                  placeholder="Optional"
                  autoCapitalize="words"
                  autoComplete="name"
                  textContentType="name"
                />
              ) : null}
              <TextField
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
              {/* `textContentType` is what lets iOS offer the keychain entry, and it has to say
                  which of the two this is — otherwise it proposes a new password on a sign-in. */}
              <TextField
                ref={passwordField}
                label="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoComplete={creating ? 'new-password' : 'current-password'}
                textContentType={creating ? 'newPassword' : 'password'}
              />
            </FieldTrough>

            {/* Both modes, not just create. `authGap` wants the minimum either way, so gating this
                on `creating` left a sign-in with a dead button and no reason beside it. */}
            <ThemedText type="micro" themeColor="muted" style={styles.hint}>
              At least {PASSWORD_MIN} characters.
            </ThemedText>

            {error ? <Notice>{error}</Notice> : null}

            {/* Muted rather than alert: an unfilled field is not a failure, and the server's own
                refusals are what `Notice` above is for. */}
            {asked && gapSentence(gap, error ?? undefined) ? (
              <ThemedText
                type="detail"
                themeColor="muted"
                accessibilityLiveRegion="polite"
                style={styles.hint}>
                {gapSentence(gap, error ?? undefined)}
              </ThemedText>
            ) : null}

            <PrimaryButton
              title={creating ? 'Create account' : 'Sign in'}
              onPress={submit}
              accessibilityHint={gap?.reason}
              busy={busy}
            />

            {/* Quiet links, the chooser's third weight: other ways to do this screen's one job, not
                rivals to its button. */}
            {creating ? null : (
              <View style={styles.secondary}>
                <PillButton
                  block
                  tone="quiet"
                  title="Email me a code instead"
                  onPress={() => withEmailOnly(() => signIn.emailCode.sendCode(), 'sign-in-code')}
                />
                <PillButton
                  block
                  tone="quiet"
                  title="Forgot password?"
                  onPress={() => withEmailOnly(() => signIn.resetPasswordEmailCode.sendCode(), 'reset')}
                />
              </View>
            )}

            <SocialSignIn disabled={busy} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // Opaque, and starting higher than the chooser's: this canvas is what covers the photograph's
  // lower edge as the screen slides in. See `SceneBand`.
  page: { flex: 1, backgroundColor: Colors.canvas },
  content: {
    paddingHorizontal: Spacing.read,
    paddingTop: Spacing.regular,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  blurb: { paddingTop: Spacing.tight },
  form: { paddingTop: Spacing.regular, gap: Spacing.read },
  hint: { paddingHorizontal: Spacing.hair },
  secondary: { gap: Spacing.hair },
});
