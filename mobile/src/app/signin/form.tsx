import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { signIn, signUp } from '@/api/auth';
import { FieldTrough, PrimaryButton, TextField } from '@/components/form';
import { BAND_RATIO_FORM, SceneWindow } from '@/components/scene-band';
import { Notice } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { Colors, MaxContentWidth, Spacing } from '@/constants/theme';
import { authMode } from '@/lib/authMode';
import { authGap, gapSentence } from '@/lib/formGap';

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
  // The root `Stack`, not this group's — see `done()` for why the difference decides whether a
  // successful sign-in closes the modal or pops back to the chooser.
  const rootNavigation = useNavigation('/');

  async function submit() {
    if (gap) {
      setAsked(true);
      (gap.field === 'email' ? emailField : passwordField).current?.focus();
      return;
    }

    setBusy(true);
    setError(null);

    const result = creating
      ? await signUp(email.trim(), password, name.trim() || email.trim().split('@')[0])
      : await signIn(email.trim(), password);

    if (result.error) {
      setError(result.error);
      setBusy(false);
      return;
    }

    if (creating) {
      // A new account is welcomed first. Replacing (not pushing) takes the sign-in modal away with it.
      router.replace('/welcome');
      return;
    }
    done();
  }

  /**
   * Out of the whole flow, not back to the chooser.
   *
   * **This was `router.dismissAll()`, which is wrong here and reads as though it were right.** It
   * queues a bare `POP_TO_TOP`, and `BaseNavigationContainer` routes a target-less action through
   * the focus chain to the *deepest* focused navigator — which, now that this is a group, is the
   * `Stack` in `_layout.tsx` rather than the one holding the modal. `StackRouter` turns that into
   * a `POP` of `routes.length - 1`; on `[index, form]` it returns a new state instead of `null`,
   * so the inner stack handles it and nothing bubbles. You end up signed in, looking at a chooser
   * offering to sign you in, with the modal still up. `canDismiss()` does not catch it either: it
   * walks *down* from the root and returns `true` at the first stack with more than one route,
   * which the root's `[(tabs), signin]` always is, so the `replace` branch was unreachable on
   * every path the app actually takes. Both calls name the modal and mean the nearest stack.
   *
   * So dispatch on the navigator that owns the modal instead of asking the focus chain to find
   * it. `useNavigation('/')` resolves the root `Stack`, and a navigator's own `goBack()` calls
   * that navigator's `onAction` directly — which pops `signin` and leaves the tab you came from
   * where it was, exactly as this did before the group existed. The guard is the house idiom and
   * the `replace` keeps a target if the root anchor ever goes away.
   */
  function done() {
    if (rootNavigation.canGoBack()) rootNavigation.goBack();
    else router.replace('/(tabs)/trips');
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
      <SceneWindow ratio={BAND_RATIO_FORM} />
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

            {/* Both modes, not just create. `ready` wants 8 characters either way, so gating
                this on `creating` left a sign-in with a dead button and no reason beside it. */}
            <ThemedText type="micro" themeColor="muted" style={styles.hint}>
              At least 8 characters.
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
});
