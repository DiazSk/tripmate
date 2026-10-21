import { Oswald_400Regular } from '@expo-google-fonts/oswald';
import { splitForSpeech, estimateDurationMs } from '@shared/storyPacing';
import { beatAt, beatDurations, clockLabel } from '@shared/storyTimeline';
import type { StoryBeat } from '@shared/storyScript';
import { useFonts } from 'expo-font';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  SlideOutDown,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import Svg, { Defs, LinearGradient, Rect, Stop as GradientStop } from 'react-native-svg';

import { SymbolView } from '@/components/symbol';
import type { DayPlan } from '@/api/types';
import { Meridian } from '@/components/meridian';
import { PlacePhoto } from '@/components/place-photo';
import { StopDisc } from '@/components/stop-disc';
import { Polar, PolarFonts, PolarRadius } from '@/constants/polar';
import { Curve, Motion, dayCore } from '@/constants/theme';
import { filmSubtitle, meriForFilm } from '@/lib/meri';
import { filmBeatTitle } from '@/lib/storyFilm';
import type { useStoryFilm } from '@/lib/useStoryFilm';

/**
 * The film as the canvas design "Story mode · 1 Subtitles", at phone width — the web's
 * `StoryStage` on the same seams.
 *
 * The map is the picture. The line being spoken is a subtitle directly above the transport, one
 * sentence at a time, its words lighting as the voice reaches them, so the eye reads the words and
 * the place in one look. No box over the shot: a night gradient rises from the foot so white type
 * holds on Apple's daytime map and on imagery alike. Under it, the player: the place now playing and
 * the film's toggles, then the transport, then the day's scrubber, on night, edge to edge. Up next
 * is a strip of chapters that slides up above the bar.
 *
 * **The words light on the voice's own word events**, not an estimate: `speakBeat` reports each
 * sentence as it begins and `expo-speech`'s `onBoundary` each word, and a muted film or a voice that
 * failed is "said" by `silentSpeech` at the narrator's pace through the same path. The phone layout of
 * the design has no volume slider (the hardware buttons are the volume) and no "Open this stop":
 * the film is the trip screen while it plays.
 */
