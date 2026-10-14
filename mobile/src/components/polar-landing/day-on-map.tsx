import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, type Region } from 'react-native-maps';
import { useReducedMotion } from 'react-native-reanimated';
import { legBearingRad } from '@shared/tourPacing';

import { DIVE_ALTITUDE_M, PITCH_3D } from '@/components/map-controls';
import { Polar, PolarFonts, PolarMotion, PolarRadius, PolarSpace, PolarType } from '@/constants/polar';
import { altitudeForRegion, regionForStops } from '@/lib/mapRegion';
import { Scrim } from './scrim';
import { CITIES, type DayCity } from './content';

/** The whole world, from far enough out that Apple Maps draws it whole. */
const GLOBE = { center: { latitude: 34, longitude: 48 }, altitude: 22_000_000, pitch: 0, heading: 0, zoom: 1 };

/**
 * **Apple Maps sizes a custom marker's frame from its first render, and only re-measures on a
 * later one.** Measured on this screen: a marker that never re-rendered kept a default-sized frame
 * and drew its content ~110pt east of the coordinate, while the same view re-rendered once after
 * mounting sat exactly on it. `day-map.tsx`'s constant 12pt `centerOffset` is the same effect on a
 * 44pt view. So rather than an offset that depends on whether a re-render happened, every pin here
 * is hidden until one has — see `settledFor` below — and then needs no correction at all.
 */
const SETTLE_MS = 400;

/** Markers are drawn symmetric about their point (a label one side, empty space the other), so the
 *  disc *is* the centre and no anchor arithmetic is needed — `anchor` does nothing here anyway. */
const STOP_LABEL_W = 170;
const CITY_LABEL_W = 110;
const STOP_PIN_W = STOP_LABEL_W * 2 + 32;
const CITY_PIN_W = CITY_LABEL_W * 2 + 20;

