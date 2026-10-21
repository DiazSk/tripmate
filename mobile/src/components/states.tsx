import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';

/**
 * The three things a screen can be other than full of content.
 *
 * `Notice` and `Invitation` are deliberately different components rather than one with a prop,
 * because they carry the distinction the whole API layer is built around: `undefined` means the
 * fetch failed, `null`/`[]` means the server answered and there is genuinely nothing. Collapsing
 * them into one "empty state" is how an outage starts reading as "you have no trips".
 */

/** The fetch failed. Something is wrong and retrying may fix it. */
export function Notice({ children }: { children: string }) {
  return (
    <View style={styles.notice}>
      <ThemedText type="detail" themeColor="muted">
        {children}
      </ThemedText>
    </View>
  );
}

/**
 * The server answered and there is nothing here yet. Reads as an invitation, not an apology —
 * and never offers a control that does not exist.
 */
export function Invitation({ title, body, note }: { title: string; body?: string; note?: string }) {
  return (
    <View style={styles.invitation}>
      <ThemedText type="heading" style={styles.invitationTitle}>
        {title}
      </ThemedText>
      {body ? (
        <ThemedText type="detail" themeColor="muted">
          {body}
        </ThemedText>
      ) : null}
      {note ? (
        <ThemedText type="label" themeColor="muted" style={styles.invitationNote}>
          {note}
        </ThemedText>
      ) : null}
    </View>
  );
}

/** Jade, because loading is the one moment the screen is genuinely doing something. */
export function Loading({ label }: { label?: string } = {}) {
  if (!label) return <ActivityIndicator color={Colors.accentText} style={styles.loading} />;
  // A wait that names what it is waiting for: a bare spinner says only that something is slow.
  return (
    <View style={styles.loadingRow} accessible accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator color={Colors.accentText} />
      <ThemedText type="detail" themeColor="muted" style={styles.loadingLabel}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    backgroundColor: Colors.surfaceDeep,
    borderRadius: Radius.read,
    padding: Spacing.rows,
    marginHorizontal: Spacing.read,
  },
  invitation: {
    paddingHorizontal: Spacing.read,
    gap: Spacing.tight,
  },
  invitationTitle: {
    fontSize: 20,
    lineHeight: 24,
  },
  invitationNote: {
    marginTop: Spacing.hair,
  },
  loading: {
    marginTop: Spacing.regular,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.tight,
    marginTop: Spacing.rows,
  },
  loadingLabel: { flexShrink: 1 },
});