export function StoryPanel({
  film,
  destination,
  day,
  dayIndex,
  dayCount,
  onClose,
  onNextDay,
  onInset,
}: {
  film: ReturnType<typeof useStoryFilm>;
  destination: string;
  day: DayPlan | undefined;
  dayIndex: number;
  dayCount: number;
  onClose: () => void;
  onNextDay?: () => void;
  /** How much of the map's foot the player covers, so the dives land above it. Steady through a
   *  film: the subtitle keeps a fixed room, so a longer sentence never moves the camera. */
  onInset?: (height: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const [oswald] = useFonts({ Oswald_400Regular });
  const condensed = oswald ? PolarFonts.condensed : PolarFonts.sansSemi;
  const [subs, setSubs] = useState(true);
  const [chapters, setChapters] = useState(false);

  // The rise is a transform that always ends at 0, as the panel this replaced learned: a layout
  // animation measured on mount lands on the wrong height once the script arrives.
  const reduceMotion = useReducedMotion();
  const rise = useSharedValue(reduceMotion ? 0 : 320);
  useEffect(() => {
    rise.value = withTiming(0, { duration: Motion.settle, easing: Easing.bezier(...Curve) });
  }, [rise]);
  const riseStyle = useAnimatedStyle(() => ({ transform: [{ translateY: rise.value }] }));

  const { state, script } = film;
  const stops = day?.stops ?? [];
  const beats = useMemo(() => script?.beats ?? [], [script]);
  const loading = state.phase === 'loading';
  const ended = state.phase === 'ended';
  const playing = state.phase === 'playing';
  const beat = loading ? undefined : beats[state.beat];
  const nextBeat = loading || ended ? undefined : beats[state.beat + 1];
  const stopOf = (b: StoryBeat | undefined) => (b?.kind === 'stop' && typeof b.stopIndex === 'number' ? stops[b.stopIndex] : undefined);
  const current = stopOf(beat);
  const title = (b: StoryBeat | undefined) => filmBeatTitle(b, stops, dayIndex);
  const hasNextDay = !!onNextDay && dayIndex + 1 < dayCount;
  const note = filmSubtitle(script, state);

  // The subtitle's place, read off the film's shared values into this panel only: a word re-renders
  // the player, never the trip screen behind it.
  const [place, setPlace] = useState({ sentence: 0, spoken: 0 });
  useAnimatedReaction(
    () => ({ sentence: film.sentence.value, spoken: film.spoken.value }),
    (now, before) => {
      if (!before || now.sentence !== before.sentence || now.spoken !== before.spoken) scheduleOnRN(setPlace, now);
    },
  );
  const sentences = useMemo(() => (beat ? splitForSpeech(beat.text) : []), [beat]);
  const sentence = sentences[Math.min(place.sentence, Math.max(0, sentences.length - 1))] ?? '';
  const words = sentence ? sentence.split(' ') : [];

  // The day's scrubber, estimated as the web's is (`storyTimeline.ts`), and placed within the beat
  // by how far through its sentences and their words the voice has got.
  const durations = useMemo(() => beatDurations(beats), [beats]);
  const total = durations.reduce((a, b) => a + b, 0);
  const weights = useMemo(() => sentences.map((s) => estimateDurationMs(s)), [sentences]);
  const beatWeight = weights.reduce((a, b) => a + b, 0) || 1;
  const within =
    (weights.slice(0, place.sentence).reduce((a, b) => a + b, 0) + (weights[place.sentence] ?? 0) * Math.min(1, words.length ? place.spoken / words.length : 0)) /
    beatWeight;
  const elapsed = loading ? 0 : ended ? total : durations.slice(0, state.beat).reduce((a, b) => a + b, 0) + (durations[state.beat] ?? 0) * within;
  const fraction = total > 0 ? Math.min(1, elapsed / total) : 0;
  const [trackW, setTrackW] = useState(0);

  const [columnH, setColumnH] = useState(0);
  useEffect(() => {
    if (columnH) onInset?.(columnH);
  }, [columnH, onInset]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* The night that holds the words. Taller when the chapters lift the subtitle. */}
      {subs ? (
        <Animated.View
          entering={FadeIn.duration(Motion.settle)}
          exiting={FadeOut.duration(Motion.exit)}
          pointerEvents="none"
          style={[styles.scrim, { height: screenH * (chapters ? 0.78 : 0.5) }]}>
          <Svg width="100%" height="100%" preserveAspectRatio="none">
            <Defs>
              <LinearGradient id="film-night" x1="0" y1="1" x2="0" y2="0">
                <GradientStop offset="0" stopColor={Polar.night} stopOpacity={0.94} />
                <GradientStop offset="0.5" stopColor={Polar.night} stopOpacity={0.8} />
                <GradientStop offset="1" stopColor={Polar.night} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#film-night)" />
          </Svg>
        </Animated.View>
      ) : null}

      <Animated.View
        style={[styles.column, riseStyle]}
        exiting={SlideOutDown.duration(Motion.exit)}
        onLayout={(event) => setColumnH(event.nativeEvent.layout.height)}
        pointerEvents="box-none">
        {subs ? (
          <View style={styles.subs} pointerEvents="box-none">
            <Pressable
              onPress={() => setSubs(false)}
              accessibilityRole="button"
              accessibilityLabel="Hide the subtitles"
              hitSlop={8}
              style={({ pressed }) => [styles.subsX, pressed && { opacity: 0.6 }]}>
              <Icon name={{ ios: 'xmark', android: 'close' }} size={13} color={Polar.nightText2} label="Hide" />
            </Pressable>
            {loading ? (
              <Text maxFontSizeMultiplier={CHROME_CAP} style={styles.wait}>{`Writing the story of day ${dayIndex + 1}…`}</Text>
            ) : ended ? (
              <View style={styles.end}>
                <Text maxFontSizeMultiplier={CHROME_CAP} style={[styles.line, styles.lineDone]}>{`Day ${dayIndex + 1} is done.`}</Text>
                <View style={styles.endActions}>
                  <Pill label="Again" onPress={() => film.seek(0)} />
                  {hasNextDay ? <Pill label={`Day ${dayIndex + 2} ▸`} onPress={onNextDay!} go /> : null}
                </View>
              </View>
            ) : (
              <>
                <View style={styles.eyebrowRow}>
                  {/* Meri, saying it: its pulse is the voice's words. */}
                  <Meridian state={meriForFilm(state)} size={18} pulse={film.words} />
                  <Text maxFontSizeMultiplier={CHROME_CAP} style={[styles.eyebrow, { fontFamily: condensed }]} numberOfLines={1}>
                    {`${title(beat)}${current?.time ? ` · ${current.time}` : ''}`.toUpperCase()}
                  </Text>
                </View>
                <Text maxFontSizeMultiplier={CHROME_CAP}
                  style={styles.line}
                  // Announced only when no voice is reading it, or TalkBack speaks every line twice.
                  accessibilityLiveRegion={state.voiceBroken || state.muted ? 'polite' : 'none'}
                  accessibilityLabel={sentence}>
                  {words.map((word, i) => (
                    <Text maxFontSizeMultiplier={CHROME_CAP} key={`${state.beat}-${place.sentence}-${i}`} style={i < place.spoken ? styles.said : styles.unsaid}>
                      {`${word} `}
                    </Text>
                  ))}
                </Text>
                {nextBeat ? (
                  <Text maxFontSizeMultiplier={TEXT_CAP} style={styles.next} numberOfLines={1}>
                    {`Next · ${title(nextBeat)}`}
                    {stopOf(nextBeat)?.time ? <Text maxFontSizeMultiplier={CHROME_CAP} style={[styles.nextTime, { fontFamily: condensed }]}>{`  ${stopOf(nextBeat)!.time}`}</Text> : null}
                  </Text>
                ) : null}
              </>
            )}
            {note ? <Text maxFontSizeMultiplier={TEXT_CAP} style={styles.note}>{note}</Text> : null}
          </View>
        ) : null}

        {chapters ? (
          <Animated.View entering={FadeIn.duration(Motion.respond)} exiting={FadeOut.duration(Motion.exit)} style={styles.chapters}>
            <View style={styles.chaptersHead}>
              <Text maxFontSizeMultiplier={CHROME_CAP} style={styles.chaptersTitle}>{`Chapters · Day ${dayIndex + 1}`}</Text>
              <Text maxFontSizeMultiplier={CHROME_CAP} style={styles.chaptersTheme} numberOfLines={1}>
                {day?.title || day?.theme || ''}
              </Text>
              <Control icon={{ ios: 'xmark', android: 'close' }} label="Close chapters" onPress={() => setChapters(false)} />
            </View>
            {loading ? (
              <Text maxFontSizeMultiplier={CHROME_CAP} style={[styles.wait, styles.waitSmall]}>{`Writing the story of day ${dayIndex + 1}…`}</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chapterRow}>
                {beats.map((b, i) => {
                  const on = i === state.beat && !ended;
                  const stop = stopOf(b);
                  return (
                    <Pressable
                      key={i}
                      onPress={() => film.seek(i)}
                      accessibilityRole="button"
                      accessibilityLabel={`Chapter ${i + 1}, ${title(b)}`}
                      accessibilityState={{ selected: on }}
                      style={({ pressed }) => [styles.chapter, on && styles.chapterOn, (i < state.beat || ended) && styles.chapterPast, pressed && { opacity: 0.7 }]}>
                      <Art beat={b} stopName={stop?.name} dayIndex={dayIndex} wide />
                      <Text maxFontSizeMultiplier={CHROME_CAP} style={[styles.chapterN, on && styles.chapterNOn, { fontFamily: condensed }]}>{String(i + 1).padStart(2, '0')}</Text>
                      <Text maxFontSizeMultiplier={TEXT_CAP} style={styles.chapterName} numberOfLines={1}>
                        {title(b)}
                      </Text>
                      <Text maxFontSizeMultiplier={TEXT_CAP} style={styles.chapterMeta} numberOfLines={1}>
                        {[stop?.time, clockLabel(durations[i] ?? 0)].filter(Boolean).join(' · ')}
                      </Text>
                    </Pressable>
                  );
                })}
                {hasNextDay ? (
                  <Pressable onPress={onNextDay} accessibilityRole="button" accessibilityLabel={`Play day ${dayIndex + 2}`} style={({ pressed }) => [styles.chapter, styles.chapterDay, pressed && { opacity: 0.7 }]}>
                    <Text maxFontSizeMultiplier={TEXT_CAP} style={[styles.chapterMeta, { fontFamily: condensed, letterSpacing: 1 }]}>THEN</Text>
                    <Text maxFontSizeMultiplier={TEXT_CAP} style={styles.chapterName}>{`Day ${dayIndex + 2} ▸`}</Text>
                  </Pressable>
                ) : null}
              </ScrollView>
            )}
          </Animated.View>
        ) : null}

        {/* The player, edge to edge on night */}
        <View style={[styles.bar, { paddingBottom: insets.bottom + 8 }]}>
          <View style={styles.now}>
            <Art beat={ended ? beats[beats.length - 1] : beat} stopName={current?.name} dayIndex={dayIndex} />
            <View style={styles.nowText}>
              {/* Two lines, not one: four controls share this row, and at one line a stop's name
                  was cut at about 17 characters ("Praça do Comér…"). */}
              <Text maxFontSizeMultiplier={CHROME_CAP} style={styles.nowTitle} numberOfLines={2}>
                {loading ? `Writing day ${dayIndex + 1}…` : ended ? `Day ${dayIndex + 1} is done` : title(beat)}
              </Text>
              <Text maxFontSizeMultiplier={TEXT_CAP} style={styles.nowSub} numberOfLines={1}>
                {`${destination.split(',')[0]} · Day ${dayIndex + 1}${day?.title ? ` · ${day.title}` : ''}`}
              </Text>
            </View>
            <Control icon={{ ios: 'captions.bubble', android: 'closed_caption' }} label="Subtitles" on={subs} onPress={() => setSubs(!subs)} />
            <Control icon={{ ios: 'list.bullet', android: 'queue_music' }} label="Up next" on={chapters} onPress={() => setChapters(!chapters)} />
            <Control
              icon={state.muted ? { ios: 'speaker.slash.fill', android: 'volume_off' } : { ios: 'speaker.wave.2.fill', android: 'volume_up' }}
              label={state.muted ? 'Unmute narration' : 'Mute narration'}
              onPress={film.mute}
            />
            {/* Leaving is how the plan comes back. */}
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Leave the film and show the plan"
              style={({ pressed }) => [styles.plan, pressed && { opacity: 0.8 }]}>
              <Text maxFontSizeMultiplier={CHROME_CAP} style={styles.planText}>Plan</Text>
            </Pressable>
          </View>

          {/* Two equal sides about the play disc, so it stays centred however wide "Day 2 ▸" is. */}
          <View style={styles.transport}>
            <View style={[styles.side, styles.sideStart]}>
              <Control icon={{ ios: 'arrow.counterclockwise', android: 'replay' }} label="Play the day again" onPress={() => film.seek(0)} disabled={loading} />
              <Control icon={{ ios: 'backward.end.fill', android: 'skip_previous' }} label="Previous place" onPress={film.prev} disabled={loading || state.beat === 0} />
            </View>
            {/* The one solid object on the bar: an ice disc, ink glyph. */}
            <Pressable
              onPress={film.toggle}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel={ended ? 'Play the day again' : playing ? 'Pause' : 'Play'}
              accessibilityState={{ disabled: loading }}
              style={({ pressed }) => [styles.play, loading ? { opacity: 0.4 } : pressed && { transform: [{ scale: 0.96 }] }]}>
              <Icon name={playing ? { ios: 'pause.fill', android: 'pause' } : { ios: 'play.fill', android: 'play_arrow' }} size={18} color={Polar.ink} label={playing ? 'Pause' : 'Play'} />
            </Pressable>
            <View style={styles.side}>
              <Control icon={{ ios: 'forward.end.fill', android: 'skip_next' }} label="Next place" onPress={film.next} disabled={loading} />
              {hasNextDay ? (
                <Pressable onPress={onNextDay} accessibilityRole="button" accessibilityLabel={`Play day ${dayIndex + 2}`} style={({ pressed }) => [styles.control, pressed && { opacity: 0.6 }]}>
                  {/* The words the chapters strip uses for the same press, not a "D2" code. */}
                  <Text maxFontSizeMultiplier={CHROME_CAP} style={styles.nextDay} numberOfLines={1}>{`Day ${dayIndex + 2} ▸`}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          <View style={styles.scrub}>
            <Text maxFontSizeMultiplier={CHROME_CAP} style={[styles.time, { fontFamily: condensed }]}>{clockLabel(elapsed)}</Text>
            <Pressable
              style={styles.track}
              onLayout={(event) => setTrackW(event.nativeEvent.layout.width)}
              onPress={(event) => trackW > 0 && !loading && film.seek(beatAt(durations, event.nativeEvent.locationX / trackW))}
              accessibilityRole="adjustable"
              accessibilityLabel="Position in the day's story"
              accessibilityValue={{ text: `${clockLabel(elapsed)} of ${clockLabel(total)}` }}
              accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
              onAccessibilityAction={(event) => (event.nativeEvent.actionName === 'increment' ? film.next() : film.prev())}>
              <View style={styles.trackLine} />
              <View style={[styles.trackFill, { width: `${fraction * 100}%` }]} />
              {durations.slice(0, -1).map((_, i) => {
                const at = durations.slice(0, i + 1).reduce((a, b) => a + b, 0) / (total || 1);
                return <View key={i} style={[styles.tick, { left: `${at * 100}%` }]} />;
              })}
            </Pressable>
            <Text maxFontSizeMultiplier={CHROME_CAP} style={[styles.time, { fontFamily: condensed }]}>{loading ? '…' : clockLabel(total)}</Text>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

/** The art for a beat: the stop's photograph, the day's number on the opening, ★ at the close, a
 *  walker on the way between. Never a grey box. */
function Art({ beat, stopName, dayIndex, wide = false }: { beat?: StoryBeat; stopName?: string; dayIndex: number; wide?: boolean }) {
  const box = wide ? styles.artWide : styles.art;
  if (beat?.kind === 'stop' && stopName) {
    // The stop's disc is the ground, and the photograph paints over it when there is one — so a
    // stop with no photograph (or one still loading) shows its number, never an empty square.
    return (
      <View style={[box, styles.artGround]}>
        {typeof beat.stopIndex === 'number' ? <StopDisc ordinal={beat.stopIndex + 1} color={dayCore(dayIndex)} /> : null}
        <PlacePhoto name={stopName} aspectRatio={wide ? 16 / 9 : 1} radius={PolarRadius.sm} style={styles.artPhoto} />
      </View>
    );
  }
  return (
    <View style={[box, styles.artGround]}>
      {beat?.kind === 'travel' ? (
        <Icon name={{ ios: 'figure.walk', android: 'directions_walk' }} size={wide ? 20 : 16} color={Polar.nightText2} label="" />
      ) : (
        <Text maxFontSizeMultiplier={CHROME_CAP} style={styles.artMark}>{beat?.kind === 'closing' ? '★' : String(dayIndex + 1)}</Text>
      )}
    </View>
  );
}

function Pill({ label, onPress, go = false }: { label: string; onPress: () => void; go?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.pill, go && styles.pillGo, pressed && { opacity: 0.8 }]}>
      <Text maxFontSizeMultiplier={CHROME_CAP} style={[styles.pillText, go && { color: Polar.ink }]}>{label}</Text>
    </Pressable>
  );
}

/** A 44pt target on night: an SF Symbol where there is one, the word otherwise. */
function Control({
  icon,
  label,
  onPress,
  on = false,
  disabled = false,
}: {
  icon: React.ComponentProps<typeof SymbolView>['name'];
  label: string;
  onPress: () => void;
  on?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: on }}
      style={({ pressed }) => [styles.control, disabled ? { opacity: 0.35 } : pressed && { opacity: 0.6 }]}>
      <Icon name={icon} size={17} color={on ? Polar.signal : Polar.nightText2} label={label} />
      {on ? <View style={styles.onDot} /> : null}
    </Pressable>
  );
}

