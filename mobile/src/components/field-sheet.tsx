import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';

/**
 * One field, on a surface of its own.
 *
 * **The shell, not the editor.** Callers pass whatever control the field needs — a `ChoiceRow`, a
 * `TagGrid`, a `TextField` — so there is one sheet rather than one per field. The alternative was
 * the Swift app's pushed `ChoiceList`, which in Expo Router would mean a nested `_layout` plus an
 * `index` plus a Stack inside a tab, changing tab-bar behaviour to buy nothing a modal does not
 * already give. A sheet also renders inside its caller, so the caller's autosave closure is simply
 * in scope — a pushed route would have needed a context to reach it.
 *
 * **Why the display behind it stays native rows.** Anything in here renders `ThemedText`, which
 * caps text scaling at 1.6x. Keeping the *editors* in a sheet is what lets the profile's own rows
 * stay on the system ramp with uncapped Dynamic Type, which is the point of `DESIGN.md`'s
 * settings-screen boundary.
 *
 * `presentationStyle="pageSheet"` and `animationType="slide"` match `add-place-sheet.tsx`, so the
 * two sheets in this app arrive the same way.
 */
export function FieldSheet({
  visible,
  title,
  caption,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  /** The section footer's explanation, repeated here — this sheet is where it is acted on. */
  caption?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.sheet}>
        <View style={styles.bar}>
          <ThemedText type="title" numberOfLines={1} style={styles.grow}>
            {title}
          </ThemedText>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}>
            <ThemedText type="label" themeColor="muted">
              Done
            </ThemedText>
          </Pressable>
        </View>

        {/* Mounted only while open, which is the reset: a sheet reopened on another field must not
            show the last one's scroll position or keyboard state. */}
        {visible ? (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {caption ? (
              <ThemedText type="detail" themeColor="muted">
                {caption}
              </ThemedText>
            ) : null}
            {children}
          </ScrollView>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: Colors.canvas },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.read,
    paddingHorizontal: Spacing.read,
    paddingTop: Spacing.read,
    paddingBottom: Spacing.tight,
  },
  grow: { flex: 1 },
  content: { padding: Spacing.read, paddingBottom: Spacing.regular * 2, gap: Spacing.rows },
});
