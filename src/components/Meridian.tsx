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
 * the next, squash on the `<svg>`, and on the eyes drift → blink → the state's resting height.
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
    boxShadow: "0 3px 6px rgba(0,0,0,0.18)",
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
      <span className={`block h-full w-full ${motion.lift ? "meri-lift" : ""}`}>
        <span className={`block h-full w-full ${motion.breatheMs ? "meri-breathe" : ""}`}>
          <svg
            viewBox="0 0 100 100"
            width={size}
            height={size}
            className={`block ${motion.squash ? "meri-squash" : ""}`}
          >
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
            <g className={`meri-eyes ${motion.driftMs ? "meri-drift" : ""}`}>
              <g className={`meri-eyes ${motion.blink ? "meri-blink" : ""}`}>
                <g className="meri-eyes" style={{ transform: `scaleY(${motion.eyes})` }}>
                  <rect x={36.25} y={40} width={7.5} height={20} rx={3.75} fill="#4A4844" />
                  <rect x={56.25} y={40} width={7.5} height={20} rx={3.75} fill="#4A4844" />
                </g>
              </g>
            </g>
          </svg>
        </span>
      </span>
    </span>
  );
}