function Icon({ name, size, color, label }: { name: React.ComponentProps<typeof SymbolView>['name']; size: number; color: string; label: string }) {
  // Object form, never a bare SF string: the Android path renders nothing given one.
  return <SymbolView name={name} tintColor={color} size={size} fallback={<Text maxFontSizeMultiplier={CHROME_CAP} style={{ color }}>{label}</Text>} />;
}

/**
 * How far the film's type follows Dynamic Type. The player is fixed chrome over a moving picture —
 * one row of targets, a subtitle with a fixed room so the camera holds still — so, like the system's
 * own media controls, it grows only so far: the subtitle and the bar's names to 1.3x, the small
 * captions under them to 1.6x (ThemedText's cap). Uncapped at AX3 the subtitle ran off the top of the
 * screen and the bar's clock wrapped to two lines.
 */
const CHROME_CAP = 1.3;
const TEXT_CAP = 1.6;

const NIGHT_BAR = 'rgba(9,11,16,0.96)';
const HAIRLINE = 'rgba(255,255,255,0.08)';

const styles = StyleSheet.create({
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  column: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  // **A fixed room for the subtitle**, so a sentence of one line or three never changes the inset
  // the map pads its dives by: the camera holds still while the words change.
  subs: { minHeight: 150, justifyContent: 'flex-end', alignItems: 'center', gap: 6, paddingHorizontal: 36, paddingBottom: 18 },
  subsX: { position: 'absolute', top: 0, right: 12, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' },
  eyebrow: { color: Polar.signal, fontSize: 12, letterSpacing: 1.4, flexShrink: 1 },
  line: { fontFamily: PolarFonts.display, fontSize: 23, lineHeight: 28, textAlign: 'center', color: '#FFFFFF', textShadowColor: 'rgba(9,11,16,0.9)', textShadowRadius: 14 },
  lineDone: { color: '#FFFFFF' },
  // The words the voice has not reached yet sit back; each lights as it is said.
  unsaid: { color: 'rgba(255,255,255,0.42)' },
  said: { color: '#FFFFFF' },
  next: { fontFamily: PolarFonts.sansSemi, fontSize: 12, color: Polar.nightText2 },
  nextTime: { fontSize: 12, color: Polar.nightText2 },
  note: { fontFamily: PolarFonts.sans, fontSize: 11, color: Polar.nightText2, marginTop: 2 },
  wait: { fontFamily: PolarFonts.displayItalic, fontSize: 21, color: Polar.nightText2, textAlign: 'center' },
  waitSmall: { fontSize: 16, textAlign: 'left' },
  end: { alignItems: 'center', gap: 12 },
  endActions: { flexDirection: 'row', gap: 8 },
  pill: { minHeight: 44, paddingHorizontal: 18, borderRadius: 9999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  pillGo: { backgroundColor: Polar.signal, borderColor: Polar.signal },
  pillText: { fontFamily: PolarFonts.sansSemi, fontSize: 14, color: '#FFFFFF' },

  chapters: { backgroundColor: 'rgba(9,11,16,0.94)', borderTopWidth: 1, borderTopColor: HAIRLINE, paddingTop: 10, paddingBottom: 12, gap: 8 },
  chaptersHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 16, paddingRight: 6 },
  chaptersTitle: { fontFamily: PolarFonts.sansSemi, fontSize: 14, color: '#FFFFFF' },
  chaptersTheme: { flex: 1, fontFamily: PolarFonts.displayItalic, fontSize: 15, color: Polar.nightText2 },
  chapterRow: { paddingHorizontal: 12, gap: 8 },
  chapter: { width: 168, padding: 5, gap: 3, borderRadius: PolarRadius.card },
  chapterOn: { backgroundColor: 'rgba(255,126,21,0.14)' },
  chapterPast: { opacity: 0.6 },
  chapterDay: { justifyContent: 'flex-end', borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.2)', minHeight: 140 },
  chapterN: { position: 'absolute', top: 11, left: 11, paddingHorizontal: 5, paddingVertical: 1, fontSize: 11, color: Polar.ink, backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: PolarRadius.hairline, overflow: 'hidden' },
  chapterNOn: { backgroundColor: Polar.signal },
  chapterName: { fontFamily: PolarFonts.sansSemi, fontSize: 13, color: '#FFFFFF' },
  chapterMeta: { fontFamily: PolarFonts.sans, fontSize: 11, color: Polar.nightText2 },

  bar: { backgroundColor: NIGHT_BAR, borderTopWidth: 1, borderTopColor: HAIRLINE, paddingTop: 10, paddingHorizontal: 12, gap: 4 },
  // Room for a two-line title whether or not this beat's needs it, so the bar keeps one height
  // through the film and the map's inset holds still.
  now: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 50 },
  nowText: { flex: 1, minWidth: 0, marginLeft: 8, gap: 1 },
  nowTitle: { fontFamily: PolarFonts.sansSemi, fontSize: 14, color: '#FFFFFF' },
  nowSub: { fontFamily: PolarFonts.sans, fontSize: 11, color: Polar.nightText2 },
  art: { width: 44, height: 44, borderRadius: PolarRadius.sm, overflow: 'hidden' },
  artWide: { width: '100%', aspectRatio: 16 / 9, borderRadius: PolarRadius.sm, overflow: 'hidden', marginBottom: 3 },
  artGround: { backgroundColor: Polar.deep, alignItems: 'center', justifyContent: 'center' },
  artPhoto: { position: 'absolute', top: 0, left: 0, backgroundColor: 'transparent' },
  // Inter, not Cormorant: Cormorant's old-style 1 reads as a capital I at this size.
  artMark: { fontFamily: PolarFonts.sansSemi, fontSize: 17, color: 'rgba(255,255,255,0.55)' },
  plan: { minHeight: 36, paddingHorizontal: 14, marginLeft: 4, borderRadius: PolarRadius.hairline, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  planText: { fontFamily: PolarFonts.sansSemi, fontSize: 13, color: Polar.ink },
  transport: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  side: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14 },
  sideStart: { justifyContent: 'flex-end' },
  play: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  control: { minWidth: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  onDot: { position: 'absolute', bottom: 5, width: 4, height: 4, borderRadius: 2, backgroundColor: Polar.signal },
  nextDay: { fontFamily: PolarFonts.sansSemi, fontSize: 13, color: Polar.nightText2 },
  scrub: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  time: { minWidth: 36, textAlign: 'center', fontSize: 12, color: Polar.nightText2 },
  track: { flex: 1, height: 28, justifyContent: 'center' },
  trackLine: { position: 'absolute', left: 0, right: 0, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)' },
  trackFill: { position: 'absolute', left: 0, height: 3, borderRadius: 2, backgroundColor: '#FFFFFF' },
  tick: { position: 'absolute', width: 2, height: 7, marginLeft: -1, backgroundColor: Polar.night },
});
