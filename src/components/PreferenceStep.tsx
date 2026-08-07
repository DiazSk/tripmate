"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ItineraryPreferences } from "@/lib/types";

// Speed/pop accent lines radiating outward from the card as it collapses —
// purely decorative, so they live outside the card's own overflow-hidden
// bounds rather than inside it.
const ACTION_LINE_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

function ActionLines({ show }: { show: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="pointer-events-none absolute inset-0 z-20"
          initial={{ y: 0 }}
          animate={{ y: 260 }}
          transition={{ type: "spring", stiffness: 190, damping: 22 }}
        >
          {ACTION_LINE_ANGLES.map((angle, i) => (
            <div
              key={angle}
              className="absolute left-1/2 top-1/2 h-0 w-0"
              style={{ transform: `rotate(${angle}deg)` }}
            >
              <motion.div
                className="absolute left-0 top-1/2 h-[3px] w-16 -translate-y-1/2 rounded-full bg-gradient-to-r from-amber-300 to-transparent"
                style={{ transformOrigin: "0% 50%" }}
                initial={{ scaleX: 0.2, opacity: 0, x: 24 }}
                animate={{ scaleX: 1, opacity: [0, 1, 0], x: 70 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.55, delay: i * 0.02, ease: "easeOut" }}
              />
            </div>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const TRENDING_TAGS = [
  { label: "Food & nightlife", emoji: "🍸" },
  { label: "Museums & history", emoji: "🏛️" },
  { label: "Outdoors & hiking", emoji: "🥾" },
  { label: "Shopping", emoji: "🛍️" },
  { label: "Hidden gems", emoji: "💎" },
  { label: "Family-friendly", emoji: "👨‍👩‍👧" },
  { label: "Photogenic spots", emoji: "📸" },
  { label: "Budget eats", emoji: "🔥" },
];

const VIBES = [
  "Party",
  "Nature",
  "Relax",
  "Culture",
  "Adventure",
  "Foodie",
  "Romantic",
  "Family",
];

function Chip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
        selected
          ? "border-orange-500 bg-orange-600 text-white"
          : "border-white/30 text-white/80 hover:bg-white/10"
      }`}
    >
      {label}
    </button>
  );
}

export default function PreferenceStep({
  onContinue,
  onSkip,
  onBack,
}: {
  onContinue: (preferences: ItineraryPreferences) => void;
  onSkip: () => void;
  onBack: () => void;
}) {
  const [tags, setTags] = useState<string[]>([]);
  const [vibe, setVibe] = useState<string | null>(null);
  const [imploding, setImploding] = useState(false);

  function toggleTag(tag: string) {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  // Whole card "swallowed" by the gift box below it: shrinks to a bubble and
  // drops down, then (after the animation has had time to read) the parent's
  // onContinue/onSkip actually fires.
  function submit(action: () => void) {
    setImploding(true);
    setTimeout(action, 500);
  }

  return (
    <div className="relative w-full max-w-md">
      <ActionLines show={imploding} />
      <motion.div
        animate={
          imploding
            ? { scale: 0, borderRadius: 999, y: 260, opacity: 0 }
            : { scale: 1, borderRadius: 24, y: 0, opacity: 1 }
        }
        transition={{ type: "spring", stiffness: 190, damping: 22 }}
        className="glass-panel w-full overflow-hidden p-6 text-white"
        style={{ borderRadius: 24 }}
      >
        <h2 className="text-lg font-semibold text-white">Make it yours</h2>
        <p className="mt-1 text-sm text-white/70">
          Pick what you&apos;re into, or skip and we&apos;ll keep it general.
        </p>

        <div className="mt-5">
          <div className="mb-2 text-sm font-medium text-white/80">Trending now</div>
          <div className="flex flex-wrap gap-2">
            {TRENDING_TAGS.map((tag, i) => (
              <motion.div
                key={tag.label}
                initial={{ opacity: 0, scale: 0.3, y: 40 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 260, damping: 22, delay: i * 0.05 }}
              >
                <Chip
                  label={`${tag.emoji} ${tag.label}`}
                  selected={tags.includes(tag.label)}
                  onClick={() => toggleTag(tag.label)}
                />
              </motion.div>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-2 text-sm font-medium text-white/80">Vibe mode</div>
          <div className="flex flex-wrap gap-2">
            {VIBES.map((v, i) => (
              <motion.div
                key={v}
                initial={{ opacity: 0, scale: 0.3, y: 40 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 260, damping: 22, delay: 0.2 + i * 0.05 }}
              >
                <Chip label={v} selected={vibe === v} onClick={() => setVibe(vibe === v ? null : v)} />
              </motion.div>
            ))}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onBack}
            disabled={imploding}
            className="rounded-lg px-3 py-2 text-sm text-white/70 transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            ← Back to search
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => submit(onSkip)}
              disabled={imploding}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={() => submit(() => onContinue({ tags, vibe }))}
              disabled={imploding}
              className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {imploding ? "Sealing it up…" : "Generate itinerary"}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
