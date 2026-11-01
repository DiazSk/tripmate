import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import type { MapType } from 'react-native-maps';
import { SlideInDown, SlideOutDown } from 'react-native-reanimated';

import { SymbolView } from '@/components/symbol';
import type { Stop } from '@/api/types';
import { Group, MAP_FLOOR, chrome } from '@/components/map-controls';
import { StopDisc } from '@/components/stop-disc';
import { ThemedText, Text } from '@/components/themed-text';
import { Motion, OverPhotograph, Radius, Spacing } from '@/constants/theme';
import { stopParticulars } from '@/lib/dayDisplay';
import { formatMoney } from '@/lib/spend';

/**
 * The stop you pressed, named at the foot of the map.
 *
 * **It replaces a caption that was a paper surface standing on a photograph.** That caption was
 * `Colors.bar` over `Colors.foreground`: in the light appearance the one slate at **4% alpha**
 * and near-black ink. `palette.ts` calls that alpha "effectively opaque over paper", and over
 * paper it is — over satellite imagery it is nothing at all, so a stop's name rendered as bare
 * black letters across Apple's own attribution and three of its POI labels. DESIGN.md's
 * Photograph-Is-Not-A-Surface rule is broken twice there: small type directly on photography,
 * and the darkened band supplied by a token measured against a page.
 *
 * **So it takes the material from the ground, which is what the buttons already do.** `chrome()`
 * is the one place that decides this, keyed on whether the basemap is imagery, and borrowing it
 * is the whole fix. `palette.ts`'s `OverPhotograph` docblock records deleting an over-photograph
 * surface on the grounds that "`day-map.tsx` follows the appearance now, so its two overlays are
 * ordinary surfaces again" — true of the vector modes, and not true of Satellite, where the
 * ground is a photograph and follows nothing.
 *
 * **It says more than the name because the map said less than the list.** The same stop in the
 * list carries its time, its length, what it is and what it costs; pressing its disc on the map
 * gave you four words. These are the same facts through the same `stopParticulars`, so the two
 * faces of a stop cannot drift.
 *
 * **Pressing the body does nothing, deliberately.** It used to dismiss; that slot is being kept
 * for the sheet this grows into, which is where the row's actions (Find nearby, Ask, Lock)
 * belong. Dismissing is the close button, or pressing the marker again.
 */
export function StopCard({
  stop,
  ordinal,
  mapType,
  onDismiss,
  onLayout,
}: {
  stop: Stop;
  /** The day's own numbering, so the card carries the mark you pressed rather than a new one. */
  ordinal: number;
  /** What the map is drawing, which is what decides the material. */
  mapType: MapType;
  onDismiss: () => void;
  onLayout: (event: LayoutChangeEvent) => void;
}) {
  const { tint, ink, inkMuted, money } = chrome(mapType);
  const particulars = stopParticulars(stop);
  const spend = stop.actualCost ?? stop.cost;

  return (
    <Group
      tint={tint}
      radius={Radius.surface}
      style={styles.card}
      onLayout={onLayout}
      /* **Up from below, and down again.** It used to appear with no animation at all. Checked
         against Reanimated's own source rather than the names, which are ambiguous:
         `SlideInDown` starts a window height *below* its resting place and travels up, while
         `SlideOutDown` travels down off the edge — so the pair is symmetric in effect while
         "Down" means the origin in one and the direction in the other. */
      entering={SlideInDown.duration(Motion.settle)}
      exiting={SlideOutDown.duration(Motion.exit)}>
      <View style={styles.row}>
        {/* The emphasised disc, repeated at the size the map draws it. `OverPhotograph.accentDisc`
            rather than `Colors.accent` for the reason its docblock gives: under the light
            appearance jade darkens to `#245E48` and the ink on it measures 2.49:1. */}
        <StopDisc ordinal={ordinal} color={OverPhotograph.accentDisc} />

        <View style={styles.grow}>
          <ThemedText type="headingSmall" numberOfLines={2} style={{ color: ink }}>
            {stop.name}
          </ThemedText>
          {particulars ? (
            <ThemedText type="caption" numberOfLines={1} style={{ color: inkMuted }}>
              {particulars}
            </ThemedText>
          ) : null}
        </View>

        {/* The money *face* is kept — the same figure the row and the budget bar show, and a
            cost that changed typeface on the map would read as a different number. The money
            *colour* comes from `chrome()`, because this one is standing on the ground rather
            than on the page: shipped as `themeColor="money"`, it drew `#886019` on dark glass
            over Lisbon's rooftops, which is an olive smudge. */}
        {spend ? (
          <ThemedText type="money" style={{ color: money }}>
            {formatMoney(spend)}
          </ThemedText>
        ) : null}

        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={`Dismiss ${stop.name}`}
          style={({ pressed }) => [styles.close, pressed && { opacity: 0.6 }]}>
          <SymbolView
            // Object form, never a bare SF string — the Android path renders nothing at all
            // given one, silently. Same trap as the control glyphs.
            name={{ ios: 'xmark', android: 'close' }}
            tintColor={inkMuted}
            size={14}
            fallback={<Text style={[styles.fallback, { color: inkMuted }]}>Close</Text>}
          />
        </Pressable>
      </View>
    </Group>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: Spacing.read,
    right: Spacing.read,
    // The same floor the controls rest on — Apple's marks are the reason for both, so there is
    // one number for it. See `MAP_FLOOR`.
    bottom: MAP_FLOOR,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.rows,
    paddingLeft: Spacing.rows,
    paddingRight: Spacing.tight,
    paddingVertical: Spacing.tight,
  },
  grow: { flex: 1 },
  // A 32pt target rather than 44: it sits inside a card the thumb is already on, and 44 would
  // crowd the cost out of a one-line row.
  close: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  fallback: { fontSize: 11 },
});
