import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Colors, ControlShadow, Radius, Spacing } from '@/constants/theme';
import { formatMoney } from '@/lib/spend';

type Face = 'list' | 'map';

/** 44, the HIG minimum, rather than 48: five targets and a two-up switch have to fit a 375pt
 *  phone with the 16pt gutters, and at 48 they come to 362pt against 343 of room. */
const TOOL = 44;

/**
 * Everything that acts on the trip, at the thumb.
 *
 * It was a row under the day strip — List/Map, Play, Ask and + at the top of a screen read
 * one-handed in a street, the one place a thumb does not reach. Here it floats over whichever face
 * is showing, so the list and the map keep their own full height and the controls never move when
 * the face does. The budget, which was a bar across the chrome, is the ring: the figure at a
 * glance, and the breakdown one tap away.
 *
 * Orange stays on +, the screen's one primary action. Which face you are reading is not an action,
 * so the selected half is paper on the glass instead.
 */
export function TripToolbar({
  face,
  onFace,
  canPlay,
  onPlay,
  offline,
  onAsk,
  onAdd,
  spent,
  budget,
  onBudget,
  onHeight,
}: {
  face: Face;
  onFace: (face: Face) => void;
  canPlay: boolean;
  onPlay: () => void;
  offline: boolean;
  onAsk: () => void;
  onAdd: () => void;
  spent: number;
  budget: number;
  onBudget: () => void;
  /** How much of the screen's foot it covers, so the faces can keep their content clear of it. */
  onHeight: (height: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom - 6, Spacing.tight);
  const glass = isLiquidGlassAvailable();

  return (
    <View
      pointerEvents="box-none"
      style={[styles.dock, { bottom }]}
      onLayout={(event: LayoutChangeEvent) => onHeight(event.nativeEvent.layout.height + bottom)}>
      <View style={[styles.bar, ControlShadow]}>
        {glass ? (
          <GlassView glassEffectStyle="regular" colorScheme="dark" isInteractive style={StyleSheet.absoluteFill} />
        ) : (
          <BlurView intensity={80} tint="systemChromeMaterialDark" style={StyleSheet.absoluteFill} />
        )}

        <View style={styles.switch}>
          {(['list', 'map'] as const).map((option) => {
            const on = face === option;
            return (
              <Pressable
                key={option}
                onPress={() => onFace(option)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={[styles.half, on && styles.halfOn]}>
                <SymbolView
                  name={option === 'list' ? { ios: 'list.bullet', android: 'format_list_bulleted' } : { ios: 'map', android: 'map' }}
                  tintColor={on ? Colors.accentForeground : Colors.foreground}
                  size={14}
                />
                <ThemedText type="detail" style={{ color: on ? Colors.accentForeground : Colors.foreground, fontWeight: '600' }}>
                  {option === 'list' ? 'List' : 'Map'}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>

        {/* Play works offline: the film reads the plan when TripMate cannot write the story. */}
        <Tool label={`Play this day`} disabled={!canPlay} onPress={onPlay}>
          <SymbolView name={{ ios: 'play.fill', android: 'play_arrow' }} tintColor={canPlay ? Colors.foreground : Colors.muted} size={16} />
        </Tool>
        <Tool label="Ask for a change" disabled={offline} onPress={onAsk}>
          <SymbolView name={{ ios: 'sparkles', android: 'auto_awesome' }} tintColor={offline ? Colors.muted : Colors.foreground} size={17} />
        </Tool>
        {budget > 0 ? (
          <Tool label={`Budget: ${formatMoney(spent)} of ${formatMoney(budget)}`} onPress={onBudget}>
            <Ring fraction={spent / budget} />
          </Tool>
        ) : null}
        <Tool label="Add a stop" disabled={offline} onPress={onAdd} primary>
          <SymbolView
            name={{ ios: 'plus', android: 'add' }}
            tintColor={offline ? Colors.muted : Colors.accentForeground}
            size={18}
          />
        </Tool>
      </View>
    </View>
  );
}

function Tool({
  label,
  disabled = false,
  primary = false,
  onPress,
  children,
}: {
  label: string;
  disabled?: boolean;
  primary?: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.tool,
        primary && !disabled && styles.toolPrimary,
        pressed && styles.toolPressed,
      ]}>
      {children}
    </Pressable>
  );
}

/** Spend against the budget, as a ring. Coral once it runs over, the alert sense of that colour. */
function Ring({ fraction }: { fraction: number }) {
  const size = 28;
  const r = size / 2 - 2.5;
  const c = 2 * Math.PI * r;
  const over = fraction > 1;
  return (
    <View style={styles.ring}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={Colors.moneySoft} strokeWidth={3} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={over ? Colors.alert : Colors.money}
          strokeWidth={3}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${Math.min(1, Math.max(0, fraction)) * c} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <ThemedText type="micro" style={styles.ringMark}>
        $
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { position: 'absolute', left: Spacing.read, right: Spacing.read, alignItems: 'center' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 6,
    borderRadius: Radius.pill,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
  },
  switch: {
    flexDirection: 'row',
    height: TOOL,
    padding: 3,
    borderRadius: Radius.pill,
    backgroundColor: Colors.control,
  },
  half: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.rows,
    borderRadius: Radius.pill,
  },
  halfOn: { backgroundColor: Colors.foreground },
  tool: {
    width: TOOL,
    height: TOOL,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.control,
  },
  toolPrimary: { backgroundColor: Colors.accent },
  toolPressed: { opacity: 0.7 },
  ring: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  ringMark: { color: Colors.money, fontWeight: '700' },
});
