"use client";

import { motion, AnimatePresence } from "framer-motion";
import { ContainerTheme } from "@/lib/types";

export type ContainerState = "hidden" | "open" | "closed";

const ICON_EMOJI: Record<string, string> = {
  cherry_blossom: "🌸",
  compass: "🧭",
  eiffel_tower: "🗼",
  palm_tree: "🌴",
  maple_leaf: "🍁",
  mountain: "⛰️",
  pyramid: "🔺",
  tulip: "🌷",
  dragon: "🐉",
  coffee: "☕",
  wave: "🌊",
  anchor: "⚓",
  camel: "🐫",
  sun: "☀️",
  temple: "⛩️",
  torii_gate: "⛩️",
  pagoda: "🏯",
  castle: "🏰",
  gondola: "🛶",
  croissant: "🥐",
  lantern: "🏮",
  globe: "🌍",
};

function iconGlyph(key: string): string {
  return ICON_EMOJI[key] ?? "🌍";
}

/** Basic channel-multiply darken (negative amount lightens, clamped to
 *  0-255) — works on 3- or 6-digit hex. No color library needed for what's
 *  just "give me a two-tone shadow/accent variant of the theme color". */
function darken(hex: string, amount: number): string {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const num = parseInt(full, 16) || 0;
  const scale = 1 - amount;
  const r = Math.max(0, Math.min(255, Math.round(((num >> 16) & 255) * scale)));
  const g = Math.max(0, Math.min(255, Math.round(((num >> 8) & 255) * scale)));
  const b = Math.max(0, Math.min(255, Math.round((num & 255) * scale)));
  return `rgb(${r},${g},${b})`;
}

/** Same channel parsing as `darken`, but returns a translucent rgba() at the
 *  given alpha instead of a fully-opaque tone — accepts either a hex string
 *  or one of `darken`'s own "rgb(r,g,b)" outputs. Used for the classic box's
 *  glassmorphic look: since it floats directly over the live globe canvas
 *  with nothing else behind it, translucent fills let that motion show
 *  through for real instead of needing a fake backdrop-blur. */
function withAlpha(color: string, alpha: number): string {
  const match = color.match(/rgb\((\d+),(\d+),(\d+)\)/);
  if (match) return `rgba(${match[1]},${match[2]},${match[3]},${alpha})`;
  const clean = color.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const num = parseInt(full, 16) || 0;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

const BURST_SPIKES = [
  "14,54 0,44 20,62",
  "24,30 10,10 32,24",
  "146,54 160,44 140,62",
  "136,30 150,10 128,24",
];

function Sparkle({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <path
      d="M0 -9 L2.2 -2.2 L9 0 L2.2 2.2 L0 9 L-2.2 2.2 L-9 0 L-2.2 -2.2 Z"
      fill="#fde68a"
      stroke="#f59e0b"
      strokeWidth="1"
      transform={`translate(${x} ${y}) scale(${scale})`}
    />
  );
}

function BurstAccents({ show }: { show: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.g
          key="accents"
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.6 }}
          transition={{ duration: 0.3 }}
          style={{ transformOrigin: "85px 60px" }}
        >
          {BURST_SPIKES.map((points, i) => (
            <polygon key={points} points={points} fill={i % 2 === 0 ? "#fbbf24" : "#f59e0b"} />
          ))}
          <Sparkle x={38} y={8} scale={0.85} />
          <Sparkle x={124} y={44} scale={0.6} />
        </motion.g>
      )}
    </AnimatePresence>
  );
}

function IconBadge({
  cx,
  cy,
  r,
  icon,
  ringColor,
}: {
  cx: number;
  cy: number;
  r: number;
  icon: string;
  ringColor: string;
}) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="#fffbeb" stroke={ringColor} strokeWidth="2" />
      <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="central" fontSize={r * 1.3}>
        {icon}
      </text>
    </g>
  );
}

// Lid pivots at the top-right of the box and lifts open on the left. This is
// the literal "cardboard box" container — given a glassmorphic treatment
// (translucent frosted-glass fills + light borders + a glossy highlight
// sweep) rather than the other themes' solid paper/wood/cloth materials,
// which wouldn't suit a glass look.
const GLASS_STROKE = "rgba(255,255,255,0.55)";
const GLASS_HIGHLIGHT = "rgba(255,255,255,0.28)";

