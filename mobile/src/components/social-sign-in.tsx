import { useSignInWithApple } from '@clerk/expo/apple';
import { useSignInWithGoogle } from '@clerk/expo/google';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';

import { GoogleMark } from '@/components/google-mark';
import { Glass, Note } from '@/components/glass-auth';
import { Polar } from '@/constants/polar';
import { clerkMessage, isCancellation } from '@/lib/clerkError';
import { useFinishAuth } from '@/lib/useFinishAuth';
import { Text } from '@/components/themed-text';

type Flow = () => Promise<{ createdSessionId: string | null; setActive?: (p: { session: string }) => Promise<void> }>;

/**
 * Off only in a build signed by a personal (free) Apple team, which cannot carry the Sign in with
 * Apple capability: `EXPO_PUBLIC_APPLE_SIGN_IN=0` also drops the plugin in `app.config.ts`, and a
 * button with no entitlement behind it would only fail when pressed. Read as the literal so Metro
 * inlines it.
 */
const APPLE_SIGN_IN = process.env.EXPO_PUBLIC_APPLE_SIGN_IN !== '0';

/**
 * Apple (iOS) and Google, at the head of sign-in: the first two choices on the glass over the night
 * (`glass-auth.tsx`), above "Continue with email".
 *
 * **Apple is the system's own button, at full width and white.** Apple's guidelines require Sign in
 * with Apple to be at least as prominent as the other options, so it is the native control rather
 * than a capsule dressed to match, and white is the style the guidelines give for a dark ground.
 * Google is glass, as every button that is not the one action is. Android has no Apple button.
 *
 * Owns its own busy state: a flow is open or finishing, and a second press is ignored until it
 * settles, so a double tap cannot start two. `disabled` is the screen saying it is mid-submit.
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
      {Platform.OS === 'ios' && APPLE_SIGN_IN ? (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
          cornerRadius={25}
          style={styles.apple}
          onPress={() => run(() => startAppleAuthenticationFlow())}
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy }}
        onPress={() => run(() => startGoogleAuthenticationFlow())}
        style={({ pressed }) => pressed && styles.pressed}>
        <Glass style={styles.google}>
          {busy ? <ActivityIndicator color={Polar.ice} /> : <GoogleMark />}
          <Text style={styles.googleText}>Continue with Google</Text>
        </Glass>
      </Pressable>
      <Note error={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 10 },
  apple: { height: 50, width: '100%' },
  google: { paddingVertical: 6, minHeight: 50, borderRadius: 25, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  googleText: { fontSize: 17, fontWeight: '600', color: Polar.ice },
});
