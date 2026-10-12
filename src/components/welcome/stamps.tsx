"use client";

import { useId } from "react";
import type { Stamp } from "@/lib/travelCard";

/**
 * Rubber stamps, one shape per answered step, in the inks real entry stamps come in. Each sits inside
 * the ink filter (speckled where the stamp missed the paper, edges nudged off true) that `TravelCard`
 * declares once per card. `inkId` is that card's own filter id, so two cards on one page never
 * resolve each other's filter.
 */

// The app's faces are next/font variables; a literal family name matches nothing and silently falls back.
const FONT = { fontFamily: "var(--font-sans-stack), system-ui, sans-serif" } as const;

const T = ({ x, y, size, children, weight = 700, spacing = 0 }: { x: number; y: number; size: number; children: React.ReactNode; weight?: number; spacing?: number }) => (
  <text x={x} y={y} textAnchor="middle" style={FONT} fontSize={size} fontWeight={weight} letterSpacing={spacing}>
    {children}
  </text>
);
const asterisk = (x: number, y: number, r: number) =>
  `M${x} ${y - r}V${y + r}M${x - r * 0.87} ${y - r / 2}L${x + r * 0.87} ${y + r / 2}M${x - r * 0.87} ${y + r / 2}L${x + r * 0.87} ${y - r / 2}`;

export function StampMark({ stamp, inkId }: { stamp: Stamp; inkId: string }) {
  const inkFilter = `url(#${inkId})`;
  const id = useId();
  const { ink, label, date } = stamp;
  const words = label.split(" ");
  if (stamp.shape === "circle") {
    return (
      <svg viewBox="0 0 120 120" role="img" aria-label={label}>
        <g filter={inkFilter} stroke={ink} fill="none">
          <circle cx="60" cy="60" r="55" strokeWidth="3.2" /><circle cx="60" cy="60" r="48.5" strokeWidth="1.1" /><circle cx="60" cy="60" r="31" strokeWidth="1.1" />
          <defs>
            <path id={`${id}t`} d="M 20 60 A 40 40 0 0 1 100 60" />
            <path id={`${id}b`} d="M 23.5 60 A 36.5 36.5 0 0 0 96.5 60" />
          </defs>
          <g fill={ink} stroke="none" style={FONT} fontWeight={700}>
            <text fontSize="9" letterSpacing="2.6"><textPath href={`#${id}t`} startOffset="50%" textAnchor="middle">TRIPMATE · ADMITTED</textPath></text>
            <text fontSize="8" letterSpacing="2.2"><textPath href={`#${id}b`} startOffset="50%" textAnchor="middle">{date}</textPath></text>
            {label.length > 7 ? (
              <>
                <T x={60} y={57} size={10.5} weight={800} spacing={0.6}>{words[0]}</T>
                <T x={60} y={70} size={10.5} weight={800} spacing={0.6}>{words.slice(1).join(" ")}</T>
              </>
            ) : (
              <T x={60} y={64.5} size={13} weight={800} spacing={0.8}>{label}</T>
            )}
          </g>
          <path d={asterisk(14.5, 60, 3.4) + asterisk(105.5, 60, 3.4)} strokeWidth="1.4" strokeLinecap="round" />
        </g>
      </svg>
    );
  }
  if (stamp.shape === "rect") {
    return (
      <svg viewBox="0 0 150 84" role="img" aria-label={label}>
        <g filter={inkFilter} stroke={ink} fill="none">
          <rect x="3" y="3" width="144" height="78" rx="7" strokeWidth="3.2" /><rect x="9.5" y="9.5" width="131" height="65" rx="3" strokeWidth="1.1" />
          <path d="M22 30H128M22 61H128" strokeWidth="0.9" />
          <g fill={ink} stroke="none">
            <T x={75} y={24.5} size={7.6} spacing={2.6}>RHYTHM · ENTRY</T>
            <T x={75} y={51} size={label.length > 12 ? 15 : 17} weight={800} spacing={0.6}>{label}</T>
            <T x={75} y={71.5} size={7.2} spacing={2.4}>{date}</T>
          </g>
        </g>
      </svg>
    );
  }
  if (stamp.shape === "oval") {
    return (
      <svg viewBox="0 0 150 90" role="img" aria-label={label}>
        <g filter={inkFilter} stroke={ink} fill="none">
          <ellipse cx="75" cy="45" rx="71" ry="41" strokeWidth="3.2" /><ellipse cx="75" cy="45" rx="64" ry="34.5" strokeWidth="1.1" />
          <path d="M75 70.5c-4.5-3-8-5.6-8-9a4 4 0 018-1.4 4 4 0 018 1.4c0 3.4-3.5 6-8 9z" strokeWidth="1.3" />
          <g fill={ink} stroke="none">
            <T x={75} y={27} size={7.4} spacing={3}>LOVES</T>
            <T x={75} y={51.5} size={label.length > 14 ? 12.5 : 16} weight={800} spacing={0.6}>{label}</T>
          </g>
        </g>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 110 110" role="img" aria-label={`Departs ${label}`}>
      <g filter={inkFilter} stroke={ink} fill="none">
        <path d="M55 4L99 29.5V80.5L55 106L11 80.5V29.5Z" strokeWidth="3.2" /><path d="M55 11.5L92.5 33.2V76.8L55 98.5L17.5 76.8V33.2Z" strokeWidth="1.1" />
        <path d="M40 40.5l26 5.5M51 34l9 9.5M47 49l5 6" strokeWidth="1.6" strokeLinecap="round" />
        <g fill={ink} stroke="none">
          <T x={55} y={33} size={7} spacing={2.6}>DEPARTS</T>
          <T x={55} y={69} size={label.length > 8 ? 10.5 : 13} weight={800} spacing={0.6}>{label}</T>
          <T x={55} y={82} size={6.6} spacing={2.2}>{date}</T>
        </g>
      </g>
    </svg>
  );
}
