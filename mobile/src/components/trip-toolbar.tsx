import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, Easing } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import { Meridian } from '@/components/meridian';
import { BlurView } from '@/components/blur';
import { SymbolView } from '@/components/symbol';
import { Colors } from '@/constants/theme';
import { formatMoney } from '@/lib/spend';

type Face = 'list' | 'map';

/**
 * The canvas design "Phone trip · 2C Day pages, budget at the thumb" (`.dp-toolbar`), value for
 * value: one capsule, 6pt padding and gaps, 48pt targets, the List | Map switch with a white thumb
 * that slides, white glyphs on a faint chip, orange only on +.
 *
 * Under 390pt wide (an SE, a mini) the targets go to 44, the HIG minimum: at 48 the five of them
 * and the switch do not fit a 375pt screen.
 */
const WIDE = 48;
const NARROW = 44;
/** Each half of the switch: "Map" with its glyph, at 14pt semibold, plus the canvas's 8pt sides. */
const HALF = 66;
const INSET = 3;

/** On the glass, as the canvas has them. */
const INK = '#1f2a44';
const SIGNAL = '#ff7e15';
const ON_GLASS = '#fff';
const DIMMED = 'rgba(255,255,255,0.38)';

/**
 * The labels here do not grow past this. The bar is one row of fixed-width targets with nowhere
 * to wrap, so at the accessibility sizes the words would push + off the screen — the same reason
 * the system tab bar keeps its labels fixed. Each target's VoiceOver label carries the full name.
 */
const LABEL_SCALE = 1.1;

/**
 * Everything that acts on the trip, at the thumb.
 *
 * It was a row under the day strip — List/Map, Play, Ask and + at the top of a screen read
 * one-handed in a street, the one place a thumb does not reach. Here it floats over whichever face
 * is showing, so the list and the map keep their own full height and the controls never move when
 * the face does. The budget, which was a bar across the chrome, is the ring: the figure at a
 * glance, and the breakdown one tap away.
 *
 * **Drawn, not `Stack.Toolbar`.** The system's bottom toolbar was tried: iOS 26 splits its items
 * into separate glass capsules (List, Map, the tools, +) however they are grouped, and the design
 * is one thumb. So the bar is ours, on liquid glass where the OS has it.
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
  const { width } = useWindowDimensions();
  const tool = width < 390 ? NARROW : WIDE;
  // `bottom: calc(var(--tk-bottom) - 6px)`: just into the home indicator's band.
  const bottom = Math.max(insets.bottom - 6, 8);
  const glass = isLiquidGlassAvailable();

  // The thumb slides between the halves, 0.28s on the canvas's curve.
  const slide = useSharedValue(face === 'map' ? 1 : 0);
  useEffect(() => {
    slide.value = withTiming(face === 'map' ? 1 : 0, { duration: 280, easing: Easing.bezier(0.3, 0.9, 0.3, 1) });
  }, [face, slide]);
  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: slide.value * HALF }] }));

  const chip = { width: tool, height: tool, borderRadius: tool / 2 };

  return (
    <View
      pointerEvents="box-none"
      style={[styles.dock, { bottom }]}
      onLayout={(event: LayoutChangeEvent) => onHeight(event.nativeEvent.layout.height + bottom)}>
      <View style={styles.shadow}>
        <View style={styles.bar}>
          {glass ? (
            <GlassView glassEffectStyle="regular" colorScheme="dark" isInteractive style={StyleSheet.absoluteFill} />
          ) : (
            <BlurView intensity={80} tint="systemChromeMaterialDark" style={StyleSheet.absoluteFill} />
          )}

          <View style={[styles.switch, { height: tool, borderRadius: tool / 2 }]} accessibilityRole="tablist">
            <Animated.View style={[styles.thumb, { borderRadius: tool / 2 - INSET }, thumbStyle]} />
            {(['list', 'map'] as const).map((option) => {
              const on = face === option;
              const color = on ? INK : 'rgba(255,255,255,0.8)';
              return (
                <Pressable
                  key={option}
                  onPress={() => onFace(option)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={option === 'list' ? 'Show the day as a list' : 'Show the day on the map'}
                  style={styles.half}>
                  <SymbolView
                    name={option === 'list' ? { ios: 'list.bullet', android: 'format_list_bulleted' } : { ios: 'map', android: 'map' }}
                    tintColor={color}
                    size={15}
                  />
                  <Text maxFontSizeMultiplier={LABEL_SCALE} style={[styles.halfText, { color }]}>
                    {option === 'list' ? 'List' : 'Map'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Play works offline: the film reads the plan when TripMate cannot write the story. */}
          <Tool label="Play this day" disabled={!canPlay} onPress={onPlay} style={chip}>
            <SymbolView name={{ ios: 'play.fill', android: 'play_arrow' }} tintColor={canPlay ? ON_GLASS : DIMMED} size={16} />
          </Tool>
          {/* Meri, not the canvas's ✦: Ask opens a conversation with your TripMate, and Zaid chose
              the face over a glyph or the word. Larger in its chip than the glyphs beside it, since a
              face needs the room to read. The accessible label still says what it does. */}
          <Tool label="Ask for a change" disabled={offline} onPress={onAsk} style={chip}>
            <Meridian state={offline ? 'offline' : 'idle'} size={tool - 14} />
          </Tool>
          {budget > 0 ? (
            <Tool label={`Budget: ${formatMoney(spent)} of ${formatMoney(budget)}`} onPress={onBudget} style={chip}>
              <Ring fraction={spent / budget} />
            </Tool>
          ) : null}
          <Tool label="Add a stop" disabled={offline} onPress={onAdd} style={[chip, !offline && styles.signal]}>
            <SymbolView name={{ ios: 'plus', android: 'add' }} tintColor={offline ? DIMMED : INK} size={18} />
          </Tool>
        </View>
      </View>
    </View>
  );
}

function Tool({
  label,
  disabled = false,
  onPress,
  style,
  children,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
  style: object;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.tool, style, pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

/** Spend against the budget, as a ring (`.dp-ring`). Coral once it runs over, the alert sense of that colour. */
function Ring({ fraction }: { fraction: number }) {
  const size = 30;
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  const over = fraction > 1;
  return (
    <View style={styles.ring}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.22)" strokeWidth={3} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={over ? Colors.alert : ON_GLASS}
          strokeWidth={3}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${Math.min(1, Math.max(0, fraction)) * c} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Text maxFontSizeMultiplier={LABEL_SCALE} style={styles.ringMark}>
        $
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { position: 'absolute', left: 8, right: 8, alignItems: 'center' },
  // `0 10px 30px rgba(0,0,0,.35)`, on a wrapper: the bar clips its glass, and a clipped view casts no shadow.
  shadow: { borderRadius: 30, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 15, shadowOffset: { width: 0, height: 10 }, elevation: 12 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 6,
    borderRadius: 30,
    overflow: 'hidden',
    // `inset 0 0 0 0.5px rgba(255,255,255,.18)`
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  switch: { flexDirection: 'row', padding: INSET, backgroundColor: 'rgba(118,118,128,0.3)' },
  thumb: {
    position: 'absolute',
    top: INSET,
    bottom: INSET,
    left: INSET,
    width: HALF,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  half: { width: HALF, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  halfText: { fontSize: 14, fontWeight: '600' },
  tool: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  signal: { backgroundColor: SIGNAL },  pressed: { opacity: 0.7 },
  ring: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  ringMark: { color: ON_GLASS, fontSize: 13, fontWeight: '700' },
});
