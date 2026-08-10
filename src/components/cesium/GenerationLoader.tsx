"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

/** Split into individual <span>s so each letter can carry its own staggered
 *  animation-delay — see the `.loader-letter:nth-child(n)` rules in globals.css,
 *  which cover exactly 10 letters. Keep this word 10 characters long, or extend
 *  those rules to match. */
const WORD = "Generating";

/** Cycled while `active` — purely decorative, no LLM call. */
const CAPTIONS = [
  "Charting the route…",
  "Scouting places to stay…",
  "Checking the weather…",
  "Plotting the best stops…",
  "Finalizing your itinerary…",
];

const CAPTION_INTERVAL_MS = 2500;

/** Generation-time "thinking" indicator — shows only while `active`, cycling
 *  through fixed captions under the loader. Floats centered over the globe. */
export default function GenerationLoader({ active }: { active: boolean }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % CAPTIONS.length), CAPTION_INTERVAL_MS);
    return () => clearInterval(id);
  }, [active]);

  if (!active) return null;
  const caption = CAPTIONS[index];

  return (
    <div className="pointer-events-none fixed left-1/2 top-1/2 z-30 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3">
      {/* aria-label carries the whole word: a screen reader walking ten
          single-letter spans would otherwise announce it letter by letter. */}
      <div className="loader-wrapper" role="status" aria-label="Generating your itinerary">
        {WORD.split("").map((letter, i) => (
          <span key={i} className="loader-letter" aria-hidden="true">
            {letter}
          </span>
        ))}
        <div className="loader" />
      </div>
      {/* Caption pill carries the same frosted treatment as the itinerary card
          and every other panel over the map — see .glass-itinerary in
          globals.css, which also sets --foreground, so text-foreground
          resolves to white here. */}
      <AnimatePresence mode="wait">
        <motion.div
          key={caption}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2 }}
          className="glass-itinerary rounded-full px-3 py-1 text-xs font-medium text-foreground"
        >
          {caption}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
