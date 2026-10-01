import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { signIn, signUp } from '@/api/auth';
import { authMode } from '@/lib/authMode';
import { FieldTrough, PrimaryButton, TextField } from '@/components/form';
import { Notice } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';









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

    done();
  }

  /**
   * Out of the whole flow, not back to the chooser.
   *
   * `back()` would land on the screen you just came from, which after a successful sign-in is
   * absurd. `canDismiss()` asks whether there is a modal to close — true whenever this was
   * reached through `/signin`, including the `+native-intent` launch — and `dismissAll()` closes
   * the group in one move. The `replace` is for the case where it was not: a direct deep link
   * with nothing underneath.
   */
  function done() {
    if (router.canDismiss()) router.dismissAll();
    else router.replace('/(tabs)/trips');
  }

  const ready = email.trim().length > 0 && password.length >= 8;

  return (
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

          {/* Both modes, not just create. `ready` wants 8 characters either way, so gating
              this on `creating` left a sign-in with a dead button and no reason beside it. */}
          <ThemedText type="micro" themeColor="muted" style={styles.hint}>
            At least 8 characters.
          </ThemedText>

          {error ? <Notice>{error}</Notice> : null}

          <PrimaryButton
            title={creating ? 'Create account' : 'Sign in'}
            onPress={submit}
            disabled={!ready}
            busy={busy}
          />

        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
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
});
