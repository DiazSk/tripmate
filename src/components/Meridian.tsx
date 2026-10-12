"use client";

import { useId, type CSSProperties } from "react";

import { blinkCycleMs, meridianMotion, type MeridianState } from "@/lib/meri";

/**
 * Meri, the Frosted Meridian — the phone's character, drawn for the web. Spec:
 * `docs/superpowers/specs/2026-10-11-meri-web-design.md`.
 *
 * **Motion is CSS, not JavaScript.** `meridianMotion` picks classes and the keyframes in globals.css do
 * the rest, on `transform` alone, so the whole character is compositor work. Three of its four hosts sit
 * over a live map that re-blurs every glass panel each frame; a rAF loop here would add main-thread work
 * to exactly the frames that can least afford it. The keyframes only exist inside
 * `prefers-reduced-motion: no-preference`, so under `reduce` nothing moves and nothing needs an exemption
 * from the global 0.01ms rule.
 *
 * Layers nest so their transforms compose rather than overwrite: lift on the root's child, breathing on
 * the next, squash on the one after that (body and eyes together), and on the eyes drift → blink → the
 * state's resting height. **The eyes are HTML spans over the SVG body, not SVG shapes** — the phone's
 * own split — because an animation on an SVG child is never composited (WebKit gives SVG children no
 * layer of their own), and the blink runs for as long as Meri is on screen.
 *
 * Gradient ids come from `useId()` because every Meri on a page shares one document (the phone's fixed
 * ids are safe only because each native `<Svg>` keeps its own defs). The same id seeds the blink cycle,
 * so the server and the client agree on it.
 *
 * `quiet` pauses everything until an ancestor `.group` is hovered or focused — for the Refine button,
 * where a breathing Meri on every day of a trip would upstage the plan.
 */
export default function Meridian({
  state,
  size = 32,
  quiet = false,
  className = "",
}: {
  state: MeridianState;
  size?: number;
  quiet?: boolean;
  className?: string;
}) {
  const id = useId();
  const motion = meridianMotion(state, false);
  const vars = {
    width: size,
    height: size,
    "--meri-breathe": `${(motion.breatheMs ?? 0) / 2}ms`,
    "--meri-drift": `${(motion.driftMs ?? 0) / 2}ms`,
    "--meri-blink": `${blinkCycleMs(id)}ms`,
  } as CSSProperties;

  return (
    <span
      aria-hidden="true"
      data-meri={state}
      className={`relative inline-block shrink-0 rounded-full ${quiet ? "meri-quiet" : ""} ${className}`}
      style={vars}
    >
      {/* Lift and bob share the vertical; the table never sets both. */}
      <span className={`block h-full w-full ${motion.lift ? "meri-lift" : motion.bob ? "meri-bob" : ""}`}>
        {/* The shadow is on the moving body, as on the phone, so a lift carries it. Keyed on the rhythm:
            changing a running animation's duration recomputes its progress and the scale jumps, so a
            new rhythm remounts and starts from rest instead. ponytail: snaps to rest; the phone eases
            back over 220ms — needs the current scale in JS if that ever shows. */}
        <span
          key={motion.breatheMs ?? 0}
          className={`block h-full w-full rounded-full shadow-[0_3px_6px_rgba(0,0,0,0.18)] ${motion.breatheMs ? "meri-breathe" : ""}`}
        >
          {/* Keyed on the state: every entry into one replays the jelly wobble — a blob reacting —
              and restarts the eyes' one-shot squint with it. */}
          <span key={state} className="meri-wobble block h-full w-full">
            <span className={`relative block h-full w-full ${motion.squash ? "meri-squash" : ""}`}>
              <svg viewBox="0 0 100 100" width={size} height={size} className="block">
                <defs>
                  <radialGradient id={`${id}-body`} cx="42%" cy="38%" r="65%">
                    <stop offset="0" stopColor="#F4F3F0" />
                    <stop offset="1" stopColor="#CFCDC8" />
                  </radialGradient>
                  <radialGradient id={`${id}-shade`} cx="72%" cy="78%" r="55%">
                    <stop offset="0" stopColor="#B9B6B0" stopOpacity={0.35} />
                    <stop offset="1" stopColor="#B9B6B0" stopOpacity={0} />
                  </radialGradient>
                  <radialGradient id={`${id}-shine`} cx="50%" cy="50%" r="50%">
                    <stop offset="0" stopColor="#FFFFFF" stopOpacity={0.9} />
                    <stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
                  </radialGradient>
                </defs>
                <circle cx={50} cy={50} r={49} fill={`url(#${id}-body)`} />
                <circle cx={50} cy={50} r={49} fill={`url(#${id}-shade)`} />
                <ellipse cx={33} cy={27} rx={19} ry={12} fill={`url(#${id}-shine)`} />
                <circle cx={50} cy={50} r={49} fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth={2} />
              </svg>
              {/* Eyes: 13% × 17% ovals centred at 37% and 63%, each with a catchlight. They were thin
                  vertical pills, which read as ‖ — a pause button, beside the panel's real one. Each
                  wrapper is the full box, so glance, blink and resting height pivot on the eyes. */}
              <span className={`absolute inset-0 ${motion.squint ? "meri-squint-eyes" : ""}`}>
                <span className={`absolute inset-0 ${eyeTravel(motion)}`}>
                  <span className={`absolute inset-0 ${motion.blink ? "meri-blink" : ""}`}>
                    <span className="absolute inset-0" style={{ transform: `scaleY(${motion.eyes})` }}>
                      <Eye left="30.5%" />
                      <Eye left="56.5%" />
                    </span>
                  </span>
                </span>
              </span>
              {/* Success's happy ◠◠, cross-faded with the eyes. At rest it is invisible, so under
                  reduced motion (no animation at all) the open eyes are what shows. */}
              {motion.squint ? (
                <span className="meri-squint-arcs absolute inset-0 opacity-0">
                  <svg viewBox="0 0 100 100" width={size} height={size} className="block">
                    <path d="M30.5 54 Q37 34 43.5 54 M56.5 54 Q63 34 69.5 54" fill="none" stroke="#3D3B38" strokeWidth={3.5} strokeLinecap="round" />
                  </svg>
                </span>
              ) : null}
            </span>
          </span>
        </span>
      </span>
    </span>
  );
}

/** One eye: a dark oval with a white catchlight high on the outer side. */
function Eye({ left }: { left: string }) {
  return (
    <span className="absolute top-[41.5%] h-[17%] w-[13%] rounded-full bg-[#3D3B38]" style={{ left }}>
      <span className="absolute top-[16%] left-[52%] h-[26%] w-[35%] rounded-full bg-white/90" />
    </span>
  );
}

/** Drift (streaming) and glances (idle, thinking) share the eyes' wrapper; the table never sets both. */
function eyeTravel(motion: { driftMs: number | null; glance: "around" | "up" | null }): string {
  if (motion.driftMs) return "meri-drift";
  if (motion.glance === "around") return "meri-glance-around";
  if (motion.glance === "up") return "meri-glance-up";
  return "";
}
