import { useSignInWithApple } from '@clerk/expo/apple';
import { useSignInWithGoogle } from '@clerk/expo/google';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { PillButton } from '@/components/form';
import { GoogleMark } from '@/components/google-mark';
import { Notice } from '@/components/states';
import { ThemedText } from '@/components/themed-text';
import { APPEARANCE } from '@/constants/appearance';
import { Colors, Spacing } from '@/constants/theme';
import { clerkMessage, isCancellation } from '@/lib/clerkError';
import { useFinishAuth } from '@/lib/useFinishAuth';

type Flow = () => Promise<{ createdSessionId: string | null; setActive?: (p: { session: string }) => Promise<void> }>;

/**
 * Apple (iOS) and Google, under an "or" rule — the alternative to the email form above it, on
 * both the log in and the sign up screen. They lived on the chooser and moved here so the chooser
 * is back to one decision (in, up or neither) and the photograph gets its room back.
 *
 * **Apple is the system's own button, at full width.** Apple's guidelines require Sign in with
 * Apple to be at least as prominent as the other sign-in options, so it is the native control
 * rather than a capsule dressed to match. Android has no Apple button.
 *
 * Owns its own busy state: a flow is open or finishing, and a second press is ignored until it
 * settles, so a double tap cannot start two. `disabled` is the form above saying it is mid-submit.
 */
export function SocialSignIn({ disabled }: { disabled?: boolean }) {
  const { startAppleAuthenticationFlow } = useSignInWithApple();
  const { startGoogleAuthenticationFlow } = useSignInWithGoogle();
  const finish = useFinishAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Apple and Google return a session to activate — or nothing, when the sheet was closed. */
  async function run(start: Flow) {
    if (busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      const { createdSessionId, setActive } = await start();
      if (!createdSessionId || !setActive) return;
      await setActive({ session: createdSessionId });
      await finish();
    } catch (err) {
      if (!isCancellation(err)) setError(clerkMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.group}>
      <View style={styles.rule} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={styles.line} />
        <ThemedText type="micro" themeColor="muted">
          or
        </ThemedText>
        <View style={styles.line} />
      </View>
      {Platform.OS === 'ios' ? (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={
            APPEARANCE === 'light'
              ? AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
              : AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
          }
          cornerRadius={26}
          style={styles.apple}
          onPress={() => run(() => startAppleAuthenticationFlow())}
        />
      ) : null}
      <PillButton
        block
        title="Continue with Google"
        icon={<GoogleMark />}
        busy={busy}
        onPress={() => run(() => startGoogleAuthenticationFlow())}
      />
      {error ? <Notice>{error}</Notice> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.rows },
  rule: { flexDirection: 'row', alignItems: 'center', gap: Spacing.rows },
  line: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: Colors.cardBorder },
  apple: { height: 52, width: '100%' },
});
