import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { DestructiveRow, Footer, Group, Separator, ValueRow } from '@/components/settings-list';
import { confirmSignOut, useProfileStore } from '@/lib/profileStore';

/** The account behind the passport: your photo (tap to change it), your name and email, Sign Out. */
export default function Account() {
  const router = useRouter();
  const { account } = useProfileStore();
  if (!account) return null;
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      <View style={styles.head}>
        <Avatar account={account} size={92} editable />
      </View>
      <Group>
        <ValueRow label="Name" value={account.name ?? 'Not set'} />
        <Separator inset={16} />
        <ValueRow label="Email" value={account.email} />
      </Group>
      <Group>
        <DestructiveRow title="Sign Out" onPress={() => confirmSignOut(() => router.back())} />
      </Group>
      <Footer center>Your trips stay on your account. This phone keeps planning without one.</Footer>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 16, paddingBottom: 60 },
  head: { alignItems: 'center', marginBottom: 22 },
});
