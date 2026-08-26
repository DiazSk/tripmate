"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

import { Stop, StopCategory } from "@/lib/types";
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
 *  moment its Wikipedia lookup happened to land. */
function StopAvatar({ name, category }: { name: string; category: StopCategory }) {
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
}: {
  stop: Stop;
  index: number;
  isLast: boolean;
  onSelect: (stop: Stop) => void;
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
      onPointerEnter={() => onHover?.(true)}
      onPointerLeave={() => onHover?.(false)}
      className={`relative flex gap-3 rounded-xl transition-colors ${
        isHighlighted ? "bg-white/10" : "hover:bg-white/5"
      }`}
    >
      {connector}
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
    </motion.div>
  );
}

export default function StopList({
  stops,
  revealedCount,
  onSelect,
  revealAnimation,
  highlightedIndex,
  activeIndex,
  onHoverStop,
}: {
  stops: Stop[];
  revealedCount: number;
  onSelect: (stop: Stop) => void;
  revealAnimation?: boolean;
  /** Index of the stop currently hovered or selected on the globe, or null. */
  highlightedIndex?: number | null;
  /** Index of the *selected* stop — clicked on the globe, or stepped onto by Play tour. Scrolled
   *  to; see the effect below for why this is separate from `highlightedIndex`. */
  activeIndex?: number | null;
  onHoverStop?: (index: number | null) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  /**
   * Follow the selected stop, so Play tour reads as one gesture instead of two.
   *
   * The tour already lit the matching row — it has called `setActiveIndex` since it was written —
   * but nothing moved the list, so on a day of eight stops the camera flew to stop 6 while the
   * panel still showed stops 1-3 and you had to scroll to find out where you were. A globe click
   * on an off-screen stop had the same problem.
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
   * put the tour's last stop clean off the bottom of the panel — the list scrolled past the row it
   * was chasing and landed on the spend summary. Easing toward a freshly measured target each
   * frame converges regardless, and would survive any other layout shift above the row too.
   */
  useEffect(() => {
    if (activeIndex == null) return;
    const row = listRef.current?.children[activeIndex];
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

  return (
    <div ref={listRef} className="space-y-4" {...devLabel("ItineraryCard.StopList")}>
      {stops.slice(0, revealedCount).map((stop, i, visible) => (
        <StopRow
          key={i}
          stop={stop}
          index={i}
          isLast={i === visible.length - 1}
          onSelect={onSelect}
          revealAnimation={revealAnimation}
          isHighlighted={highlightedIndex === i}
          onHover={(hovered) => onHoverStop?.(hovered ? i : null)}
        />
      ))}
    </div>
  );
}
