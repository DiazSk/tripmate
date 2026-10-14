import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { QuietLink } from '@/components/polar-ui';
import { Polar, PolarFonts, PolarRadius, PolarSpace } from '@/constants/polar';

/**
 * The boarding pass the web's `/signin` draws, for the phone: one ice pass over the night ground
 * (`signin/_layout.tsx`), the form on top, and a perforated stub below that fills in as you go.
 * One column, as the web's pass becomes below 860px: the perforation runs across, not down.
 */

/** Out, without a cost: back if there is a back, Trips if there is not (a cold start can open
 *  here with nothing behind it, since `+native-intent` launches straight onto the pass). */
export function leaveSignIn() {
  if (router.canGoBack()) router.back();
  else router.replace('/(tabs)/trips');
}

export function PassScreen({ children, below }: { children: ReactNode; below?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + PolarSpace.s4, paddingBottom: insets.bottom + PolarSpace.s4 }]}
        keyboardShouldPersistTaps="handled">
        {children}
        {below}
        <Text style={styles.coord}>Wadi Rum, Jordan · [ 29º 35’ 00” N, 35º 25’ 00” E ]</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** The pass: the form above the perforation, the stub's rows below it. */
export function Pass({ stage, head, children, stub }: { stage: string; head?: ReactNode; children: ReactNode; stub: ReactNode }) {
  return (
    <View style={styles.pass}>
      <View style={styles.main}>
        <View style={styles.head}>
          <Text style={styles.stage}>{stage}</Text>
          {head}
        </View>
        {children}
      </View>
      <View style={styles.stub}>
        {/* The tear: a dashed rule with the two notches a real pass has, cut in night. */}
        <View style={styles.perf} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={[styles.notch, styles.notchLeft]} />
          <View style={styles.dash} />
          <View style={[styles.notch, styles.notchRight]} />
        </View>
        {stub}
      </View>
    </View>
  );
}

/** The stub's four facts, two to a row: who, from, to and what the account carries. */
export function StubRows({ passenger }: { passenger: string }) {
  const rows: [string, string][] = [
    ['From', 'This phone'],
    ['To', 'Any phone and the web'],
    ['Carrying', 'Your trips and travel profile'],
  ];
  return (
    <View style={styles.rows}>
      <View style={styles.cell}>
        <Text style={styles.dt}>Passenger</Text>
        <Text style={styles.passenger} numberOfLines={2}>
          {passenger}
        </Text>
      </View>
      {rows.map(([k, v]) => (
        <View key={k} style={styles.cell}>
          <Text style={styles.dt}>{k}</Text>
          <Text style={styles.dd}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

/** The stub's foot: a big figure over a caption, the seat before the code step and the gate code at it. */
export function StubFoot({ label, figure, note }: { label: string; figure: ReactNode; note: string }) {
  return (
    <View style={styles.foot}>
      <Text style={styles.dt}>{label}</Text>
      {figure}
      <Text style={styles.note}>{note}</Text>
    </View>
  );
}

/** Under the pass, on the photograph: the promise, and the way out. */
export function PassBelow() {
  return (
    <View style={styles.below}>
      <Text style={styles.belowText}>Anything you planned on this phone comes with you.</Text>
      <QuietLink light title="Keep planning without an account" onPress={leaveSignIn} style={styles.centered} />
    </View>
  );
}

export const passStyles = StyleSheet.create({
  title: { fontFamily: PolarFonts.display, fontSize: 34, lineHeight: 36, color: Polar.ink },
  lead: { fontFamily: PolarFonts.sans, fontSize: 14, lineHeight: 21, color: Polar.charcoal },
  hint: { fontFamily: PolarFonts.sans, fontSize: 12, lineHeight: 17, color: Polar.charcoal },
  seat: { fontFamily: PolarFonts.condensed, fontSize: 40, lineHeight: 44, color: Polar.ink },
});

const NOTCH = 22;
const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', gap: PolarSpace.s4, paddingHorizontal: PolarSpace.pad },
  pass: {
    borderRadius: PolarRadius.card,
    backgroundColor: Polar.ice,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 20 },
  },
  main: { gap: PolarSpace.s3, paddingHorizontal: PolarSpace.pad, paddingTop: PolarSpace.s5, paddingBottom: PolarSpace.s4 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: PolarSpace.s2, minHeight: 36 },
  stage: { fontFamily: PolarFonts.sansSemi, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: Polar.ember },
  stub: {
    gap: PolarSpace.s4,
    paddingHorizontal: PolarSpace.pad,
    paddingTop: PolarSpace.s4,
    paddingBottom: PolarSpace.s4,
    backgroundColor: Polar.paper,
    borderBottomLeftRadius: PolarRadius.card,
    borderBottomRightRadius: PolarRadius.card,
  },
  perf: { position: 'absolute', top: -NOTCH / 2, left: 0, right: 0, height: NOTCH, flexDirection: 'row', alignItems: 'center' },
  dash: { flex: 1, marginHorizontal: 4, borderTopWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(31,42,68,0.22)' },
  notch: { width: NOTCH, height: NOTCH, borderRadius: NOTCH / 2, backgroundColor: 'rgba(9,11,16,0.92)' },
  notchLeft: { marginLeft: -NOTCH / 2 },
  notchRight: { marginRight: -NOTCH / 2 },
  rows: { flexDirection: 'row', flexWrap: 'wrap', rowGap: PolarSpace.s3 },
  cell: { width: '50%', paddingRight: PolarSpace.s2, gap: 3 },
  dt: { fontFamily: PolarFonts.sansSemi, fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', color: Polar.charcoal },
  dd: { fontFamily: PolarFonts.sansSemi, fontSize: 14, lineHeight: 19, color: Polar.ink },
  passenger: { fontFamily: PolarFonts.condensed, fontSize: 24, lineHeight: 27, textTransform: 'uppercase', color: Polar.ink },
  foot: { gap: 5, paddingTop: PolarSpace.s3, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Polar.rule },
  note: { fontFamily: PolarFonts.sans, fontSize: 12, lineHeight: 17, color: Polar.charcoal },
  below: { alignItems: 'center', gap: 2 },
  centered: { alignSelf: 'center' },
  belowText: { fontFamily: PolarFonts.sans, fontSize: 14, lineHeight: 20, color: Polar.ice, textAlign: 'center' },
  coord: { fontFamily: PolarFonts.sans, fontSize: 11, letterSpacing: 0.7, color: Polar.nightText2, textAlign: 'center' },
});
