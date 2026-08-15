"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

/** Each word is split into individual <span>s so every letter can carry its own
 *  staggered animation-delay — see the `.loader-letter:nth-child(n)` rules in
 *  globals.css, which cover exactly 10 letters. **Every word here must be 10
 *  characters long**, or those rules need extending to match. The assertion below
 *  is what turns that from a comment into something that fails loudly. */
const LOADER = {
  generate: {
    word: "Generating",
    label: "Generating your itinerary",
    captions: [
      "Charting the route…",
      "Scouting places to stay…",
      "Checking the weather…",
      "Plotting the best stops…",
      "Finalizing your itinerary…",
    ],
  },
  refine: {
    word: "Rethinking",
    label: "Reworking your itinerary",
    captions: [
      "Reading your notes…",
      "Reworking the days…",
      "Rebalancing the budget…",
      "Re-checking the weather…",
      "Finalizing the changes…",
    ],
  },
} as const;

if (process.env.NODE_ENV !== "production") {
  for (const [mode, { word }] of Object.entries(LOADER)) {
    if (word.length !== 10) {
      console.error(
        `GenerationLoader: "${word}" (${mode}) is ${word.length} letters. globals.css only staggers 10.`
      );
    }
  }
}

const CAPTION_INTERVAL_MS = 2500;

/** The wait indicator for any long model call — shows only while `active`, cycling
 *  through fixed captions under the loader. Floats centered over the globe. */
export default function GenerationLoader({
  active,
  mode = "generate",
}: {
  active: boolean;
  mode?: keyof typeof LOADER;
}) {
  const [index, setIndex] = useState(0);
  const { word, label, captions } = LOADER[mode];

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % captions.length), CAPTION_INTERVAL_MS);
    return () => clearInterval(id);
  }, [active, captions.length]);

  if (!active) return null;
  const caption = captions[index % captions.length];

  return (
    // The live region is the outer box and its announced content is one real string.
    // It used to be the disc itself, whose only children are aria-hidden letters — a
    // role="status" announces content changes, and there was no content to change.
    // The captions stay hidden from it deliberately: five of them cycle past on a
    // 2.5s timer, and none says anything the label doesn't.
    <div
      role="status"
      className="pointer-events-none fixed left-1/2 top-1/2 z-30 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3"
    >
      <span className="sr-only">{label}</span>
      <div className="loader-wrapper" aria-hidden="true">
        {word.split("").map((letter, i) => (
          <span key={i} className="loader-letter">
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
          aria-hidden="true"
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
