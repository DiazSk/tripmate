import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { signIn, signUp } from '@/api/auth';
import { FieldTrough, PillButton, PrimaryButton, TextField } from '@/components/form';
import { Notice } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { Colors, MaxContentWidth, Spacing } from '@/constants/theme';
import {
  BAND_COLLAPSED,
  BAND_RATIO,
  BEATS,
  DWELL_MS,
  SceneBand,
  STACK_ABOVE_SCALE,
} from '@/components/scene-band';









/**
 * Sign in, or make an account — and the screen the app opens on.
 *
 * **Nothing is gated by it, and that distinction is the whole design.** This used to say "nothing in
 * this app is behind it", which was true when it could only be reached from Trips or Profile and
 * is now false in the literal sense: `+native-intent.tsx` opens a signed-out launch here, and the
 * root layout anchors `(tabs)` so Home sits directly behind the sheet. What remains true is that it
 * demands nothing. Planning, generating and saving all work signed out under the anonymous owner,
 * the server claims that work on session creation, and "Keep planning without an account" — plus the
 * sheet's own swipe-down — leaves without a cost.
 *
 * One screen with a mode toggle rather than two routes: the forms differ by a single field, and
 * somebody who has typed their email into the wrong one should not have to type it again.
 */
export default function SignInScreen() {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const insets = useSafeAreaInsets();
  const { height, fontScale } = useWindowDimensions();
  const reduceMotion = useReducedMotion();

  const [beat, setBeat] = useState(0);
  const [keyboardUp, setKeyboardUp] = useState(false);

  // The reel. Stopped outright under Reduce Motion rather than slowed: the beats are decoration
  // here, and `withTiming` below already honours the setting on its own.
  useEffect(() => {
    if (reduceMotion) return;
    const id = setInterval(() => setBeat((b) => (b + 1) % BEATS.length), DWELL_MS);
    return () => clearInterval(id);
  }, [reduceMotion]);

  // `will`-prefixed on iOS so the band starts moving on the same frame as the keyboard rather than
  // after it has arrived; Android only emits the `did` pair.
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardUp(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardUp(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const bandHeight =
    keyboardUp || fontScale > STACK_ABOVE_SCALE ? BAND_COLLAPSED : Math.round(height * BAND_RATIO);


  async function submit() {
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

    leave();
  }

  /**
   * Out of here, whether by succeeding or by declining.
   *
   * The guard is the house idiom (`plan/_layout.tsx`, and this screen's own submit path before it).
   * With the root layout's `anchor: '(tabs)'` there is always something behind this now, so `back()`
   * lands on Home — but the guard is what keeps the screen correct independent of how it was reached
   * and is the difference between a working escape and a dead link if the anchor ever goes away.
   */
  function leave() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/trips');
  }

  const ready = email.trim().length > 0 && password.length >= 8;

  return (
    <View style={styles.root}>
      <SceneBand beat={beat} height={bandHeight} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* The bottom inset is applied here rather than by wrapping in a `SafeAreaView`, because
            the band above has to reach the top edge and a `SafeAreaView` would inset that too.
            Without it the last row — the escape out of this screen — sits under the home indicator,
            where a tap does not reliably reach it. */}
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.regular }]}
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
                label="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoComplete={creating ? 'new-password' : 'current-password'}
                textContentType={creating ? 'newPassword' : 'password'}
              />
            </FieldTrough>

            {creating ? (
              <ThemedText type="micro" themeColor="muted" style={styles.hint}>
                At least 8 characters.
              </ThemedText>
            ) : null}

            {error ? <Notice>{error}</Notice> : null}

            <PrimaryButton
              title={creating ? 'Create account' : 'Sign in'}
              onPress={submit}
              disabled={!ready}
              busy={busy}
            />

            {/* The two share one box so the form's `gap` falls outside the pair rather than
                between them — otherwise 16pt lands on top of the 26pt of slack two 44pt targets
                already carry, and 42pt reads as two unrelated rows instead of two secondary
                actions under the button. `gap: Spacing.hair` keeps them a pair now that both are
                capsules and their edges, not their text, set the rhythm. */}
            <View style={styles.secondary}>
              {/* **A capsule, because it is an action sitting in content.** It was the second
                  half of a sentence — "New here? Create an account" — and half a sentence cannot
                  be a capsule, so the sentence goes. DESIGN.md's nav-bar exemption does not reach
                  here: this is not a bar item or a row accessory, it is a control in prose.
     
                  **"instead", because the bare label collided with the button above it.** The
                  deleted prefix ("Already have an account? ") was the only thing marking this as a
                  mode switch. Without it, create mode showed `Create account` over `Sign in` —
                  somebody who had filled in all three fields and pressed the lower one would
                  silently flip the form rather than submit it. Both directions collide, so both
                  carry the word. */}
              <PillButton
                title={creating ? 'Sign in instead' : 'Create an account instead'}
                onPress={() => {
                  setCreating((v) => !v);
                  setError(null);
                }}
              />

              {/* **A capsule, because this is the way out and it was reading as a caption.**
                  Muted `detail` is the same face and colour as the blurb under the title, so the
                  one control that leaves this screen was typographically identical to a sentence
                  describing it — reported as not knowing it was a button at all. It matters more
                  now than it did: this screen is a full-screen modal, so the swipe-down that used
                  to share the job is gone and this is the only way out. */}
              <PillButton title="Keep planning without an account" onPress={leave} />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.canvas },
  flex: { flex: 1 },
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
  // Both children are capsules that size to their own words — `PillButton` sets its own
  // `alignSelf`, so this box only has to keep them a pair.
  secondary: { gap: Spacing.hair },
});
