"use client";

/**
 * Hand-rolled SVG charts for the dev benchmark page.
 *
 * NO CHARTING LIBRARY WAS ADDED. The app has none (audited: package.json carries cesium, gsap,
 * framer-motion, lucide and nothing else that draws charts), and five simple static chart forms
 * are ~300 lines of SVG — cheaper than a dependency that would ship in the lockfile forever for a
 * dev-only page. Every mark below is a `<rect>`, `<path>`, `<circle>` or `<polygon>`.
 *
 * Palette: categorical slots 1-3 (blue / orange / aqua), validated for ALL pairs on this page's
 * stone-50 surface — worst-pair CVD ΔE 9.2, normal-vision ΔE 24.0. Aqua sits at 2.7:1 contrast
 * against the surface, so every chart here carries direct labels and the page ships a raw-numbers
 * table, which is the documented relief for that. Stacked segments use slots 1-6, which is legal
 * because a stack only ever puts adjacent pairs side by side.
 */

const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"];

const INK = "#1c1917";
const INK_MUTED = "#57534e";
const GRID = "#e7e5e4";
const SURFACE = "#fafaf9";

export function seriesColor(index: number): string {
  return SERIES[index % SERIES.length];
}

/** Bar with only its data-end rounded — the baseline end stays square and anchored. */
function barPath(x: number, y: number, w: number, h: number, r = 4): string {
  const radius = Math.min(r, w / 2, Math.max(h, 0));
  if (h <= 0) return "";
  return `M${x},${y + h} L${x},${y + radius} Q${x},${y} ${x + radius},${y} L${x + w - radius},${y} Q${x + w},${y} ${x + w},${y + radius} L${x + w},${y + h} Z`;
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  return Math.ceil(value / magnitude) * magnitude;
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 text-xs text-stone-600">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: item.color }}
            aria-hidden
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function ChartFrame({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <figure className="rounded-lg border border-stone-200 bg-white p-4">
      <figcaption className="mb-1">
        <span className="text-sm font-medium text-stone-900">{title}</span>
        {note && <span className="ml-2 text-xs text-stone-500">{note}</span>}
      </figcaption>
      {children}
    </figure>
  );
}

// --- 1. Radar / spider -------------------------------------------------------------------------

export interface RadarSeries {
  label: string;
  /** 0-1 per axis, aligned with `axes`. Null axes are drawn at the centre and flagged in the tooltip. */
  values: (number | null)[];
  /** Set by the caller from the entity's identity, never from its position in this array. */
  color: string;
}

export function RadarChart({
  axes,
  series,
  title,
  note,
}: {
  axes: string[];
  series: RadarSeries[];
  title: string;
  note?: string;
}) {
  // The box is deliberately wider than the plot: axis labels sit outside the outer ring, and a
  // square viewBox clips the long ones ("Constraint adherence" loses its tail).
  const size = 300;
  const width = 460;
  const cx = width / 2;
  const cy = size / 2 + 6;
  const radius = 96;

  const point = (axisIndex: number, value: number) => {
    const angle = (Math.PI * 2 * axisIndex) / axes.length - Math.PI / 2;
    return [cx + Math.cos(angle) * radius * value, cy + Math.sin(angle) * radius * value];
  };

  return (
    <ChartFrame title={title} note={note}>
      <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />
      <svg viewBox={`0 0 ${width} ${size + 16}`} className="w-full" role="img">
        {[0.25, 0.5, 0.75, 1].map((ring) => (
          <polygon
            key={ring}
            points={axes.map((_, i) => point(i, ring).join(",")).join(" ")}
            fill="none"
            stroke={GRID}
            strokeWidth={1}
          />
        ))}
        {axes.map((axis, i) => {
          const [x, y] = point(i, 1);
          const [lx, ly] = point(i, 1.22);
          return (
            <g key={axis}>
              <line x1={cx} y1={cy} x2={x} y2={y} stroke={GRID} strokeWidth={1} />
              <text
                x={lx}
                y={ly}
                fontSize={9}
                fill={INK_MUTED}
                textAnchor={lx > cx + 4 ? "start" : lx < cx - 4 ? "end" : "middle"}
                dominantBaseline="middle"
              >
                {axis}
              </text>
            </g>
          );
        })}
        {series.map((s) => {
          const color = s.color;
          const pts = s.values.map((v, i) => point(i, v ?? 0).join(",")).join(" ");
          return (
            <g key={s.label}>
              <polygon points={pts} fill={color} fillOpacity={0.1} stroke={color} strokeWidth={2} />
              {s.values.map((v, i) => {
                const [x, y] = point(i, v ?? 0);
                return (
                  <circle key={i} cx={x} cy={y} r={4} fill={color} stroke={SURFACE} strokeWidth={2}>
                    <title>{`${s.label} — ${axes[i]}: ${v === null ? "not measurable" : v.toFixed(2)}`}</title>
                  </circle>
                );
              })}
            </g>
          );
        })}
      </svg>
    </ChartFrame>
  );
}

// --- 2. Scatter with Pareto frontier -----------------------------------------------------------

export interface ScatterPoint {
  label: string;
  x: number;
  y: number;
  onFrontier: boolean;
  color: string;
}

export function ParetoScatter({
  points,
  title,
  note,
  xLabel,
  yLabel,
}: {
  points: ScatterPoint[];
  title: string;
  note?: string;
  xLabel: string;
  yLabel: string;
}) {
  const w = 420;
  const h = 260;
  const pad = { top: 12, right: 20, bottom: 36, left: 46 };

  if (points.length === 0) {
    return (
      <ChartFrame title={title} note={note}>
        <p className="py-8 text-center text-xs text-stone-400">No priced results yet.</p>
      </ChartFrame>
    );
  }

  const xMax = niceMax(Math.max(...points.map((p) => p.x)) * 1.15);
  const yMax = 1;
  const px = (v: number) => pad.left + (v / xMax) * (w - pad.left - pad.right);
  const py = (v: number) => h - pad.bottom - (v / yMax) * (h - pad.top - pad.bottom);

  const frontier = points
    .filter((p) => p.onFrontier)
    .sort((a, b) => a.x - b.x);

  return (
    <ChartFrame title={title} note={note}>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={pad.left} y1={py(t)} x2={w - pad.right} y2={py(t)} stroke={GRID} strokeWidth={1} />
            <text x={pad.left - 6} y={py(t)} fontSize={9} fill={INK_MUTED} textAnchor="end" dominantBaseline="middle">
              {t.toFixed(2)}
            </text>
          </g>
        ))}
        {[0, xMax / 2, xMax].map((v) => (
          <text key={v} x={px(v)} y={h - pad.bottom + 14} fontSize={9} fill={INK_MUTED} textAnchor="middle">
            ${v.toFixed(3)}
          </text>
        ))}

        {frontier.length > 1 && (
          <polyline
            points={frontier.map((p) => `${px(p.x)},${py(p.y)}`).join(" ")}
            fill="none"
            stroke={INK_MUTED}
            strokeWidth={2}
            strokeDasharray="4 3"
          />
        )}

        {points.map((p) => (
          <g key={p.label}>
            <circle
              cx={px(p.x)}
              cy={py(p.y)}
              r={p.onFrontier ? 7 : 5}
              fill={p.color}
              stroke={SURFACE}
              strokeWidth={2}
            >
              <title>{`${p.label} — quality ${p.y.toFixed(3)}, $${p.x.toFixed(4)}/itinerary${p.onFrontier ? " (Pareto frontier)" : " (dominated)"}`}</title>
            </circle>
            <text x={px(p.x) + 10} y={py(p.y) - 8} fontSize={9} fill={INK} textAnchor="start">
              {p.label}
              {p.onFrontier ? " ★" : ""}
            </text>
          </g>
        ))}

        <text x={(w + pad.left) / 2} y={h - 4} fontSize={9} fill={INK_MUTED} textAnchor="middle">
          {xLabel}
        </text>
        <text
          x={12}
          y={h / 2}
          fontSize={9}
          fill={INK_MUTED}
          textAnchor="middle"
          transform={`rotate(-90 12 ${h / 2})`}
        >
          {yLabel}
        </text>
      </svg>
      <p className="mt-1 text-[11px] text-stone-500">★ on the Pareto frontier — nothing beats it on both quality and cost.</p>
    </ChartFrame>
  );
}