function ClassicBox({ open, theme }: { open: boolean; theme: ContainerTheme }) {
  const side = darken(theme.primaryColor, 0.3);
  const ribbon = darken(theme.primaryColor, 0.4);
  const lidTop = darken(theme.primaryColor, -0.12);
  return (
    <>
      <polygon
        points="106,58 128,48 128,124 106,134"
        fill={withAlpha(side, 0.5)}
        stroke={GLASS_STROKE}
        strokeWidth="1"
      />
      <polygon points="112,58 120,54 120,120 112,124" fill={withAlpha(ribbon, 0.55)} />
      <rect
        x="34"
        y="58"
        width="72"
        height="76"
        rx="4"
        fill={withAlpha(theme.primaryColor, 0.5)}
        stroke={GLASS_STROKE}
        strokeWidth="1.5"
      />
      <rect x="62" y="58" width="16" height="76" fill={withAlpha(ribbon, 0.6)} />
      {/* glossy diagonal highlight sweep, selling the frosted-glass look */}
      <polygon points="40,58 58,58 44,134 32,134" fill={GLASS_HIGHLIGHT} />
      <motion.g
        animate={{ rotate: open ? -35 : 0 }}
        transition={{ type: "spring", stiffness: 240, damping: 22 }}
        style={{ transformOrigin: "106px 44px" }}
      >
        <polygon
          points="106,44 122,38 122,58 106,58"
          fill={withAlpha(theme.primaryColor, 0.5)}
          stroke={GLASS_STROKE}
          strokeWidth="1"
        />
        <rect
          x="28"
          y="44"
          width="78"
          height="18"
          rx="4"
          fill={withAlpha(lidTop, 0.55)}
          stroke={GLASS_STROKE}
          strokeWidth="1.5"
        />
        <rect x="62" y="44" width="16" height="18" fill={withAlpha(ribbon, 0.65)} />
        <ellipse
          cx="58"
          cy="38"
          rx="16"
          ry="11"
          fill={withAlpha(ribbon, 0.7)}
          stroke={side}
          strokeWidth="1.5"
          transform="rotate(-25 58 38)"
        />
        <ellipse
          cx="82"
          cy="38"
          rx="16"
          ry="11"
          fill={withAlpha(ribbon, 0.7)}
          stroke={side}
          strokeWidth="1.5"
          transform="rotate(25 82 38)"
        />
        <IconBadge cx={70} cy={40} r={9} icon={iconGlyph(theme.stampOrIcon)} ringColor={side} />
      </motion.g>
    </>
  );
}

// Flap hinged at the top edge, flips up and back to open — like lifting a
// letter's flap rather than sliding or tilting in 3D.
function VintageEnvelope({ open, theme }: { open: boolean; theme: ContainerTheme }) {
  const body = "#f3e6c8";
  const flap = darken(body, 0.08);
  const stripeCount = 14;
  return (
    <>
      <rect x="25" y="58" width="120" height="76" rx="3" fill={body} stroke={theme.primaryColor} strokeWidth="2" />
      <path d="M27 60 L85 100 L143 60" fill="none" stroke={darken(body, 0.15)} strokeWidth="1.5" />
      {Array.from({ length: stripeCount }, (_, i) => (
        <rect
          key={i}
          x={25 + i * (120 / stripeCount)}
          y={58}
          width={120 / stripeCount / 2}
          height={4}
          fill={i % 2 === 0 ? theme.primaryColor : body}
        />
      ))}
      <rect x="114" y="64" width="24" height="28" fill="#fff" stroke={theme.primaryColor} strokeWidth="1.5" strokeDasharray="3 2" />
      <text x="126" y="79" textAnchor="middle" dominantBaseline="central" fontSize="14">
        {iconGlyph(theme.stampOrIcon)}
      </text>
      <motion.g
        animate={{ rotate: open ? -170 : 0 }}
        transition={{ type: "spring", stiffness: 200, damping: 24 }}
        style={{ transformOrigin: "85px 58px" }}
      >
        <polygon points="25,58 145,58 85,98" fill={flap} stroke={theme.primaryColor} strokeWidth="2" />
      </motion.g>
    </>
  );
}

