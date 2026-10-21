import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Pressable, StyleSheet, Text } from 'react-native';

import { BlurView } from '@/components/blur';
import { Polar } from '@/constants/polar';
import { Colors } from '@/constants/theme';

/**
 * A sheet's way out, top right, the way an iOS 26 sheet draws Done: the word in a Liquid Glass
 * capsule sized to it, semibold in the accent. One component for the planner's sheets (paper) and
 * the trip's (night), so every sheet says it one way; Add a stop passes "Cancel", because closing
 * it drops a search and a chosen place.
 *
 * **Drawn by the sheet, not by a native bar item.** In a bar, iOS 26 wraps a custom item in its
 * own glass, which squeezed "Done" into a circle and, in the planner's stack, took the app's dark
 * trait over a light sheet; the stable APIs give no way to set either per screen.
 */
export function SheetDone({ onPress, label = 'Done', paper = false }: { onPress: () => void; label?: string; paper?: boolean }) {
  const text = <Text style={[styles.label, { color: paper ? Polar.ember : Colors.accentText }]}>{label}</Text>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8} style={({ pressed }) => pressed && styles.pressed}>
      {isLiquidGlassAvailable() ? (
        <GlassView glassEffectStyle="regular" colorScheme={paper ? 'light' : 'dark'} isInteractive style={styles.capsule}>
          {text}
        </GlassView>
      ) : (
        <BlurView intensity={60} tint={paper ? 'systemChromeMaterialLight' : 'systemChromeMaterialDark'} style={styles.capsule}>
          {text}
        </BlurView>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  capsule: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 17, fontWeight: '600' },
  pressed: { opacity: 0.75 },
});