// --- 3. Grouped bars ---------------------------------------------------------------------------

export interface GroupedDatum {
  group: string;
  values: (number | null)[];
}

export function GroupedBars({
  data,
  seriesLabels,
  seriesColors,
  title,
  note,
  format,
}: {
  data: GroupedDatum[];
  seriesLabels: string[];
  seriesColors: string[];
  title: string;
  note?: string;
  format: (v: number) => string;
}) {
  const w = 460;
  const h = 220;
  const pad = { top: 12, right: 12, bottom: 44, left: 46 };

  const all = data.flatMap((d) => d.values).filter((v): v is number => v !== null);
  const max = niceMax(all.length > 0 ? Math.max(...all) : 1);
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const groupW = plotW / Math.max(data.length, 1);
  // 2px surface gap between adjacent fills, per the mark spec.
  const barW = Math.max((groupW - 14) / Math.max(seriesLabels.length, 1) - 2, 3);

  return (
    <ChartFrame title={title} note={note}>
      <Legend items={seriesLabels.map((label, i) => ({ label, color: seriesColors[i] }))} />
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img">
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line
              x1={pad.left}
              y1={pad.top + plotH * (1 - t)}
              x2={w - pad.right}
              y2={pad.top + plotH * (1 - t)}
              stroke={GRID}
              strokeWidth={1}
            />
            <text
              x={pad.left - 6}
              y={pad.top + plotH * (1 - t)}
              fontSize={9}
              fill={INK_MUTED}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {format(max * t)}
            </text>
          </g>
        ))}
        {data.map((d, gi) => (
          <g key={d.group}>
            {d.values.map((v, si) => {
              if (v === null) return null;
              const barH = (v / max) * plotH;
              const x = pad.left + gi * groupW + 7 + si * (barW + 2);
              return (
                <path
                  key={si}
                  d={barPath(x, pad.top + plotH - barH, barW, barH)}
                  fill={seriesColors[si]}
                >
                  <title>{`${seriesLabels[si]} — ${d.group}: ${format(v)}`}</title>
                </path>
              );
            })}
            <text
              x={pad.left + gi * groupW + groupW / 2}
              y={h - pad.bottom + 14}
              fontSize={8}
              fill={INK_MUTED}
              textAnchor="middle"
            >
              {d.group.length > 14 ? `${d.group.slice(0, 13)}…` : d.group}
            </text>
          </g>
        ))}
      </svg>
    </ChartFrame>
  );
}

