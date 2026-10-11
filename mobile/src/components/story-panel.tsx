import { beatOpacity } from '@shared/storyScript';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MapType } from 'react-native-maps';
import { SlideInDown, SlideOutDown } from 'react-native-reanimated';

import type { Stop } from '@/api/types';
import { Group, MAP_FLOOR, chrome } from '@/components/map-controls';
import { StopDisc } from '@/components/stop-disc';
import { ThemedText } from '@/components/themed-text';
import { Motion, OverPhotograph, Radius, Spacing } from '@/constants/theme';
import type { useStoryFilm } from '@/lib/useStoryFilm';

/**
 * The film, followed and controlled from the foot of the map — the stop card's material and
 * place, because it stands on the same ground (`chrome()` decides glass and ink by whether the
 * basemap is imagery).
 *
 * Two lines rather than the web's lyric column: the line being spoken, and the next one faded by
 * the same `beatOpacity` — enough to read along without covering the place the camera just
 * arrived at.
 */
export function StoryPanel({
  film,
  stops,
  dayIndex,
  dayCount,
  mapType,
  onClose,
  onNextDay,
}: {
  film: ReturnType<typeof useStoryFilm>;
  stops: Stop[];
  dayIndex: number;
  dayCount: number;
  mapType: MapType;
  onClose: () => void;
  onNextDay?: () => void;
}) {
  const { tint, ink, inkMuted } = chrome(mapType);
  const { state, script } = film;
  const beat = script?.beats[state.beat];
  const following = script?.beats[state.beat + 1];
  // The hook's own answer (`filmStopFor`), which is null once the film has ended — re-deriving it
  // from the beat left the last stop's name standing over "That was the day."
  const stop = film.stop === null ? undefined : stops[film.stop];
  const loading = state.phase === 'loading';
  const ended = state.phase === 'ended';

  return (
    <Group
      tint={tint}
      radius={Radius.surface}
      style={styles.panel}
      entering={SlideInDown.duration(Motion.settle)}
      exiting={SlideOutDown.duration(Motion.exit)}>
      <View style={styles.body}>
        {stop && film.stop !== null ? (
          <View style={styles.title}>
            <StopDisc ordinal={film.stop + 1} color={OverPhotograph.accentDisc} />
            <ThemedText type="headingSmall" numberOfLines={1} style={[styles.grow, { color: ink }]}>
              {stop.name}
            </ThemedText>
          </View>
        ) : null}

        <ThemedText type="body" accessibilityLiveRegion="polite" style={{ color: ink }}>
          {loading ? `Writing the story of day ${dayIndex + 1}…` : ended ? 'That was the day.' : beat?.text}
        </ThemedText>
        {following && !ended && !loading ? (
          <ThemedText
            type="detail"
            numberOfLines={2}
            style={{ color: inkMuted, opacity: beatOpacity(state.beat + 1, state.beat) }}>
            {following.text}
          </ThemedText>
        ) : null}

        {script?.source === 'fallback' ? (
          <ThemedText type="caption" style={{ color: inkMuted }}>
            Read from your plan.
          </ThemedText>
        ) : null}
        {state.voiceBroken ? (
          <ThemedText type="caption" style={{ color: inkMuted }}>
            The voice isn&rsquo;t available, so the story plays as text.
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
              <Control icon={{ ios: 'backward.fill', android: 'skip_previous' }} label="Previous" onPress={film.prev} ink={ink} />
              <Control
                icon={state.phase === 'playing' ? { ios: 'pause.fill', android: 'pause' } : { ios: 'play.fill', android: 'play_arrow' }}
                label={state.phase === 'playing' ? 'Pause' : 'Play'}
                onPress={film.toggle}
                ink={ink}
              />
              <Control icon={{ ios: 'forward.fill', android: 'skip_next' }} label="Next" onPress={film.next} ink={ink} />
              <ThemedText type="detail" style={[styles.grow, styles.count, { color: inkMuted }]}>
                {loading ? '' : `${state.beat + 1} of ${state.count}`}
              </ThemedText>
            </>
          )}
          <Control icon={{ ios: 'xmark', android: 'close' }} label="Close" onPress={onClose} ink={inkMuted} />
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
}: {
  icon?: React.ComponentProps<typeof SymbolView>['name'];
  label: string;
  onPress: () => void;
  ink: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.control, pressed && { opacity: 0.6 }]}>
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
  panel: { position: 'absolute', left: Spacing.read, right: Spacing.read, bottom: MAP_FLOOR },
  body: { paddingHorizontal: Spacing.rows, paddingTop: Spacing.rows, paddingBottom: Spacing.tight, gap: Spacing.hair },
  title: { flexDirection: 'row', alignItems: 'center', gap: Spacing.tight },
  grow: { flex: 1 },
  count: { textAlign: 'right' },
  transport: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.tight },
  control: { minWidth: 44, height: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.tight },
});
