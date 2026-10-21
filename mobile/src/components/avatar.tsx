import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { avatarTint, initialsFor } from '@shared/avatar';

import { SymbolView } from '@/components/symbol';
import { removeAvatar, uploadAvatar, type Account } from '@/api/auth';
import { Colors } from '@/constants/theme';
import { squareJpegBase64 } from '@/lib/avatarImage';

/**
 * A traveller's face: their photo, else initials on a disc tinted from their account id (the same
 * colour the web draws), else the person glyph when signed out. Editable opens the library, and —
 * with a photo set — offers Remove.
 */
export function Avatar({ account, size = 84, editable = false }: { account: Account | null; size?: number; editable?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1] });
    if (result.canceled || !result.assets[0]) return;
    setBusy(true);
    setError(null);
    try {
      setError(await uploadAvatar(await squareJpegBase64(result.assets[0])));
    } catch {
      setError("Couldn't save that photo. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(await removeAvatar());
    setBusy(false);
  }

  function open() {
    if (!account?.image) return void choose();
    const options = ['Choose a new photo', 'Remove photo', 'Cancel'];
    const pick = (i: number) => (i === 0 ? void choose() : i === 1 ? void remove() : undefined);
    if (Platform.OS === 'ios') ActionSheetIOS.showActionSheetWithOptions({ options, destructiveButtonIndex: 1, cancelButtonIndex: 2 }, pick);
    else Alert.alert('Your photo', undefined, [{ text: options[0], onPress: () => pick(0) }, { text: options[1], style: 'destructive', onPress: () => pick(1) }, { text: 'Cancel', style: 'cancel' }]);
  }

  const disc = { width: size, height: size, borderRadius: size / 2 };
  const face = account?.image ? (
    <Image source={{ uri: account.image }} style={disc} contentFit="cover" transition={200} />
  ) : account ? (
    <View style={[disc, styles.center, { backgroundColor: avatarTint(account.id) }]}>
      <Text style={[styles.initials, { fontSize: size * 0.36 }]}>{initialsFor(account.name)}</Text>
    </View>
  ) : (
    <View style={[disc, styles.center, styles.empty]}>
      <SymbolView name={{ ios: 'person.fill', android: 'person' }} tintColor={Colors.muted} size={size * 0.45} />
    </View>
  );

  return (
    <View style={styles.wrap}>
      {editable && account ? (
        <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={account.image ? 'Change or remove your photo' : 'Add a photo'} style={{ opacity: busy ? 0.6 : 1 }}>
          {face}
          {busy ? <ActivityIndicator style={StyleSheet.absoluteFill} color={Colors.foreground} /> : null}
        </Pressable>
      ) : face}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 8 },
  center: { alignItems: 'center', justifyContent: 'center' },
  empty: { backgroundColor: Colors.cardBorder },
  initials: { color: '#fff', fontWeight: '600' },
  error: { color: Colors.alert, fontSize: 13, textAlign: 'center', maxWidth: 240 },
});
