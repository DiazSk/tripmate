import { useSignInWithApple } from '@clerk/expo/apple';
import { useSignInWithGoogle } from '@clerk/expo/google';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { GoogleMark } from '@/components/google-mark';
import { PaperError } from '@/components/polar-ui';
import { Polar, PolarFonts, PolarRadius } from '@/constants/polar';
import { clerkMessage, isCancellation } from '@/lib/clerkError';
import { useFinishAuth } from '@/lib/useFinishAuth';

type Flow = () => Promise<{ createdSessionId: string | null; setActive?: (p: { session: string }) => Promise<void> }>;

/**
 * Apple (iOS) and Google, under an "or" rule: the alternative to the email form above it on the
 * boarding pass, in both modes. Drawn for the pass's ice ground, as the web's are.
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
        <Text style={styles.or}>or</Text>
        <View style={styles.line} />
      </View>
      {Platform.OS === 'ios' ? (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={PolarRadius.hairline}
          style={styles.apple}
          onPress={() => run(() => startAppleAuthenticationFlow())}
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy }}
        onPress={() => run(() => startGoogleAuthenticationFlow())}
        style={({ pressed }) => [styles.google, pressed && styles.googlePressed]}>
        {busy ? <ActivityIndicator color={Polar.ink} /> : <GoogleMark />}
        <Text style={styles.googleText}>Continue with Google</Text>
      </Pressable>
      {error ? <PaperError>{error}</PaperError> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 10 },
  rule: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  line: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: Polar.rule },
  or: { fontFamily: PolarFonts.display, fontSize: 16, color: Polar.ink },
  apple: { height: 48, width: '100%' },
  google: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: PolarRadius.hairline,
    borderWidth: 1,
    borderColor: 'rgba(31,42,68,0.15)',
    backgroundColor: Polar.ice,
  },
  googlePressed: { borderColor: Polar.ink, backgroundColor: Polar.snow },
  googleText: { fontFamily: PolarFonts.sansSemi, fontSize: 15, color: Polar.ink },
});
