"use client";

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

function CategoryTile({ category }: { category: StopCategory }) {
  const Icon = CATEGORY_ICON[category ?? "other"];
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-tag-neutral-bg text-accent">
      <Icon className="h-4 w-4" />
    </div>
  );
}

function StopAvatar({ name, category }: { name: string; category: StopCategory }) {
  const photo = usePlacePhoto(name);
  if (photo) {
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary external Wikipedia thumbnails, small/lazy, not worth next/image config
    return <img src={photo} alt="" className="h-10 w-10 rounded-full object-cover" />;
  }
  return <CategoryTile category={category} />;
}

function StopRow({
  stop,
  index,
  isLast,
  onSelect,
  revealAnimation,
}: {
  stop: Stop;
  index: number;
  isLast: boolean;
  onSelect: (stop: Stop) => void;
  /** True only for rows mounted during the post-generation stagger: swaps the normal
   *  scroll-triggered entrance for a plain slide-down-into-place + typewriter on the name,
   *  since this row's mount timing (not scroll position) is already the reveal cue. */
  revealAnimation?: boolean;
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
      className="relative flex gap-3 rounded-xl transition-colors hover:bg-white/5"
    >
      {connector}
      <button
        type="button"
        onClick={() => onSelect(stop)}
        className="relative z-10 flex flex-1 gap-3 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        <span className="shrink-0">
          <StopAvatar name={stop.name} category={stop.category} />
        </span>
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
}: {
  stops: Stop[];
  revealedCount: number;
  onSelect: (stop: Stop) => void;
  revealAnimation?: boolean;
}) {
  return (
    <div className="space-y-4" {...devLabel("ItineraryCard.StopList")}>
      {stops.slice(0, revealedCount).map((stop, i, visible) => (
        <StopRow
          key={i}
          stop={stop}
          index={i}
          isLast={i === visible.length - 1}
          onSelect={onSelect}
          revealAnimation={revealAnimation}
        />
      ))}
    </div>
  );
}
