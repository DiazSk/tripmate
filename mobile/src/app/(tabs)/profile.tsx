import { SymbolView } from 'expo-symbols';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getProfile } from '@/api/tripMateApi';
import { useFocusedFetch } from '@/lib/useFocusedFetch';
import type { CrowdPreference, EnergyLevel, ExplorerStyle, GroupType, TravelerProfile } from '@/api/types';
import { Invitation, Loading, Notice } from '@/components/states';
import { Colors, Radius, Spacing } from '@/constants/theme';

/**
 * **This screen is deliberately not drawn in the Kiln type scale, and that is the design.**
 *
 * `DESIGN.md`'s third boundary (line 538) says a settings-shaped screen uses the system's type
 * ramp and geometry rather than the product's: the list owns row height, separator insets and
 * header styling, and — the part no Kiln rule can deliver — **Dynamic Type**. Overriding that
 * with hand-picked points is what made the Swift `ProfileView` read as a web form, which is the
 * defect the boundary exists to stop recurring. So: system font, system sizes, no
 * `maxFontSizeMultiplier`, and no Melodrama anywhere on this screen.
 *
 * What does not change is the palette. Kiln needs no adaptation here, on either platform: the one
 * slate `#1C1A18` sits within 10% of iOS dark's grouped-row `#1C1C1E` and of Material 3's dark
 * `surfaceContainerLow` `#1D1B20`. The difference is hue, not value, and the hue is ours to keep.
 */

// Labels ported from ios/TripMateKit/Sources/TripMateKit/UserAnswers.swift.
const GROUP_LABELS: Record<GroupType, string> = {
  solo: 'Solo',
  couple: 'Couple',
  family_with_kids: 'Family with kids',
  other: 'Something else',
};

const EXPLORER_STYLE_LABELS: Record<ExplorerStyle, string> = {
  packed: 'See as much as possible',
  relaxed: 'A few things, done well',
  offbeat: 'Off the beaten path',
  mixed: 'A bit of both',
};

const ENERGY_LABELS: Record<EnergyLevel, string> = {
  high: 'Happy to walk all day',
  moderate: 'A comfortable amount',
  low: 'Prefer it gentle',
};

const CROWD_LABELS: Record<CrowdPreference, string> = {
  love: 'Love the buzz',
  mixed: 'Some of each',
  avoid: 'Keep it quiet',
};

/**
 * iOS and Android want the same tree — rows, separators, section headers — with different
 * numbers, so this is a metrics object rather than a `.ios.tsx`/`.android.tsx` split. A file
 * split would duplicate the row markup twice and guarantee the two drift.
 */
const M = Platform.select({
  ios: {
    sectionInset: Spacing.read,
    sectionRadius: Radius.surface + 2,
    rowMinHeight: 44,
    rowFontSize: 17,
    headerFontSize: 13,
    headerWeight: '400' as const,
    headerTransform: 'uppercase' as const,
    headerColor: Colors.muted,
    separators: true,
    surface: Colors.surfaceDeep,
  },
  default: {
    sectionInset: 0,
    sectionRadius: 0,
    rowMinHeight: 56,
    rowFontSize: 16,
    headerFontSize: 14,
    headerWeight: '600' as const,
    headerTransform: 'none' as const,
    headerColor: Colors.foreground,
    separators: false,
    surface: Colors.canvas,
  },
})!;