export function DayOnMap({ width }: { width: number }) {
  const map = useRef<MapView>(null);
  const reduced = useReducedMotion();
  const height = Math.round(width * 1.12);
  const [cityId, setCityId] = useState<string | null>(null);
  const [beat, setBeat] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [far, setFar] = useState(true);
  const [ready, setReady] = useState(false);
  // Which set of pins (a city id, or 'globe') has had its second render. Set from a timer rather
  // than synchronously in the effect, which the React Compiler lint forbids.
  const [settledFor, setSettledFor] = useState<string | null>(null);
  const pinSet = cityId ?? 'globe';
  const settled = ready && settledFor === pinSet;
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setSettledFor(pinSet), SETTLE_MS);
    return () => clearTimeout(t);
  }, [ready, pinSet]);
  const city = CITIES.find((c) => c.id === cityId) ?? null;
  const shown = city ?? CITIES[0];

  const overview = useCallback(
    (c: DayCity) => {
      const region = regionForStops(c.stops);
      if (!region) return;
      // `altitudeForRegion` reads the latitude span only; a day that runs east–west on a map this
      // shape needs its longitude span counted too, or the ends fall off the sides.
      const lngAsLat = region.longitudeDelta * Math.cos((region.latitude * Math.PI) / 180) * (height / width);
      const altitude = altitudeForRegion({ ...region, latitudeDelta: Math.max(region.latitudeDelta, lngAsLat) });
      map.current?.animateCamera(
        { center: { latitude: region.latitude, longitude: region.longitude }, altitude: altitude * 1.25, pitch: 0, heading: 0, zoom: 12 },
        { duration: reduced ? 0 : 2400 },
      );
    },
    [height, width, reduced],
  );

  function chooseCity(id: string) {
    const c = CITIES.find((x) => x.id === id)!;
    setPlaying(false);
    setBeat(-1);
    setCityId(id);
    overview(c);
  }

  function toGlobe() {
    setPlaying(false);
    setBeat(-1);
    setCityId(null);
    map.current?.animateCamera(GLOBE, { duration: reduced ? 0 : 2400 });
  }

  // The beat is the clock: camera, route and highlighted row all follow it.
  useEffect(() => {
    if (!city || beat < 0) return;
    const s = city.stops[beat];
    const rad = legBearingRad(city.stops, beat);
    map.current?.animateCamera(
      { center: { latitude: s.lat, longitude: s.lng }, altitude: DIVE_ALTITUDE_M, pitch: PITCH_3D, heading: rad === null ? 0 : (rad * 180) / Math.PI, zoom: 16 },
      { duration: reduced ? 0 : 1800 },
    );
  }, [beat, city, reduced]);

  useEffect(() => {
    if (!playing || !city) return;
    const t = setTimeout(
      () => {
        if (beat + 1 >= city.stops.length) {
          setPlaying(false);
          setBeat(-1);
          overview(city);
        } else setBeat(beat + 1);
      },
      beat < 0 ? 600 : PolarMotion.hold,
    );
    return () => clearTimeout(t);
  }, [playing, beat, city, overview]);

  function play() {
    if (playing) return setPlaying(false);
    if (!city) {
      chooseCity(CITIES[0].id);
      setTimeout(() => setPlaying(true), reduced ? 0 : 2600);
      return;
    }
    if (beat >= city.stops.length - 1) setBeat(-1);
    setPlaying(true);
  }

  const step = (d: number) => {
    if (!city) return;
    setPlaying(false);
    setBeat((b) => Math.max(0, Math.min(city.stops.length - 1, b + d)));
  };

  const line = useMemo(() => (city ? city.stops.map((s) => ({ latitude: s.lat, longitude: s.lng })) : []), [city]);
  const walked = beat > 0 ? line.slice(0, beat + 1) : [];
  const scale = far ? 'Globe' : beat >= 0 ? 'Street' : 'City';

  return (
    <View style={styles.night}>
      <View style={styles.head}>
        <Text style={[PolarType.kicker, { color: Polar.nightText2 }]}>Illustrative day · real places</Text>
        <Text style={[PolarType.display, { color: Polar.ice }]} accessibilityRole="header">
          {'Press play\non a day'}
        </Text>
        <Text style={[PolarType.bodyS, { color: Polar.nightText2 }]}>
          Story mode flies the camera to each stop while a voice reads the day. The order is the plan; the timing is the forecast.
        </Text>
        <View style={styles.tabs} accessibilityRole="tablist">
          {CITIES.map((c) => {
            const on = c.id === cityId;
            return (
              <Pressable key={c.id} onPress={() => chooseCity(c.id)} style={[styles.tab, on && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                <Text style={[styles.tabText, on && { color: Polar.ink }]}>{c.name}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={{ width, height }}>
        <MapView
          ref={map}
          style={StyleSheet.absoluteFill}
          initialCamera={GLOBE}
          userInterfaceStyle="dark"
          mapType="mutedStandard"
          showsPointsOfInterests={false}
          showsCompass={false}
          // The film is the interaction. A map that also pans would fight the page's own scroll
          // for every vertical drag that starts on it.
          scrollEnabled={false}
          zoomEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
          onMapReady={() => setReady(true)}
          onRegionChangeComplete={(r: Region) => setFar(r.latitudeDelta > 1.5)}
        >
          {!city &&
            CITIES.map((c) => (
              <Marker key={c.id} coordinate={{ latitude: c.lat, longitude: c.lng }} onPress={() => chooseCity(c.id)} tracksViewChanges>
                <View style={[styles.cityPin, { opacity: settled ? 1 : 0 }]} accessibilityRole="button" accessibilityLabel={`Show a day in ${c.name}`}>
                  <View style={styles.cityDot} />
                  <Text numberOfLines={1} style={[styles.cityName, c.labelLeft ? styles.cityNameLeft : styles.cityNameRight]}>
                    {c.name}
                  </Text>
                </View>
              </Marker>
            ))}
          {/* Order is z-order: Apple Maps ignores a Polyline's zIndex (see day-map.tsx). */}
          {city && <Polyline coordinates={line} strokeColor="rgba(106,240,255,0.55)" strokeWidth={1.6} lineDashPattern={[4, 4]} />}
          {city && walked.length > 1 && <Polyline coordinates={walked} strokeColor={Polar.route} strokeWidth={2.6} lineCap="round" lineJoin="round" />}
          {city &&
            city.stops.map((s, i) => {
              const on = i === beat;
              const past = beat >= 0 && i < beat;
              const tag = beat < 0 || on;
              // The stop in focus is centred by the camera, so its label always has room on the right.
              const left = s.tagLeft && !on;
              return (
                <Marker
                  key={s.name}
                  coordinate={{ latitude: s.lat, longitude: s.lng }}
                  zIndex={on ? 999 : i}
                  tracksViewChanges
                  onPress={() => {
                    setPlaying(false);
                    setBeat(i);
                  }}
                >
                  <View style={[styles.stopPin, { opacity: far || !settled ? 0 : 1 }]}>
                    <View style={[styles.disc, past && styles.discPast, on && styles.discOn]}>
                      <Text style={[styles.discN, (past || on) && { color: Polar.night }]}>{i + 1}</Text>
                    </View>
                    {tag && (
                      <View style={[styles.tag, left ? styles.tagLeft : styles.tagRight]}>
                        <Text style={styles.tagTime}>{s.time}</Text>
                        <Text numberOfLines={1} style={[styles.tagName, on && { color: Polar.ice }]}>
                          {s.name}
                        </Text>
                      </View>
                    )}
                  </View>
                </Marker>
              );
            })}
        </MapView>
        <Scrim stops={[[0, Polar.night, 1], [0.1, Polar.night, 0], [0.86, Polar.night, 0], [1, Polar.night, 1]]} />
        <View style={styles.hud} pointerEvents="box-none">
          <View style={styles.scaleChip}>
            <Text style={styles.scaleText}>{ready ? scale : 'Loading'}</Text>
          </View>
          {city && (
            <Pressable onPress={toGlobe} style={({ pressed }) => [styles.hudBtn, pressed && styles.dim]} accessibilityRole="button">
              <Text style={styles.hudBtnText}>Back to the globe</Text>
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.day}>
        <View style={styles.dayHead}>
          <Text style={styles.dayPlace}>
            {shown.name}, {shown.country}
          </Text>
          <Text style={styles.dayN}>{shown.day}</Text>
        </View>
        {shown.stops.map((s, i) => {
          const on = !!city && i === beat;
          const past = !!city && beat >= 0 && i < beat;
          return (
            <Pressable
              key={s.name}
              onPress={() => {
                if (!city) setCityId(shown.id);
                setPlaying(false);
                setBeat(i);
              }}
              style={({ pressed }) => [styles.row, on && styles.rowOn, pressed && styles.dim]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.rowTime, on && { color: Polar.route }]}>{s.time}</Text>
              <View style={styles.flex}>
                <Text numberOfLines={1} style={[styles.rowName, on && { color: Polar.ice }]}>
                  {s.name}
                </Text>
                {on && <Text style={styles.rowNote}>{s.note}</Text>}
              </View>
              <View style={[styles.mark, past && styles.markPast, on && styles.markOn]} />
            </Pressable>
          );
        })}

        <View style={styles.transport}>
          <Pressable onPress={() => step(-1)} disabled={!city || beat <= 0} style={({ pressed }) => [styles.iconBtn, (!city || beat <= 0) && styles.off, pressed && styles.dim]} accessibilityRole="button" accessibilityLabel="Previous stop">
            <Text style={styles.iconText}>‹</Text>
          </Pressable>
          <Pressable onPress={play} style={({ pressed }) => [styles.play, pressed && { backgroundColor: Polar.signalPressed }]} accessibilityRole="button" accessibilityState={{ selected: playing }}>
            <Text style={styles.playText}>{playing ? 'Pause' : beat >= 0 ? 'Resume' : 'Play the day'}</Text>
            <Text style={styles.playText}>{playing ? '❚❚' : '▸'}</Text>
          </Pressable>
          <Pressable onPress={() => step(1)} disabled={!city || beat >= shown.stops.length - 1} style={({ pressed }) => [styles.iconBtn, (!city || beat >= shown.stops.length - 1) && styles.off, pressed && styles.dim]} accessibilityRole="button" accessibilityLabel="Next stop">
            <Text style={styles.iconText}>›</Text>
          </Pressable>
          <Text style={styles.progress} accessibilityLiveRegion="polite">
            {city && beat >= 0 ? `Stop ${beat + 1} of ${city.stops.length}` : city ? 'Overview' : 'Whole world'}
          </Text>
        </View>

        <View style={styles.stats}>
          {(
            [
              ['Forecast horizon', '16 days'],
              ['Blue hour window', '20 min'],
              ['Ways to travel', '3 tiers'],
            ] as const
          ).map(([k, v]) => (
            <View key={k} style={styles.flex}>
              <Text style={styles.statK}>{k}</Text>
              <Text style={[PolarType.stat, { color: Polar.ice }]}>{v}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  dim: { opacity: 0.72 },
  off: { opacity: 0.35 },
  night: { backgroundColor: Polar.night, paddingTop: PolarSpace.s10, paddingBottom: PolarSpace.s8 },
  head: { paddingHorizontal: PolarSpace.pad, gap: PolarSpace.s3, marginBottom: PolarSpace.s4 },
  tabs: { flexDirection: 'row', gap: 6, marginTop: PolarSpace.s1 },
  tab: { height: 34, paddingHorizontal: 13, justifyContent: 'center', borderRadius: PolarRadius.hairline, borderWidth: 1, borderColor: Polar.frost20 },
  tabOn: { backgroundColor: Polar.ice, borderColor: Polar.ice },
  tabText: { fontFamily: PolarFonts.sansSemi, fontSize: 13, color: Polar.nightText2 },
  hud: { position: 'absolute', top: PolarSpace.s3, left: PolarSpace.pad, right: PolarSpace.pad, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  scaleChip: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: PolarRadius.hairline, borderWidth: 1, borderColor: Polar.frost20, backgroundColor: 'rgba(9,11,16,0.5)' },
  scaleText: { ...PolarType.label, fontSize: 10, letterSpacing: 1.4, color: Polar.nightText2 },
  hudBtn: { height: 32, paddingHorizontal: 12, justifyContent: 'center', borderRadius: PolarRadius.hairline, borderWidth: 1, borderColor: Polar.frost20, backgroundColor: 'rgba(9,11,16,0.55)' },
  hudBtnText: { fontFamily: PolarFonts.sansSemi, fontSize: 12, color: Polar.ice },

  cityPin: { width: CITY_PIN_W, height: 28, alignItems: 'center', justifyContent: 'center' },
  cityDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: Polar.route, borderWidth: 3, borderColor: 'rgba(106,240,255,0.35)' },
  cityName: { ...PolarType.label, position: 'absolute', width: CITY_LABEL_W, color: Polar.ice, textShadowColor: Polar.night, textShadowRadius: 6 },
  cityNameRight: { left: CITY_LABEL_W + 20 },
  cityNameLeft: { right: CITY_LABEL_W + 20, textAlign: 'right' },
  stopPin: { width: STOP_PIN_W, height: 44, alignItems: 'center', justifyContent: 'center' },
  disc: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: Polar.night, borderWidth: 1.5, borderColor: Polar.ice },
  discPast: { backgroundColor: Polar.ice },
  discOn: { backgroundColor: Polar.route, borderColor: Polar.route },
  discN: { fontFamily: PolarFonts.sansSemi, fontSize: 11, color: Polar.ice },
  tag: { position: 'absolute', width: STOP_LABEL_W, top: 2 },
  tagRight: { left: STOP_LABEL_W + 32, alignItems: 'flex-start' },
  tagLeft: { right: STOP_LABEL_W + 32, alignItems: 'flex-end' },
  tagTime: { fontFamily: PolarFonts.displayItalic, fontSize: 14, color: Polar.nightText2 },
  tagName: { ...PolarType.label, color: Polar.nightText2, textShadowColor: Polar.night, textShadowRadius: 6 },

  day: { paddingHorizontal: PolarSpace.pad, marginTop: PolarSpace.s2 },
  dayHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: PolarSpace.s2, borderBottomWidth: 1, borderColor: Polar.frost10 },
  dayPlace: { fontFamily: PolarFonts.displayItalic, fontSize: 20, color: Polar.ice },
  dayN: { ...PolarType.label, fontSize: 10, letterSpacing: 1.4, color: Polar.nightText2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 6, borderRadius: PolarRadius.hairline },
  rowOn: { backgroundColor: 'rgba(106,240,255,0.07)' },
  rowTime: { width: 48, fontFamily: PolarFonts.displayItalic, fontSize: 17, color: Polar.nightText2 },
  rowName: { ...PolarType.label, fontSize: 14, color: 'rgba(255,255,255,0.78)' },
  rowNote: { fontFamily: PolarFonts.sans, fontSize: 12, lineHeight: 16, color: Polar.nightText2, marginTop: 2 },
  mark: { width: 9, height: 9, borderRadius: 5, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)' },
  markPast: { backgroundColor: 'rgba(255,255,255,0.6)', borderColor: 'transparent' },
  markOn: { backgroundColor: Polar.route, borderColor: Polar.route },
  transport: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: PolarSpace.s3, marginTop: PolarSpace.s1, borderTopWidth: 1, borderColor: Polar.frost10 },
  iconBtn: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: PolarRadius.hairline, borderWidth: 1, borderColor: Polar.frost20 },
  iconText: { fontFamily: PolarFonts.sans, fontSize: 20, lineHeight: 22, color: Polar.ice },
  play: { height: 42, minWidth: 150, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: PolarRadius.hairline, backgroundColor: Polar.signal },
  playText: { fontFamily: PolarFonts.sansSemi, fontSize: 14, color: Polar.ink },
  progress: { ...PolarType.label, fontSize: 10, letterSpacing: 1.4, color: Polar.nightText2, marginLeft: 'auto' },
  stats: { flexDirection: 'row', gap: PolarSpace.s3, marginTop: PolarSpace.s5, padding: PolarSpace.s3, borderRadius: PolarRadius.card, borderWidth: 1, borderColor: Polar.frost10, backgroundColor: Polar.deep },
  statK: { fontFamily: PolarFonts.displayItalic, fontSize: 13, color: Polar.nightText2 },
});
