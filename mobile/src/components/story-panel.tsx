import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import type { MapType } from 'react-native-maps';
import { SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Group, chrome } from '@/components/map-controls';
import { Meridian } from '@/components/meridian';
import { ThemedText } from '@/components/themed-text';
import { Motion, Radius, Spacing } from '@/constants/theme';
import { filmSubtitle, filmTitle, meriForFilm } from '@/lib/meri';
import type { useStoryFilm } from '@/lib/useStoryFilm';

/**
 * The film, followed and controlled from the foot of the map — the stop card's material and
 * place, because it stands on the same ground (`chrome()` decides glass and ink by whether the
 * basemap is imagery).
 *
 * Laid out to the Frosted Meridian reference (column 02 of
 * `docs/superpowers/specs/assets/2026-10-11-meri-reference.webp`): Meri and the day's title head
 * it, the line being spoken sits under them with the next one in a single muted row, and three
 * centred controls close it — the middle one the panel's only fill.
 */
export function StoryPanel({
  film,
  destination,
  day,
  dayIndex,
  dayCount,
  mapType,
  onClose,
  onNextDay,
  onLayout,
}: {
  film: ReturnType<typeof useStoryFilm>;
  destination: string;
  day: { title?: string } | undefined;
  dayIndex: number;
  dayCount: number;
  mapType: MapType;
  onClose: () => void;
  onNextDay?: () => void;
  /** Its measured height, so the map can keep Apple's marks and its dives above the sheet. */
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const insets = useSafeAreaInsets();
  const { tint, ink, inkMuted } = chrome(mapType);
  const { state, script } = film;
  const beat = script?.beats[state.beat];
  const following = script?.beats[state.beat + 1];
  const loading = state.phase === 'loading';
  const ended = state.phase === 'ended';
  const playing = state.phase === 'playing';
  const subtitle = filmSubtitle(script, state);

  return (
    <Group
      tint={tint}
      radius={Radius.surface}
      squareBottom
      style={styles.panel}
      onLayout={onLayout}
      entering={SlideInDown.duration(Motion.settle)}
      exiting={SlideOutDown.duration(Motion.exit)}>
      <View style={[styles.body, { paddingBottom: insets.bottom + Spacing.tight }]}>
        {/* Reference 02's header: Meri, the film's title, where you are in it, and the way out. */}
        <View style={styles.header}>
          <Meridian state={meriForFilm(state)} size={40} pulse={film.words} />
          <View style={[styles.grow, styles.heading]}>
            {/* `detail` at medium weight, not `label` — that is the 11pt tracked caps of "LIST · MAP". */}
            <ThemedText type="detail" numberOfLines={1} style={{ color: ink, fontWeight: '500' }}>
              {filmTitle(day, destination)}
            </ThemedText>
            {/* Only when it is true — the reference has no status lines, and these are facts. */}
            {subtitle ? (
              <ThemedText type="caption" numberOfLines={1} style={{ color: inkMuted }}>
                {subtitle}
              </ThemedText>
            ) : null}
          </View>
          {loading || ended ? null : (
            <ThemedText type="caption" style={{ color: inkMuted }}>
              {`${state.beat + 1} of ${state.count}`}
            </ThemedText>
          )}
          <Control icon={{ ios: 'xmark', android: 'close' }} label="Close" onPress={onClose} ink={inkMuted} />
        </View>

        <ThemedText
          type="body"
          // Announced only when the voice is not reading it: with the narrator working, TalkBack
          // would speak every line twice. (iOS ignores live regions either way.)
          accessibilityLiveRegion={state.voiceBroken ? 'polite' : 'none'}
          style={{ color: ink }}>
          {loading ? `Writing the story of day ${dayIndex + 1}…` : ended ? 'That was the day.' : beat?.text}
        </ThemedText>
        {following && !ended && !loading ? (
          <ThemedText type="detail" numberOfLines={1} style={[styles.next, { color: inkMuted }]}>
            {following.text}
          </ThemedText>
        ) : null}

        <View style={styles.transport}>
          {ended ? (
            <>
              <Control label="Again" onPress={film.toggle} ink={ink} />
              {onNextDay && dayIndex + 1 < dayCount ? (
                <Control label={`Day ${dayIndex + 2}`} onPress={onNextDay} ink={ink} />
              ) : null}
            </>
          ) : (
            <>
              <Control
                icon={{ ios: 'backward.end.fill', android: 'skip_previous' }}
                label="Previous"
                onPress={film.prev}
                ink={ink}
                disabled={loading || state.beat === 0}
              />
              {/* The one filled control: a 48pt disc in the ink at 14%, the reference's centre. */}
              <Pressable
                onPress={film.toggle}
                disabled={loading}
                accessibilityRole="button"
                accessibilityLabel={playing ? 'Pause' : 'Play'}
                accessibilityState={{ disabled: loading }}
                style={({ pressed }) => [
                  styles.play,
                  { backgroundColor: `${ink}24` },
                  loading ? { opacity: 0.35 } : pressed && { opacity: 0.7 },
                ]}>
                <SymbolView
                  name={playing ? { ios: 'pause.fill', android: 'pause' } : { ios: 'play.fill', android: 'play_arrow' }}
                  tintColor={ink}
                  size={20}
                  fallback={<Text style={{ color: ink }}>{playing ? 'Pause' : 'Play'}</Text>}
                />
              </Pressable>
              <Control
                icon={{ ios: 'forward.end.fill', android: 'skip_next' }}
                label="Next"
                onPress={film.next}
                ink={ink}
                disabled={loading}
              />
            </>
          )}
        </View>
      </View>
    </Group>
  );
}

/** A 44pt transport target: an SF Symbol where there is one, the word otherwise. */
function Control({
  icon,
  label,
  onPress,
  ink,
  disabled = false,
}: {
  icon?: React.ComponentProps<typeof SymbolView>['name'];
  label: string;
  onPress: () => void;
  ink: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.control, disabled ? { opacity: 0.35 } : pressed && { opacity: 0.6 }]}>
      {icon ? (
        <SymbolView
          // Object form, never a bare SF string — the Android path renders nothing given one.
          name={icon}
          tintColor={ink}
          size={18}
          fallback={<Text style={{ color: ink }}>{label}</Text>}
        />
      ) : (
        <ThemedText type="label" style={{ color: ink }}>
          {label}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Full bleed, like the reference: edge to edge and standing on the screen's bottom edge, its top
  // corners rounded and its bottom square. The safe-area inset is added at the foot in the render.
  panel: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  // **Room between every line, deliberately.** The header, the line being spoken, the next line
  // and the controls are four different kinds of thing; packed at a 4pt gap they read as one block.
  body: { paddingHorizontal: Spacing.compact, paddingTop: Spacing.compact },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.rows, marginBottom: Spacing.read },
  heading: { gap: 2 },
  next: { marginTop: Spacing.tight },
  grow: { flex: 1 },
  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.read * 2, marginTop: Spacing.read },
  play: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  control: { minWidth: 44, height: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.tight },
});