// Lid hinged at the back (visually: its top edge), lifts up like a chest.
function TravelTrunk({ open, theme }: { open: boolean; theme: ContainerTheme }) {
  const side = darken(theme.primaryColor, 0.3);
  const strap = darken(theme.primaryColor, 0.45);
  const brass = "#c9a227";
  return (
    <>
      <polygon points="132,70 142,64 142,124 132,130" fill={side} />
      <rect x="32" y="70" width="100" height="60" rx="6" fill={theme.primaryColor} />
      <rect x="32" y="86" width="100" height="6" fill={strap} />
      <rect x="32" y="106" width="100" height="6" fill={strap} />
      {[50, 82, 114].map((x) => (
        <g key={x}>
          <rect x={x - 6} y="122" width="12" height="14" rx="2" fill={brass} stroke="#92710f" strokeWidth="1" />
          <circle cx={x} cy="129" r="1.6" fill="#4a3a08" />
        </g>
      ))}
      <motion.g
        animate={{ rotate: open ? -100 : 0 }}
        transition={{ type: "spring", stiffness: 220, damping: 24 }}
        style={{ transformOrigin: "85px 70px" }}
      >
        <polygon points="132,52 142,46 142,64 132,70" fill={side} />
        <rect x="32" y="52" width="100" height="18" rx="6" fill={theme.primaryColor} />
        <IconBadge cx={82} cy={61} r={8} icon={iconGlyph(theme.stampOrIcon)} ringColor={strap} />
      </motion.g>
    </>
  );
}

// No hinge here — "opening" means untying: the knot shrinks/rotates/fades
// and the top two cloth corners peel outward, rather than anything lifting.
function FuroshikiWrap({ open, theme }: { open: boolean; theme: ContainerTheme }) {
  const cloth = theme.primaryColor;
  const clothDark = darken(theme.primaryColor, 0.18);
  const knot = darken(theme.primaryColor, 0.28);
  return (
    <>
      <rect x="35" y="62" width="100" height="66" rx="18" fill={cloth} />
      <polygon points="45,128 25,140 55,132" fill={clothDark} />
      <polygon points="125,128 145,140 115,132" fill={clothDark} />
      <motion.polygon
        points="45,62 25,42 60,58"
        fill={clothDark}
        animate={open ? { rotate: -35, y: -8 } : { rotate: 6, y: 0 }}
        transition={{ type: "spring", stiffness: 200, damping: 22 }}
        style={{ transformOrigin: "45px 62px" }}
      />
      <motion.polygon
        points="125,62 145,42 110,58"
        fill={clothDark}
        animate={open ? { rotate: 35, y: -8 } : { rotate: -6, y: 0 }}
        transition={{ type: "spring", stiffness: 200, damping: 22 }}
        style={{ transformOrigin: "125px 62px" }}
      />
      <IconBadge cx={85} cy={97} r={9} icon={iconGlyph(theme.stampOrIcon)} ringColor={clothDark} />
      <motion.g
        animate={
          open ? { scale: 0.35, rotate: 35, opacity: 0.15 } : { scale: 1, rotate: 0, opacity: 1 }
        }
        transition={{ type: "spring", stiffness: 200, damping: 20 }}
        style={{ transformOrigin: "85px 55px" }}
      >
        <ellipse cx="70" cy="52" rx="15" ry="10" fill={knot} stroke={clothDark} strokeWidth="1.5" transform="rotate(-20 70 52)" />
        <ellipse cx="100" cy="52" rx="15" ry="10" fill={knot} stroke={clothDark} strokeWidth="1.5" transform="rotate(20 100 52)" />
        <circle cx="85" cy="54" r="7" fill={clothDark} />
      </motion.g>
    </>
  );
}

export default function UnboxingContainer({
  state,
  theme,
}: {
  state: ContainerState;
  theme: ContainerTheme;
}) {
  if (state === "hidden") return null;
  const open = state === "open";

  return (
    <div className="pointer-events-none fixed left-1/2 top-1/2 z-30 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3">
      <svg width="170" height="150" viewBox="0 0 170 150" fill="none">
        <ellipse cx="85" cy="139" rx="42" ry="7" fill="#000" opacity="0.22" />
        <BurstAccents show={open} />
        {theme.containerType === "vintage_envelope" && <VintageEnvelope open={open} theme={theme} />}
        {theme.containerType === "furoshiki_wrap" && <FuroshikiWrap open={open} theme={theme} />}
        {theme.containerType === "travel_trunk" && <TravelTrunk open={open} theme={theme} />}
        {theme.containerType === "classic_box" && <ClassicBox open={open} theme={theme} />}
      </svg>
      <motion.div
        key={theme.themeTitle}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-panel rounded-full px-3 py-1 text-xs font-medium text-white"
      >
        {theme.themeTitle}
      </motion.div>
    </div>
  );
}
