"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

// Solid fills, not translucent — this is a small loader icon over a moving,
// unpredictable map backdrop, so it needs to hold contrast on its own rather
// than showing the globe through it (unlike the itinerary panel's glass).
const ACCENT = "#1f3a34"; // --accent
const GLOW = "#06b6d4"; // cyan, matches the itinerary timeline's node glow
const INK = "#f5f1e8"; // --accent-foreground (cream) — icon linework

function CompassScene() {
  return (
    <motion.g
      animate={{ rotate: 360 }}
      transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
      style={{ transformOrigin: "20px 20px" }}
    >
      <circle cx="20" cy="20" r="13" fill="none" stroke={INK} strokeWidth="1.5" />
      <path d="M20 10 L24 20 L20 30 L16 20 Z" fill={GLOW} />
    </motion.g>
  );
}

function LodgingScene() {
  return (
    <motion.g
      animate={{ scale: [1, 1.06, 1] }}
      transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
      style={{ transformOrigin: "20px 20px" }}
    >
      <path
        d="M20 9 L32 19 M20 9 L8 19"
        stroke={INK}
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
      <rect x="11" y="18" width="18" height="12" rx="1.5" fill="none" stroke={INK} strokeWidth="1.6" />
      <rect x="17" y="22" width="6" height="8" fill={GLOW} />
    </motion.g>
  );
}

function WeatherScene() {
  return (
    <motion.g
      animate={{ rotate: 360 }}
      transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
      style={{ transformOrigin: "20px 20px" }}
    >
      <circle cx="20" cy="20" r="7" fill={GLOW} />
      {Array.from({ length: 8 }, (_, i) => {
        const angle = (i * Math.PI) / 4;
        const x1 = 20 + Math.cos(angle) * 11;
        const y1 = 20 + Math.sin(angle) * 11;
        const x2 = 20 + Math.cos(angle) * 16;
        const y2 = 20 + Math.sin(angle) * 16;
        return (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
        );
      })}
    </motion.g>
  );
}

function PinScene() {
  return (
    <motion.g
      animate={{ y: [0, -6, 0] }}
      transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
    >
      <path
        d="M20 10 a8 8 0 0 1 8 8 c0 6-8 14-8 14 s-8-8-8-14 a8 8 0 0 1 8-8 Z"
        fill={GLOW}
      />
      <circle cx="20" cy="18" r="3" fill={INK} />
    </motion.g>
  );
}

const SPARKLE_PATH = "M0 -6 L1.5 -1.5 L6 0 L1.5 1.5 L0 6 L-1.5 1.5 L-6 0 L-1.5 -1.5 Z";
const SPARKLES = [
  { x: 14, y: 14, scale: 1, delay: 0 },
  { x: 27, y: 15, scale: 0.7, delay: 0.2 },
  { x: 20, y: 27, scale: 0.85, delay: 0.4 },
];

function SparkleScene() {
  return (
    <>
      {SPARKLES.map((s, i) => (
        <motion.path
          key={i}
          d={SPARKLE_PATH}
          fill={GLOW}
          transform={`translate(${s.x} ${s.y}) scale(${s.scale})`}
          animate={{ opacity: [0.3, 1, 0.3], scale: [s.scale * 0.7, s.scale, s.scale * 0.7] }}
          transition={{ duration: 1.4, repeat: Infinity, delay: s.delay, ease: "easeInOut" }}
        />
      ))}
    </>
  );
}

/** Cycled while `active` — purely decorative, no LLM call. Each step pairs a
 *  caption with its own distinct drawn icon + motion rather than reusing one
 *  shape with a swapped glyph. */
const STEPS = [
  { caption: "Charting the route…", Scene: CompassScene },
  { caption: "Scouting places to stay…", Scene: LodgingScene },
  { caption: "Checking the weather…", Scene: WeatherScene },
  { caption: "Plotting the best stops…", Scene: PinScene },
  { caption: "Finalizing your itinerary…", Scene: SparkleScene },
];

const STEP_INTERVAL_MS = 2500;

/** Generation-time "thinking" indicator — shows only while `active`, cycling
 *  through fixed steps. Floats centered over the globe. */
export default function GenerationLoader({ active }: { active: boolean }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % STEPS.length), STEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [active]);

  if (!active) return null;
  const { caption, Scene } = STEPS[index];

  return (
    <div className="pointer-events-none fixed left-1/2 top-1/2 z-30 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3">
      <div
        className="flex h-20 w-20 items-center justify-center rounded-full"
        style={{
          background: ACCENT,
          boxShadow: `0 0 0 2px ${GLOW}, 0 0 18px rgba(6,182,212,0.55), 0 8px 24px rgba(0,0,0,0.35)`,
        }}
      >
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
          <Scene />
        </svg>
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={caption}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2 }}
          className="rounded-full bg-slate-950/90 px-3 py-1 text-xs font-medium text-white"
        >
          {caption}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
