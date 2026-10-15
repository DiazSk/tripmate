import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Line, Pattern, Rect } from 'react-native-svg';

import type { Account } from '@/api/auth';
import type { ProfileStats } from '@/api/types';
import { Avatar } from '@/components/avatar';
import { Polar, PolarFonts } from '@/constants/polar';
import { passportLines } from '@/lib/profileRows';
import { formatMoney } from '@/lib/spend';

/**
 * The passport data page that leads the Profile tab (canvas design "Phone profile · 4 Settings with
 * a passport"): the Trips tab keeps your trips as passes, and this is the passport they were issued
 * to. Your photo, your name split as a passport splits it, where you set off from, the three
 * figures, and the machine-readable line (`passportLines`). A tap opens the account.
 *
 * The guilloche is one SVG pattern of fine diagonals over paper: enough to read as security print,
 * quiet enough that the fields stay the thing you read.
 */
export function Passport({ account, homeCity, stats, onPress }: { account: Account | null; homeCity: string | null; stats: ProfileStats | undefined; onPress: () => void }) {
  const { surname, given, mrz } = passportLines(account?.name);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={account ? `${account.name ?? given}. Open your account` : 'Not signed in. Sign in'}
      style={({ pressed }) => [styles.page, pressed && styles.pressed]}>
      <Svg style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Defs>
          <Pattern id="guilloche" width={9} height={9} patternUnits="userSpaceOnUse" patternTransform="rotate(25)">
            <Line x1={0} y1={0} x2={0} y2={9} stroke={Polar.ink} strokeOpacity={0.05} strokeWidth={1} />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#guilloche)" />
      </Svg>

      <View style={styles.top}>
        <Text style={styles.issuer}>TripMate</Text>
        <Text style={styles.kind}>Travel profile · Passport</Text>
      </View>

      <View style={styles.data}>
        <View style={styles.photo}>
          <Avatar account={account} size={84} />
        </View>
        <View style={styles.fields}>
          <Field k="Surname" v={account ? (surname ?? given) : 'Not signed in'} />
          <Field k="Given name" v={account ? given : 'Traveller'} />
          <Field k="Sets off from" v={homeCity ?? 'Anywhere'} />
          {/* Absent until the figures arrive: three dashes say nothing an absent row does not.
              "Planned", not "Spent": nothing here collects payments. */}
          {stats ? (
            <View style={styles.figures}>
              <Field k="Trips" v={String(stats.trips)} />
              <Field k="Places" v={String(stats.places)} />
              <Field k="Planned" v={formatMoney(stats.spend)} wide />
            </View>
          ) : null}
        </View>
      </View>

      <Text style={styles.mrz} numberOfLines={1} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {mrz}
      </Text>
    </Pressable>
  );
}

function Field({ k, v, wide = false }: { k: string; v: string; wide?: boolean }) {
  return (
    <View style={wide ? styles.fieldWide : styles.field}>
      <Text style={styles.k}>{k}</Text>
      <Text style={styles.v} numberOfLines={1}>
        {v}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    marginHorizontal: 16,
    marginBottom: 22,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    overflow: 'hidden',
    borderRadius: 14,
    backgroundColor: Polar.paper,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(31,42,68,0.12)',
    shadowColor: Polar.ink,
    shadowOpacity: 0.14,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 10 },
  },
  pressed: { transform: [{ scale: 0.985 }] },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 },
  issuer: { fontFamily: PolarFonts.condensed, fontSize: 15, letterSpacing: 2.7, textTransform: 'uppercase', color: Polar.ink },
  kind: { fontSize: 10, fontWeight: '600', letterSpacing: 1.4, textTransform: 'uppercase', color: Polar.ember },
  data: { flexDirection: 'row', gap: 14 },
  photo: { width: 96, height: 118, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(31,42,68,0.08)' },
  fields: { flex: 1, minWidth: 0, gap: 7 },
  figures: { flexDirection: 'row', gap: 8 },
  field: { flex: 1, minWidth: 0 },
  fieldWide: { flex: 1.5, minWidth: 0 },
  k: { fontSize: 9, fontWeight: '600', letterSpacing: 1.1, textTransform: 'uppercase', color: 'rgba(31,42,68,0.55)' },
  v: { fontFamily: PolarFonts.condensed, fontSize: 18, lineHeight: 21, textTransform: 'uppercase', color: Polar.ink },
  mrz: { marginTop: 12, fontFamily: 'Menlo', fontSize: 11.5, letterSpacing: 0.7, color: 'rgba(31,42,68,0.7)' },
});
