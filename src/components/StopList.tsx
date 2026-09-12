"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

import { Bike, Car, Footprints } from "lucide-react";

import { Stop, StopCategory } from "@/lib/types";
import {
  PROFILE_VERB,
  meaningfulLeg,
  type DayRoute,
  type RouteLeg,
  type RouteProfile,
  useRouteProfile,
} from "@/lib/dayRoutes";
import { formatDistance, formatDuration } from "@/lib/format";
import { groupStopsByTimeOfDay, type TimeOfDay } from "@/lib/timeOfDay";
import { usePlacePhoto } from "@/lib/usePlacePhoto";
import Typewriter from "./Typewriter";
import { EntryIcon, FoodIcon, PinIcon, TransitIcon } from "./icons";
import { devLabel } from "@/lib/devInspector";

const CATEGORY_ICON: Record<StopCategory, typeof FoodIcon> = {
  food: FoodIcon,
  entry: EntryIcon,
  transit: TransitIcon,
  other: PinIcon,
};

/** The category tile is the base layer and never unmounts; the photo resolves over it on
 *  `.value-in`. Swapping one for the other made every avatar in the list jump at whatever
 *  moment its Wikipedia lookup happened to land.
 *
 *  Exported for `StoryStage`, which shows the same stops in the same visual language while the
 *  film plays — and gets the already-warm `usePlacePhoto` cache entry for free, since the panel it
 *  replaced had just looked the same names up. */
export function StopAvatar({ name, category }: { name: string; category: StopCategory }) {
  const photo = usePlacePhoto(name);
  const [failed, setFailed] = useState(false);
  const Icon = CATEGORY_ICON[category ?? "other"];

  return (
    <span className="relative block h-10 w-10 shrink-0">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-tag-neutral-bg text-accent">
        <Icon className="h-4 w-4" />
      </span>
      {photo && !failed && (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary external Wikipedia thumbnails, small/lazy, not worth next/image config
        <img
          src={photo}
          alt=""
          onError={() => setFailed(true)}
          className="value-in absolute inset-0 h-10 w-10 rounded-full object-cover"
        />
      )}
    </span>
  );
}

function StopRow({
  stop,
  index,
  isLast,
  onSelect,
  revealAnimation,
  isHighlighted,
  onHover,
  leg,
  profile,
}: {
  stop: Stop;
  index: number;
  isLast: boolean;
  onSelect: (stop: Stop) => void;
  /** The real route from this stop to the next one, or null when it could not be routed.
   *  Absent entirely until the day's routes have landed. */
  leg?: RouteLeg | null;
  profile: RouteProfile;
  /** True only for rows mounted during the post-generation stagger: swaps the normal
   *  scroll-triggered entrance for a plain slide-down-into-place + typewriter on the name,
   *  since this row's mount timing (not scroll position) is already the reveal cue. */
  revealAnimation?: boolean;
  /** True while this stop's marker card on the globe is hovered or selected. Driven from the
   *  map camera context, so pointing at either surface lights up both. */
  isHighlighted?: boolean;
  onHover?: (hovered: boolean) => void;
}) {
  const motionProps = revealAnimation
    ? {
        initial: { opacity: 0, y: -12 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const },
      }
    : {
        initial: { opacity: 0, y: 24, scale: 0.98 },
        whileInView: { opacity: 1, y: 0, scale: 1 },
        viewport: { once: true, margin: "-10% 0px -10% 0px" },
        transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const, delay: index * 0.08 },
      };

  const connector = !isLast && (
    /* Spans avatar-bottom to next-avatar-top, so it has to stop short of this row's own
       height rather than exceed it: it starts at 2.75rem (top-11, a hair under the 2.5rem
       h-10 avatar) and the next avatar begins at 100% + 1rem (the parent's space-y-4), so
       the height is 100% + 1rem - 2.75rem. The old +0.5rem overshot by 2.25rem and drew
       straight through the following stop's avatar and name. Update this if the avatar
       size or the list gap changes. */
    <div className="absolute top-11 left-5 h-[calc(100%-1.75rem)] w-px bg-card-border" />
  );

  return (
    <motion.div
      {...motionProps}
      // The index this stop has in the day's own `stops` array, published to the DOM because the
      // scroll-to-active effect below can no longer count children: the list is grouped now, and
      // the group wrappers and their headings are children too.
      data-stop-index={index}
      onPointerEnter={() => onHover?.(true)}
      onPointerLeave={() => onHover?.(false)}
      className={`relative flex flex-col rounded-xl transition-colors ${
        isHighlighted ? "bg-white/10" : "hover:bg-white/5"
      }`}
    >
      {connector}
      <div className="flex gap-3">
      <button
        type="button"
        onClick={() => onSelect(stop)}
        // The globe's marker cards light their paired row on focus as well as on hover
        // (StopMarkerLayer), so the row has to light its marker from focus too or the
        // coupling only works for people using a mouse.
        onFocus={() => onHover?.(true)}
        onBlur={() => onHover?.(false)}
        className="relative z-10 flex flex-1 gap-3 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        <StopAvatar name={stop.name} category={stop.category} />
        <span className="min-w-0 flex-1">
          <div className="font-medium text-foreground">
            {revealAnimation ? <Typewriter text={stop.name} /> : stop.name}
          </div>
          {(stop.time || stop.durationLabel) && (
            <div className="text-sm text-muted">
              {[stop.time, stop.durationLabel].filter(Boolean).join(" · ")}
            </div>
          )}
          {/* Two lines, replacing the old tag chips: why this stop was chosen for this
              traveler, then the one practical thing they'd act on. Each renders only if the
              model supplied it — itineraries saved before these fields existed have neither. */}
          {stop.why && <div className="mt-1 text-sm text-foreground/80">{stop.why}</div>}
          {stop.note && <div className="mt-0.5 text-sm text-muted">{stop.note}</div>}
        </span>
      </button>
      </div>
      {leg && (
        /* Inside the row rather than between two rows, and that is load-bearing geometry rather
           than a layout preference. `connector` above is sized `100% + 1rem - 2.75rem` off the
           parent's `space-y-4`; a travel line inserted as a sibling adds a gap that arithmetic
           does not know about and the rail stops short of the next avatar — the exact bug the
           comment there records. As a child it grows `100%`, and the rail grows with it. */
        <div className="flex gap-3 pt-2">
          <span className="w-10 shrink-0" aria-hidden="true" />
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <LegIcon profile={profile} />
            <span className="tabular-nums">
              {formatDuration(leg.durationS)} {PROFILE_VERB[profile]} · {formatDistance(leg.distanceM)}
            </span>
          </span>
        </div>
      )}
    </motion.div>
  );
}