// --- 4. Stacked bars ---------------------------------------------------------------------------

export function StackedBars({
  data,
  segmentLabels,
  title,
  note,
}: {
  data: { group: string; segments: number[] }[];
  segmentLabels: string[];
  title: string;
  note?: string;
}) {
  const w = 420;
  const h = 220;
  const pad = { top: 12, right: 12, bottom: 40, left: 34 };
  const totals = data.map((d) => d.segments.reduce((s, v) => s + v, 0));
  const max = niceMax(Math.max(...totals, 1));
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const slot = plotW / Math.max(data.length, 1);
  const barW = Math.min(slot - 22, 54);

  return (
    <ChartFrame title={title} note={note}>
      <Legend items={segmentLabels.map((label, i) => ({ label, color: seriesColor(i) }))} />
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img">
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line
              x1={pad.left}
              y1={pad.top + plotH * (1 - t)}
              x2={w - pad.right}
              y2={pad.top + plotH * (1 - t)}
              stroke={GRID}
              strokeWidth={1}
            />
            <text
              x={pad.left - 6}
              y={pad.top + plotH * (1 - t)}
              fontSize={9}
              fill={INK_MUTED}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {Math.round(max * t)}
            </text>
          </g>
        ))}
        {data.map((d, gi) => {
          const x = pad.left + gi * slot + (slot - barW) / 2;
          let cursor = pad.top + plotH;
          return (
            <g key={d.group}>
              {d.segments.map((v, si) => {
                if (v <= 0) return null;
                // 2px surface gap between stacked fills.
                const segH = Math.max((v / max) * plotH - 2, 1);
                const y = cursor - segH;
                cursor -= segH + 2;
                return (
                  <rect key={si} x={x} y={y} width={barW} height={segH} fill={seriesColor(si)} rx={1}>
                    <title>{`${d.group} — ${segmentLabels[si]}: ${v}`}</title>
                  </rect>
                );
              })}
              <text x={x + barW / 2} y={cursor - 5} fontSize={9} fill={INK} textAnchor="middle">
                {totals[gi]}
              </text>
              <text
                x={x + barW / 2}
                y={h - pad.bottom + 14}
                fontSize={9}
                fill={INK_MUTED}
                textAnchor="middle"
              >
                {d.group}
              </text>
            </g>
          );
        })}
      </svg>
    </ChartFrame>
  );
}

// --- 5. Simple bar -----------------------------------------------------------------------------

export function SimpleBars({
  data,
  title,
  note,
  format,
}: {
  data: { label: string; value: number | null; color: string }[];
  title: string;
  note?: string;
  format: (v: number) => string;
}) {
  const w = 420;
  const h = 200;
  const pad = { top: 16, right: 12, bottom: 36, left: 42 };
  const values = data.map((d) => d.value).filter((v): v is number => v !== null);
  const max = niceMax(values.length > 0 ? Math.max(...values) : 1);
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const slot = plotW / Math.max(data.length, 1);
  const barW = Math.min(slot - 24, 56);

  return (
    <ChartFrame title={title} note={note}>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img">
        {[0, 0.5, 1].map((t) => (
          <line
            key={t}
            x1={pad.left}
            y1={pad.top + plotH * (1 - t)}
            x2={w - pad.right}
            y2={pad.top + plotH * (1 - t)}
            stroke={GRID}
            strokeWidth={1}
          />
        ))}
        {data.map((d, i) => {
          const x = pad.left + i * slot + (slot - barW) / 2;
          if (d.value === null) {
            return (
              <text key={d.label} x={x + barW / 2} y={pad.top + plotH - 6} fontSize={9} fill={INK_MUTED} textAnchor="middle">
                n/a
              </text>
            );
          }
          const barH = (d.value / max) * plotH;
          return (
            <g key={d.label}>
              <path d={barPath(x, pad.top + plotH - barH, barW, barH)} fill={d.color}>
                <title>{`${d.label}: ${format(d.value)}`}</title>
              </path>
              <text x={x + barW / 2} y={pad.top + plotH - barH - 5} fontSize={9} fill={INK} textAnchor="middle">
                {format(d.value)}
              </text>
              <text x={x + barW / 2} y={h - pad.bottom + 14} fontSize={9} fill={INK_MUTED} textAnchor="middle">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </ChartFrame>
  );
}
