import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { signIn, signUp } from '@/api/auth';
import { FieldTrough, PrimaryButton, TextField } from '@/components/form';
import { Notice } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { Colors, MaxContentWidth, Spacing } from '@/constants/theme';

/**
 * Sign in, or make an account, on one sheet.
 *
 * One screen with a mode toggle rather than two routes: the forms differ by a single field, and
 * somebody who has typed their email into the wrong one should not have to type it again.
 *
 * **Nothing in this app is behind it.** Planning, generating and saving all work signed out under
 * the anonymous owner, and signing in later brings that work along — the server claims it on
 * session creation. So this screen asks rather than demands, and says what it is for.
 */
export default function SignInScreen() {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

    // `dismissTo` rather than `back`: this can be reached from Memories or from Profile, and both
    // want the tab they came from showing its now-signed-in state rather than a stale render.
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/memories');
  }

  const ready = email.trim().length > 0 && password.length >= 8;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        // The password field sits low enough on a small phone that the keyboard covers it.
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
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

            <Pressable
              onPress={() => {
                setCreating((v) => !v);
                setError(null);
              }}
              style={styles.toggle}>
              <ThemedText type="detail" themeColor="muted">
                {creating ? 'Already have an account? ' : 'New here? '}
                <ThemedText type="detail">{creating ? 'Sign in' : 'Make one'}</ThemedText>
              </ThemedText>
            </Pressable>

            <Pressable onPress={() => router.back()} style={styles.toggle}>
              <ThemedText type="detail" themeColor="muted">
                Keep planning without an account
              </ThemedText>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.canvas },
  flex: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.read,
    paddingTop: Spacing.regular,
    paddingBottom: Spacing.regular,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  blurb: { paddingTop: Spacing.tight },
  form: { paddingTop: Spacing.regular, gap: Spacing.read },
  hint: { paddingHorizontal: Spacing.hair },
  // 44pt is the platform's minimum touch target; a text link is otherwise ~18pt tall.
  toggle: { minHeight: 44, justifyContent: 'center' },
});