/** The mode glyph beside a travel line. Muted paper like the text it sits in — this is neither an
 *  action nor money, and those are the two things colour means in this panel. */
function LegIcon({ profile }: { profile: RouteProfile }) {
  const Icon = profile === "bike" ? Bike : profile === "drive" ? Car : Footprints;
  return <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
}

export default function StopList({
  stops,
  revealedCount,
  onSelect,
  revealAnimation,
  highlightedIndex,
  activeIndex,
  onHoverStop,
  legs,
}: {
  stops: Stop[];
  revealedCount: number;
  onSelect: (stop: Stop) => void;
  revealAnimation?: boolean;
  /** The day's real routes, index `i` being the leg from stop `i` to stop `i + 1`. Absent until
   *  they land, and absent for good if routing is unavailable — the list renders as it always did. */
  legs?: DayRoute | null;
  /** Index of the stop currently hovered or selected on the globe, or null. */
  highlightedIndex?: number | null;
  /** Index of the *selected* stop — clicked on the globe, or stepped onto by a story-mode beat. Scrolled
   *  to; see the effect below for why this is separate from `highlightedIndex`. */
  activeIndex?: number | null;
  onHoverStop?: (index: number | null) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const profile = useRouteProfile();

  /**
   * Follow the selected stop, so a camera flight and the list read as one gesture instead of two.
   *
   * Play tour, which Story mode replaced, already lit the matching row — it had called
   * `setActiveIndex` since it was written — but nothing moved the list, so on a day of eight stops
   * the camera flew to stop 6 while the panel still showed stops 1-3 and you had to scroll to find
   * out where you were. A globe click on an off-screen stop had the same problem.
   *
   * **Driven by `activeIndex`, never `highlightedIndex`.** Hover is the other half of that value,
   * and scrolling on hover would fight the person doing the scrolling: sweeping the pointer down
   * the list hovers each row it crosses, so the list would yank itself under the cursor, hover a
   * different row, and yank again.
   *
   * **Not `scrollIntoView`.** That call scrolls every scrollable ancestor, and the comment on the
   * day-tab strip in ItineraryCard records what that did here: even with `block: "nearest"` it
   * shoved the docked panel itself down ~100px. Writing `scrollTop` on the one scroller that
   * should move touches nothing else. The scroller is found by walking up rather than passed in
   * for the same reason the collapsing header does it — this list also renders on the print page,
   * where there is no scroller at all and this simply no-ops.
   *
   * **The target is re-measured every frame, not computed once.** ItineraryCard's header is
   * sticky and *shrinks* as the panel scrolls (`--hero-p`), so the row's own position is a
   * function of the scroll offset: a `scrollTo({behavior: "smooth"})` toward a target measured
   * before the jump overshoots by the whole height the header gives up on the way. Measured, that
   * put the last stop clean off the bottom of the panel — the list scrolled past the row it
   * was chasing and landed on the spend summary. Easing toward a freshly measured target each
   * frame converges regardless, and would survive any other layout shift above the row too.
   */
  useEffect(() => {
    if (activeIndex == null) return;
    // Queried, not `children[activeIndex]`. That indexed the list positionally, which held only
    // while every child was a stop; the time-of-day grouping puts a wrapper per group (and a
    // heading inside it) in the same collection, so counting would land on the wrong row — or on
    // a heading — the moment a day spans more than one part of the day.
    const row = listRef.current?.querySelector(`[data-stop-index="${activeIndex}"]`);
    if (!(row instanceof HTMLElement)) return;
    let scroller: HTMLElement | null = null;
    for (let el = row.parentElement; el; el = el.parentElement) {
      const overflowY = getComputedStyle(el).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") {
        scroller = el;
        break;
      }
    }
    if (!scroller) return;
    const target = scroller;

    /** How far the scroller is from having this row centred, right now. Measured from bounding
     *  rects rather than `offsetTop`, which is relative to the nearest *positioned* ancestor —
     *  and every row here is `relative`, so `offsetTop` reports an offset within the row itself.
     *  Same trap the day-tab strip fell into. */
    const remaining = () => {
      const rowBox = row.getBoundingClientRect();
      const scrollerBox = target.getBoundingClientRect();
      return rowBox.top - scrollerBox.top - (target.clientHeight - rowBox.height) / 2;
    };

    // The blanket reduced-motion rule in globals.css only reaches CSS transitions and
    // `scroll-behavior`; this is a `scrollTop` write loop, so it has to check for itself — the
    // same reason mapRoute's shimmer does.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      target.scrollTop += remaining();
      return;
    }

    // Exponential ease-out: a fifth of the remaining distance per frame, which is ~95% of the way
    // there in a quarter of a second. The deadline is a backstop for the one case the loop can't
    // settle on its own — the row is at the end of the list and centring it would need to scroll
    // past the bottom, so `remaining()` never reaches zero.
    const deadline = performance.now() + 700;
    let frame = 0;
    const tick = () => {
      const delta = remaining();
      if (Math.abs(delta) < 1 || performance.now() > deadline) return;
      target.scrollTop += delta * 0.2;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [activeIndex]);

  const groups = groupStopsByTimeOfDay(stops.slice(0, revealedCount));
  /**
   * A day that happens entirely in one part of the day gets no headings at all.
   *
   * One heading over the whole list separates nothing — it is a label for a distinction the list
   * does not contain, which is the same thing the day-spend band refuses when it drops a category
   * that cost nothing. Every row already carries its own clock time, so nothing is lost. The
   * headings appear exactly when there is a boundary for them to mark.
   */
  const showHeadings = groups.length > 1;

  return (
    <div ref={listRef} className="space-y-4" {...devLabel("ItineraryCard.StopList")}>
      {groups.map((group, groupIndex) => (
        <div key={`${group.label}-${groupIndex}`} className="space-y-4">
          {showHeadings && group.label && <TimeOfDayHeading label={group.label} />}
          {group.stops.map(({ stop, index }, i) => (
            <StopRow
              key={index}
              stop={stop}
              index={index}
              // Last *in its group*, not in the day. The connector is drawn from this row's avatar
              // to the next one's and is sized off the list's `space-y-4`; letting it run past the
              // final row of a group would draw a line down through the next heading, and the
              // thread breaking at the boundary is what makes the grouping read as grouping.
              isLast={i === group.stops.length - 1}
              onSelect={onSelect}
              revealAnimation={revealAnimation}
              isHighlighted={highlightedIndex === index}
              onHover={(hovered) => onHoverStop?.(hovered ? index : null)}
              // Keyed on the leg existing, NOT on `!isLast`. `isLast` is last-in-group, and the
              // walk from the last morning stop to the first afternoon one is a real walk — the
              // one a reader is most likely to be asking about, since it crosses a meal.
              // `meaningfulLeg`, not the raw leg: a stop and the bike dock outside it round to
              // "1 min walk · 0 m", which is a confident sentence about nothing.
              leg={meaningfulLeg(legs?.[index])}
              profile={profile}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * The rule between two parts of the day.
 *
 * Uppercase at the label step with a hairline running out to the right — the panel's own existing
 * idiom (the "DAY 1 OF 7" badge is uppercase and tracked in the same card), pitched down to muted
 * because this divides content rather than announcing it. It is not a kicker: nothing follows it
 * on the next line that it is labelling, it labels the group beneath it, and the rule is what
 * makes that reading unambiguous.
 *
 * `aria-hidden` on the rule only; the word itself stays in the accessibility tree, since "these
 * next three stops are the afternoon" is exactly the structure a screen reader should get.
 */
function TimeOfDayHeading({ label }: { label: TimeOfDay }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <span className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-card-border" />
    </div>
  );
}
