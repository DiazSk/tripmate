import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { firstName, photoLine } from '@shared/travelCard';

import { updateName, useAccount } from '@/api/auth';
import { Avatar } from '@/components/avatar';
import { FieldTrough, PrimaryButton, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { WelcomeFrame } from '@/components/welcome-frame';
import { Colors } from '@/constants/theme';
import { useWelcome } from '@/lib/welcomeDraft';

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

  const next = () => guard(async () => {
    const name = answers.name.trim();
    if (name && name !== account?.name && (await updateName(name))) flagUnsaved();
    router.push('/welcome/who');
  });
  return (
    <WelcomeFrame step="you" cta={<PrimaryButton title="Continue" disabled={!answers.name.trim()} busy={busy} onPress={next} />}>
      <ThemedText type="display">Hello, {firstName(answers.name)}.</ThemedText>
      <FieldTrough><TextField label="Name" value={answers.name} maxLength={40} autoComplete="name" onChangeText={(name) => set({ name })} /></FieldTrough>
      <View style={styles.photoRow}>
        <Avatar account={account} size={96} editable />
        <View style={styles.copy}>
          <Text style={styles.strong}>{image ? 'Looking good.' : 'Add a face to the card'}</Text>
          <Text style={styles.muted}>{image ? 'Tap the photo to change it.' : 'Optional. It shows on your profile.'}</Text>
        </View>
      </View>
    </WelcomeFrame>
  );
}

const styles = StyleSheet.create({
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  copy: { flex: 1, gap: 4 },
  strong: { color: Colors.foreground, fontSize: 15, fontWeight: '600' },
  muted: { color: Colors.muted, fontSize: 13, lineHeight: 18 },
});
