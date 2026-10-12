import { Image } from 'expo-image';
import { useId, useMemo, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Keyframe, ReduceMotion } from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { initialsFor } from '@shared/avatar';
import { guillochePaths, speckles } from '@shared/paperPrint';
import { stampsFor, type StampKey, type WelcomeAnswers } from '@shared/travelCard';

import { Fonts } from '@/constants/theme';
import { TravelStamp } from './travel-stamp';

const HEIGHT = 136;
/** The 2pt border sits inside the outer box, so the drawn area is the card minus both edges. */
const BORDER = 2;
const SPOTS: Record<StampKey, { x: number; y: number; w: number; r: number }> = {
  group: { x: 0.64, y: 0.58, w: 0.21, r: -11 }, home: { x: 0.91, y: 0.4, w: 0.16, r: 12 },
  pace: { x: 0.81, y: 0.66, w: 0.27, r: 5 }, loves: { x: 0.89, y: 0.84, w: 0.23, r: -7 },
};
const press = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 1.4 }] },
  45: { opacity: 1, transform: [{ scale: 0.95 }] },
  100: { opacity: 1, transform: [{ scale: 1 }] },
}).duration(520).reduceMotion(ReduceMotion.System);

/**
 * The TripMate travel card on the phone: only the top of the page shows, like a card tucked into a
 * sleeve — header, photo, holder, home port, and the stamps clustered on the right. Stamps are keyed
 * by label, so only a new or changed answer presses one.
 */
export function TravelCard({ answers, image, issued, complete = false }: { answers: WelcomeAnswers; image: string | null; issued: Date; complete?: boolean }) {
  const [width, setWidth] = useState(0);
  // Several cards can render at once, so the gradient ids must be unique per instance.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const stamps = stampsFor(answers, issued);
  const print = useMemo(() => (width ? guillochePaths(width - BORDER * 2, HEIGHT - BORDER * 2) : []), [width]);
  const grain = useMemo(() => speckles(11, 140), []);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const holder = answers.name.trim() || 'Traveller';
  const home = answers.home?.name;
  const innerW = width - BORDER * 2;
  const innerH = HEIGHT - BORDER * 2;

  return (
    <View
      onLayout={onLayout}
      style={[styles.card, complete && styles.complete]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`TripMate travel card, ${holder}${home ? `, home port ${home}` : ''}`}
    >
      {width > 0 && (
        <Svg style={StyleSheet.absoluteFill} width={innerW} height={innerH} importantForAccessibility="no-hide-descendants">
          <Defs>
            <RadialGradient id={`${uid}-paper`} cx="28%" cy="18%" r="130%"><Stop offset="0" stopColor="#f2ece1" /><Stop offset="1" stopColor="#e6ddcd" /></RadialGradient>
            <LinearGradient id={`${uid}-gutter`} x1="0" y1="0" x2="1" y2="0"><Stop offset="0" stopColor="#3c2d1e" stopOpacity={0.16} /><Stop offset="0.07" stopColor="#3c2d1e" stopOpacity={0} /></LinearGradient>
          </Defs>
          <Rect width={innerW} height={innerH} fill={`url(#${uid}-paper)`} />
          {grain.map((g, i) => <Circle key={i} cx={g.x * innerW} cy={g.y * innerH} r={g.r * 40} fill="#52453a" opacity={0.07} />)}
          {print.map((d, i) => <Path key={i} d={d} stroke={i < 2 ? 'rgba(40,110,96,0.13)' : 'rgba(122,90,60,0.09)'} strokeWidth={0.6} fill="none" />)}
          <Rect width={innerW} height={innerH} fill={`url(#${uid}-gutter)`} />
          {Array.from({ length: 14 }, (_, i) => <Circle key={`p${i}`} cx={innerW - 12} cy={16 + i * 8} r={1.1} fill="#121110" opacity={0.5} />)}
        </Svg>
      )}
      <View style={styles.head}>
        <Text style={styles.title}>TripMate<Text style={styles.titleSmall}>  TRAVEL CARD</Text></Text>
      </View>
      <View style={styles.row}>
        <View style={styles.photo}>
          {image ? <Image source={{ uri: image }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Text style={styles.initials}>{initialsFor(answers.name)}</Text>}
          <View style={styles.seal} />
        </View>
        <View style={styles.fields}>
          <Text style={styles.label}>HOLDER</Text>
          <Text style={styles.name} numberOfLines={1}>{holder}</Text>
          <Text style={[styles.label, { marginTop: 5 }]}>HOME PORT</Text>
          <Text style={[styles.value, !home && styles.empty]} numberOfLines={1}>{home ?? '—'}</Text>
        </View>
      </View>
      {width > 0 && stamps.map((s) => {
        const at = SPOTS[s.key];
        const w = at.w * innerW;
        return (
          <View key={`${s.key}-${s.label}`} pointerEvents="none" importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', left: at.x * innerW - w / 2, top: at.y * innerH - w / 2, transform: [{ rotate: `${at.r}deg` }] }}>
            <Animated.View entering={press}><TravelStamp stamp={s} width={w} /></Animated.View>
          </View>
        );
      })}
    </View>
  );
}

const INK = '#2a2420';
const SOFT = '#7a6f63';
const styles = StyleSheet.create({
  card: { height: HEIGHT, borderRadius: 9, overflow: 'hidden', borderWidth: BORDER, borderColor: 'transparent', paddingTop: 11, paddingLeft: 24, paddingRight: 16, backgroundColor: '#ece5d8', shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 16, shadowOffset: { width: 0, height: 10 } },
  complete: { borderColor: 'rgba(40,185,129,0.7)' },
  head: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(42,36,32,0.25)', paddingBottom: 6, marginBottom: 8 },
  title: { fontFamily: Fonts.display, fontSize: 17, color: INK },
  titleSmall: { fontFamily: undefined, fontSize: 8.5, fontWeight: '600', letterSpacing: 1.6, color: SOFT },
  row: { flexDirection: 'row', gap: 16 },
  photo: { width: 54, height: 72, borderRadius: 3, backgroundColor: '#c7d0cd', alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  initials: { fontSize: 17, fontWeight: '600', color: 'rgba(42,36,32,0.42)' },
  seal: { position: 'absolute', right: -9, bottom: -8, width: 26, height: 26, borderRadius: 13, backgroundColor: '#efe8dc', borderWidth: 1, borderColor: 'rgba(60,45,30,0.18)' },
  fields: { flex: 1, paddingRight: '44%' },
  label: { fontSize: 7.5, fontWeight: '600', letterSpacing: 1.4, color: SOFT },
  name: { fontFamily: Fonts.display, fontSize: 21, color: INK },
  value: { fontSize: 12, fontWeight: '500', color: INK },
  empty: { color: 'rgba(42,36,32,0.3)' },
});
