import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { firstName, photoLine } from '@shared/travelCard';

import { updateName, useAccount } from '@/api/auth';
import { Avatar } from '@/components/avatar';
import { Glass, GlassField, SignalCapsule } from '@/components/glass-auth';
import { WelcomeFrame } from '@/components/welcome-frame';
import { Polar } from '@/constants/polar';
import { useWelcome } from '@/lib/welcomeDraft';
import { Text } from '@/components/themed-text';

export default function WelcomeYou() {
  const { answers, set, image, react, flagUnsaved, busy, guard } = useWelcome();
  const { account } = useAccount();

  // `Avatar` has no onChange: it announces the account change and `image` follows. Say the line only
  // when the photo *changes* on this page, not for one that was already there when it opened.
  const seen = useRef(image);
  useEffect(() => {
    if (image && image !== seen.current) react(photoLine(answers.name));
    seen.current = image;
  }, [image, answers.name, react]);

  const ready = answers.name.trim().length > 0;
  const next = () =>
    guard(async () => {
      if (!ready) return;
      const name = answers.name.trim();
      if (name && name !== account?.name && (await updateName(name))) flagUnsaved();
      router.push('/welcome/who');
    });
  return (
    <WelcomeFrame step="you" title={`Hello, ${firstName(answers.name)}.`} cta={<SignalCapsule title="Continue" busy={busy} disabled={!ready} onPress={next} />}>
      <GlassField icon="person" value={answers.name} maxLength={40} autoComplete="name" textContentType="name" placeholder="Your name" onChangeText={(name) => set({ name })} returnKeyType="next" onSubmitEditing={next} />
      <Glass style={styles.photo}>
        <Avatar account={account} size={56} editable />
        <View style={styles.copy}>
          <Text style={styles.strong}>{image ? 'Looking good.' : 'Add a face to the card'}</Text>
          <Text style={styles.muted}>{image ? 'Tap the photo to change it.' : 'Optional. It shows on your profile.'}</Text>
        </View>
      </Glass>
    </WelcomeFrame>
  );
}

const styles = StyleSheet.create({
  photo: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, borderRadius: 22 },
  copy: { flex: 1, gap: 2 },
  strong: { fontSize: 16, fontWeight: '600', color: Polar.ice },
  muted: { fontSize: 13, lineHeight: 18, color: Polar.frost68 },
});