export default function Profile() {
  // undefined = still loading, null = the fetch failed, "none" = fetched fine, no profile yet.
  // On focus: generating a plan writes the profile, so this fills without an app restart.
  const profile = useFocusedFetch<TravelerProfile | null | 'none'>(async () => {
    const result = await getProfile();
    return result === undefined ? null : result === null ? 'none' : result;
  });

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Avatar profile={typeof profile === 'object' ? profile : null} />

        {profile === undefined ? (
          <Loading />
        ) : profile === null ? (
          <Notice>Couldn&rsquo;t reach TripMate. Check your connection.</Notice>
        ) : profile === 'none' ? (
          <Invitation
            title="No travel profile yet"
            body="It gets filled in when you plan a trip, and shapes the plans you get afterwards."
          />
        ) : (
          <>
            <Section title="How you travel">
              <Row label="Group" value={GROUP_LABELS[profile.group]} first />
              <Row label="Explorer style" value={EXPLORER_STYLE_LABELS[profile.explorerStyle]} />
              <Row label="Energy" value={ENERGY_LABELS[profile.energy]} />
              <Row label="Crowds" value={CROWD_LABELS[profile.crowds]} />
            </Section>

            <Section title="Interests">
              <Row label="Top priorities" value={profile.topPriorities.join(', ') || '—'} first />
            </Section>

            <Section title="Food">
              <Row label="Dietary" value={profile.dietary.tags.join(', ') || '—'} first />
              {profile.dietary.note ? <Row label="Note" value={profile.dietary.note} /> : null}
            </Section>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * A picture, and the one line that says who you are — how every mobile profile opens.
 *
 * Not tappable: this product has no accounts and no image storage, and a control that opens a
 * picker whose result cannot be saved is worse than a placeholder that admits what it is.
 */
function Avatar({ profile }: { profile: TravelerProfile | null }) {
  return (
    <View style={styles.avatarBlock}>
      <View style={styles.avatar}>
        <SymbolView
          name={{ ios: 'person.fill', android: 'person' }}
          tintColor={Colors.muted}
          size={38}
          // Given a bare SF string, the Android path renders nothing at all, silently — hence the
          // object form above.
          fallback={<Text style={styles.avatarFallback}>—</Text>}
        />
      </View>
      <Text style={styles.portrait}>{portraitSentence(profile)}</Text>
    </View>
  );
}

function portraitSentence(profile: TravelerProfile | null): string {
  if (!profile) return 'Your travel profile shapes every plan you get.';
  const group = GROUP_LABELS[profile.group]?.toLowerCase() ?? 'travelling';
  const energy = ENERGY_LABELS[profile.energy]?.toLowerCase() ?? '';
  return `Travelling ${group === 'solo' ? 'solo' : `as a ${group}`}${energy ? `, ${energy}` : ''}.`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionHeader}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Row({ label, value, first }: { label: string; value: string; first?: boolean }) {
  return (
    <View style={[styles.row, M.separators && !first && styles.rowSeparated]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.canvas },
  scroll: { paddingBottom: Spacing.regular * 2 },

  avatarBlock: {
    alignItems: 'center',
    gap: Spacing.rows,
    paddingTop: Spacing.regular,
    paddingBottom: Spacing.compact,
    paddingHorizontal: Spacing.regular,
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(255,255,255,0.09)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallback: { color: Colors.muted, fontSize: 32 },
  portrait: { color: Colors.muted, fontSize: 15, textAlign: 'center' },

  section: { marginTop: Spacing.compact },
  sectionHeader: {
    color: M.headerColor,
    fontSize: M.headerFontSize,
    fontWeight: M.headerWeight,
    textTransform: M.headerTransform,
    marginBottom: Spacing.tight,
    // Aligns the header with the row labels inside the section below it.
    marginHorizontal: M.sectionInset + Spacing.read,
  },
  sectionBody: {
    backgroundColor: M.surface,
    borderRadius: M.sectionRadius,
    marginHorizontal: M.sectionInset,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.read,
    minHeight: M.rowMinHeight,
    paddingHorizontal: Spacing.read,
    paddingVertical: Spacing.tight,
  },
  // Inset to the label's leading edge, the way a native grouped list draws them.
  rowSeparated: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.cardBorder,
  },
  rowLabel: { color: Colors.foreground, fontSize: M.rowFontSize },
  rowValue: { color: Colors.muted, fontSize: M.rowFontSize, flexShrink: 1, textAlign: 'right' },
});
