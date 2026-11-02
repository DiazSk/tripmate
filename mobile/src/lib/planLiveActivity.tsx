import { Capsule, Circle, Ellipse, HStack, Image, ProgressView, Rectangle, Spacer, Text, VStack, ZStack } from '@expo/ui/swift-ui';
import {
  activityBackgroundTint,
  aspectRatio,
  blur,
  clipped,
  clipShape,
  font,
  foregroundStyle,
  frame,
  italic,
  kerning,
  labelsHidden,
  lineLimit,
  monospacedDigit,
  multilineTextAlignment,
  offset,
  opacity,
  padding,
  progressViewStyle,
  resizable,
  strokeBorder,
  textCase,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import type { StageProgress } from '@shared/generationStages';
import { Directory, File } from 'expo-file-system';
import { createLiveActivity, widgetsDirectory, type LiveActivity, type LiveActivityEnvironment } from 'expo-widgets';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { currentStepIndex, planActivityProps, planActivityStaleAt, type PlanActivityPhase, type PlanActivityProps } from '@/lib/planActivity';
import type { PlanDay } from '@/lib/writingPlan';

/**
 * The plan being written, in the Dynamic Island and on the Lock Screen — the canvas design
 * "Live Activity · 2 Writing the plan", drawn in SwiftUI through `expo-widgets`.
 *
 * **This function is not run by the app.** The `'widget'` directive turns it into source that the
 * widget extension runs in its own JavaScript runtime, where every `@expo/ui/swift-ui` view and
 * modifier is a global. So nothing outside it can be referenced — colours are literals here, and
 * the helpers are defined inside — and props arrive serialized, dates as epoch milliseconds.
 *
 * What moves with the app away is only what SwiftUI moves itself: the ring, the running step's
 * segment and the countdown. Past `staleDate` (`isStale`) the countdown says to open TripMate.
 * Where the design calls for Oswald or Cormorant, the system's own faces stand in: the extension
 * bundles no fonts.
 */
function PlanActivity(props: PlanActivityProps, environment: LiveActivityEnvironment) {
  'widget';
  const SIGNAL = '#FF7E15';
  const ALERT = '#FF6B6B';
  const LABEL2 = 'rgba(235,235,245,0.62)';
  const FROST68 = 'rgba(255,255,255,0.68)';
  const INK = '#1F2A44';
  const writing = props.phase === 'writing';
  const ready = props.phase === 'ready';
  const failed = props.phase === 'failed';
  const stale = writing && environment.isStale === true;
  const hot = failed ? ALERT : SIGNAL;
  const whole = { lower: new Date(props.startedAt), upper: new Date(props.etaAt) };

  // Meri, the frosted globe: a pale sphere with a highlight and a rim. The design's radial gradient
  // does not draw in the widget runtime, so the shading is a blurred pale core over a greyer sphere. Thinking glances up; ready
  // closes its eyes in a smile; failed dims.
  const meri = (s: number) => (
    <ZStack modifiers={[frame({ width: s, height: s }), clipShape('circle'), opacity(failed ? 0.7 : 1)]}>
      <Circle modifiers={[foregroundStyle('#C9C6C0')]} />
      <Circle modifiers={[foregroundStyle('#F4F3F0'), frame({ width: s * 0.86, height: s * 0.86 }), offset({ x: -s * 0.07, y: -s * 0.09 }), blur(s * 0.1)]} />
      <Ellipse modifiers={[foregroundStyle('rgba(255,255,255,0.85)'), frame({ width: s * 0.38, height: s * 0.24 }), offset({ x: -s * 0.17, y: -s * 0.23 }), blur(s * 0.06)]} />
      <Circle modifiers={[strokeBorder({ color: 'rgba(255,255,255,0.35)', shape: 'circle', style: { lineWidth: Math.max(0.75, s * 0.015) } })]} />
      {ready ? (
        <HStack spacing={s * 0.12} modifiers={[offset({ y: -s * 0.02 })]}>
          <Capsule modifiers={[foregroundStyle('#3D3B38'), frame({ width: s * 0.15, height: s * 0.05 })]} />
          <Capsule modifiers={[foregroundStyle('#3D3B38'), frame({ width: s * 0.15, height: s * 0.05 })]} />
        </HStack>
      ) : (
        <HStack spacing={s * 0.12} modifiers={[offset({ y: writing ? -s * 0.05 : 0 })]}>
          {[0, 1].map((i) => (
            <ZStack key={i} modifiers={[frame({ width: s * 0.14, height: s * 0.18 })]}>
              <Ellipse modifiers={[foregroundStyle('#3D3B38'), frame({ width: s * 0.136, height: s * 0.172 })]} />
              <Circle modifiers={[foregroundStyle('#FFFFFF'), frame({ width: s * 0.042, height: s * 0.042 }), offset({ x: s * 0.022, y: -s * 0.036 })]} />
            </ZStack>
          ))}
        </HStack>
      )}
    </ZStack>
  );
  // The progress ring: the estimate filling while it is written, whole once it has ended. A ring
  // driven by `timerInterval` draws iOS's own countdown in its middle, which no modifier removes, so
  // on the island a black disc covers it (the island is black); on the Lock Screen, where the photo
  // shows through, the ring is the fraction at the last update instead.
  const ring = (s: number, lock = false) =>
    writing && !lock ? (
      <ZStack modifiers={[frame({ width: s, height: s })]}>
        <ProgressView timerInterval={whole} countsDown={false} modifiers={[progressViewStyle('circular'), tint(SIGNAL), labelsHidden(), font({ size: 1 }), foregroundStyle('#00000000'), frame({ width: s, height: s })]} />
        <Circle modifiers={[foregroundStyle('#000000'), frame({ width: s - 6, height: s - 6 })]} />
      </ZStack>
    ) : (
      <ProgressView value={writing ? props.progress : 1} modifiers={[progressViewStyle('circular'), tint(hot), labelsHidden(), frame({ width: s, height: s })]} />
    );
  // The step ring: "2/4" inside the ring; a filled check when ready; "!" when it did not finish.
  const stepRing = (s: number, lock = false) =>
    ready ? (
      <ZStack modifiers={[frame({ width: s, height: s })]}>
        <Circle modifiers={[foregroundStyle(SIGNAL)]} />
        <Image systemName="checkmark" color={INK} size={s * 0.42} />
      </ZStack>
    ) : (
      <ZStack modifiers={[frame({ width: s, height: s })]}>
        {ring(s, lock)}
        <Text modifiers={[font({ size: s * 0.34, weight: 'medium', design: 'rounded' }), monospacedDigit(), foregroundStyle(failed ? ALERT : '#FFFFFF')]}>
          {failed ? '!' : `${props.stepIndex + 1}/${props.stepCount}`}
        </Text>
      </ZStack>
    );
  // The place's photograph, Meri on its corner in a black ring.
  const badge = (s: number) => (
    <ZStack alignment="bottomTrailing" modifiers={[frame({ width: s, height: s })]}>
      {props.photo ? (
        <Image uiImage={props.photo} modifiers={[resizable(), aspectRatio({ contentMode: 'fill' }), frame({ width: s, height: s }), clipShape('roundedRectangle', 12)]} />
      ) : (
        <Rectangle modifiers={[foregroundStyle('#222222'), frame({ width: s, height: s }), clipShape('roundedRectangle', 12)]} />
      )}
      <ZStack modifiers={[frame({ width: Math.round(s * 0.46) + 5, height: Math.round(s * 0.46) + 5 }), clipShape('circle'), offset({ x: 7, y: 7 })]}>
        <Circle modifiers={[foregroundStyle('#000000')]} />
        {meri(Math.round(s * 0.46))}
      </ZStack>
    </ZStack>
  );
  // Four segments, one per step: done ones whole and pale; the running one and every one after it
  // fill in signal over their own scheduled slot, so the bar moves on through Checking and Placing
  // with nobody updating it.
  const segments = (h: number) => (
    <HStack spacing={4}>
      {Array.from({ length: props.stepCount }, (_, i) =>
        writing && i >= props.stepIndex && !stale ? (
          <ProgressView
            key={i}
            timerInterval={{ lower: new Date(props.segments[i].from), upper: new Date(props.segments[i].to) }}
            countsDown={false}
            modifiers={[progressViewStyle('linear'), tint(SIGNAL), labelsHidden(), frame({ maxWidth: 1000, height: h })]}
          />
        ) : (
          <Capsule
            key={i}
            modifiers={[
              foregroundStyle(failed && i === props.stepCount - 1 ? ALERT : !writing || i < props.stepIndex ? 'rgba(255,255,255,0.7)' : i === props.stepIndex ? SIGNAL : 'rgba(255,255,255,0.16)'),
              frame({ maxWidth: 1000, height: h }),
            ]}
          />
        )
      )}
    </HStack>
  );
  const small = (color: string) => [font({ size: 11, weight: 'semibold' }), monospacedDigit(), foregroundStyle(color), lineLimit(1)];
  const bottom = writing ? (
    <VStack spacing={7} modifiers={[padding({ horizontal: 6, top: 4 })]}>
      {segments(5)}
      <HStack>
        <Text modifiers={small(LABEL2)}>{props.meta}</Text>
        <Spacer />
        {stale ? (
          <Text modifiers={small('#FFFFFF')}>Open TripMate</Text>
        ) : (
          <HStack spacing={0}>
            <Text timerInterval={whole} countsDown modifiers={[...small('#FFFFFF'), multilineTextAlignment('trailing'), frame({ width: 34, alignment: 'trailing' })]} />
            <Text modifiers={[...small('#FFFFFF'), padding({ leading: 3 })]}>left</Text>
          </HStack>
        )}
      </HStack>
    </VStack>
  ) : (
    <HStack spacing={12} modifiers={[padding({ horizontal: 6, top: 4 })]}>
      <VStack alignment="leading" spacing={6}>
        {segments(4)}
        <Text modifiers={small(LABEL2)}>{props.meta}</Text>
      </VStack>
      <ZStack>
        <Capsule modifiers={[foregroundStyle(ready ? SIGNAL : 'rgba(255,255,255,0.16)')]} />
        <Text modifiers={[font({ size: 14, weight: 'semibold' }), foregroundStyle(ready ? INK : '#FFFFFF'), padding({ horizontal: 14, vertical: 9 })]}>{ready ? 'Open plan →' : 'Try again'}</Text>
      </ZStack>
    </HStack>
  );
  const words = (
    <VStack alignment="leading" spacing={1} modifiers={[frame({ maxWidth: 1000, alignment: 'leading' })]}>
      <Text modifiers={[font({ size: 11, weight: 'semibold' }), kerning(0.6), textCase('uppercase'), foregroundStyle(failed ? ALERT : LABEL2), lineLimit(1)]}>{props.eyebrow}</Text>
      <Text modifiers={[font({ size: 17, weight: 'semibold' }), kerning(-0.2), foregroundStyle('#FFFFFF'), lineLimit(1)]}>{props.title}</Text>
      <Text modifiers={[font({ size: 13, weight: 'medium' }), foregroundStyle(LABEL2), lineLimit(1)]}>{stale ? 'Open TripMate to see your plan' : props.sub}</Text>
    </VStack>
  );

  return {
    compactLeading: meri(24),
    compactTrailing: ready ? <Image systemName="checkmark" color={SIGNAL} size={17} /> : ring(22),
    minimal: (
      <ZStack>
        {ring(30)}
        {meri(21)}
      </ZStack>
    ),
    expandedLeading: badge(52),
    expandedCenter: words,
    expandedTrailing: <VStack modifiers={[padding({ top: 2 })]}>{stepRing(36)}</VStack>,
    expandedBottom: bottom,
    // The Lock Screen: the photograph under a night gradient, the generating screen's fact in the
    // display serif, and the same instruments as the island.
    banner: (
      <ZStack modifiers={[activityBackgroundTint('#0E1118')]}>
        {props.photo ? (
          <Image uiImage={props.photo} modifiers={[resizable(), aspectRatio({ contentMode: 'fill' }), frame({ maxWidth: 1000, maxHeight: 1000 }), clipped()]} />
        ) : null}
        {/* The design's night gradient (0.6 to 0.9) as one even layer: the widget runtime draws no gradients. */}
        <Rectangle modifiers={[foregroundStyle('#090B10'), opacity(0.76)]} />
        <VStack alignment="leading" spacing={0} modifiers={[padding({ all: 14 })]}>
          <HStack spacing={10}>
            {meri(22)}
            <Text modifiers={[font({ size: 11, weight: 'medium' }), kerning(2), textCase('uppercase'), foregroundStyle(failed ? ALERT : FROST68), lineLimit(1)]}>{props.eyebrow}</Text>
            <Spacer />
            {stepRing(30, true)}
          </HStack>
          <Text modifiers={[font({ size: 19, weight: 'regular', design: 'serif' }), italic(), foregroundStyle('#FFFFFF'), lineLimit(2), frame({ maxWidth: 1000, minHeight: 46, alignment: 'topLeading' }), padding({ top: 8 })]}>
            {stale ? 'Open TripMate to see your plan.' : props.fact || props.sub}
          </Text>
          <VStack modifiers={[padding({ top: 12 })]}>{bottom}</VStack>
        </VStack>
      </ZStack>
    ),
  };
}

/** iOS only: `expo-widgets` has no Live Activities elsewhere, and the planner just runs without one. */
export const planLiveActivity = Platform.OS === 'ios' ? createLiveActivity<PlanActivityProps>('PlanActivity', PlanActivity) : null;

/** The place's photograph, copied where the widget extension can read it (it cannot reach the app's
 *  own files, nor the network). Null if it could not be saved: the island then shows Meri. */
async function savePhoto(url: string): Promise<string | null> {
  try {
    const saved = await File.downloadFileAsync(url, new File(new Directory(widgetsDirectory), 'plan-photo.jpg'), { idempotent: true });
    return saved.uri;
  } catch {
    return null;
  }
}

/**
 * The plan's Live Activity, owned by the writing screen: started when the run begins, updated as
 * the step or the day being written changes (only while the app is in front — see `planActivity.ts`),
 * and ended the moment the plan is ready, fails, or the screen goes away. Live Activities switched
 * off in Settings, or an older iOS, make `start` throw; the planner then simply runs without one.
 */
export function usePlanLiveActivity(input: {
  startedAt: number | null;
  phase: PlanActivityPhase;
  destination: string;
  dateRange: string | null;
  tripDays: number;
  tierName: string | null;
  stages: readonly StageProgress[];
  days: PlanDay[];
  facts: readonly string[];
  photoUrl: string | null;
}): void {
  const activity = useRef<LiveActivity<PlanActivityProps> | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const { startedAt, phase, photoUrl } = input;

  useEffect(() => {
    if (!planLiveActivity || !photoUrl) return;
    let live = true;
    void savePhoto(photoUrl).then((uri) => {
      if (live) setPhoto(uri);
    });
    return () => {
      live = false;
    };
  }, [photoUrl]);

  // What a person would see change: the step, the day being written, the photo, the outcome. Not the
  // estimate, which the system already animates on its own; it is taken from the clock in the effect.
  const stepStart = useRef<{ index: number; at: number } | null>(null);
  const shown = startedAt === null ? null : planActivityProps({ ...input, startedAt, stepStartedAt: startedAt, now: startedAt, photo });
  const key = shown ? [shown.phase, shown.title, shown.sub, shown.fact, shown.photo].join('|') : null;

  useEffect(() => {
    if (!planLiveActivity || !shown || startedAt === null) return;
    const now = Date.now();
    // When the running step began, as this screen saw it: its slot is measured from there.
    const index = currentStepIndex(input.stages);
    if (stepStart.current?.index !== index) stepStart.current = { index, at: index === 0 ? startedAt : now };
    const props = planActivityProps({ ...input, startedAt, stepStartedAt: stepStart.current.at, now, photo });
    if (phase !== 'writing') {
      // In front, the trip is opening anyway. Away (the app learned it while still running in the
      // background), the ending stays on the Lock Screen: "Kyoto is ready", as the design ends.
      void activity.current?.end(AppState.currentState === 'active' ? 'immediate' : 'default', props).catch(() => {});
      activity.current = null;
      return;
    }
    try {
      if (activity.current) void activity.current.update(props, planActivityStaleAt(props)).catch(() => {});
      else activity.current = planLiveActivity.start(props, undefined, planActivityStaleAt(props));
    } catch {
      activity.current = null;
    }
    // `key` stands for the props, which are a new object on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Gone with the screen: Cancel, a new attempt, or the trip opening.
  useEffect(
    () => () => {
      void activity.current?.end('immediate').catch(() => {});
      activity.current = null;
    },
    []
  );
}
