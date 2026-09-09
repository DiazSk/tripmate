"use client";

import { useEffect, useId, useRef } from "react";

import { devLabel } from "@/lib/devInspector";
import { gsap } from "@/lib/gsap";
import { useLineReveal } from "@/lib/lineReveal";
import { prefersReducedMotion } from "@/lib/reducedMotion";
import { useScrollContainer } from "@/lib/scrollContainer";
import SectionOpener from "./SectionOpener";
import { MAP_VIEWBOX, WORLD_LAND_PATH, projectToMap } from "./worldLand";

/**
 * Where the planner can go, on a real map.
 *
 * **Deliberately not the globe.** The reference's own destination section is a static image, and
 * mounting Cesium here to imitate it would reverse a measured decision: DESIGN.md records the cold
 * cost of booting the globe on a route that does not need one — 5410ms of long tasks across 32
 * tasks, a 2287KB chunk, 33 `/cesium/` asset requests — and The Mounted-Surface Gate exists to keep
 * it off exactly this kind of surface. This is one committed SVG path and no WebGL context.
 *
 * The first version drew the land as a dot matrix from hand-authored grid runs. It read as an
 * abstract dot field rather than as Earth, because the runs were too wide and closed the Atlantic.
 * This is the real Natural Earth coastline — see `worldLand.ts`.
 *
 * Dots follow the reference exactly: a soft radial halo behind a small solid core, both scaling up
 * on scroll.
 */

/** The four featured plans, plus enough others that the map reads as reach rather than as four
 *  pins. Real coordinates — placed by projection, not by eye. */
const DOTS: { name: string; lat: number; lon: number; featured?: boolean }[] = [
  { name: "Kyoto", lat: 35.0, lon: 135.8, featured: true },
  { name: "Lisbon", lat: 38.7, lon: -9.1, featured: true },
  { name: "Reykjavík", lat: 64.1, lon: -21.9, featured: true },
  { name: "Marrakesh", lat: 31.6, lon: -8.0, featured: true },
  { name: "Mexico City", lat: 19.4, lon: -99.1 },
  { name: "New York", lat: 40.7, lon: -74.0 },
  { name: "Buenos Aires", lat: -34.6, lon: -58.4 },
  { name: "Cape Town", lat: -33.9, lon: 18.4 },
  { name: "Istanbul", lat: 41.0, lon: 29.0 },
  { name: "Bangkok", lat: 13.8, lon: 100.5 },
  { name: "Sydney", lat: -33.9, lon: 151.2 },
  { name: "Vancouver", lat: 49.3, lon: -123.1 },
];

/** The accent, read from the token rather than held as a near-copy of it.
 *
 *  This used to be a literal `#fba13a` — a *slightly different* orange from the accent of the day
 *  (`#fb9826`), kept on the reasoning that the reference site runs a warmer orange on its map than
 *  in its nav. Two hues four values apart is not a distinction anyone can see; it is just a value
 *  that no longer moves when the palette does, and it duly went stale the moment the accent left
 *  the orange family entirely. An SVG `fill` cannot take a CSS variable through `stopColor` in all
 *  engines, so it is read once here rather than inlined per element. */
const DOT_COLOR = "var(--accent)";

export default function DestinationMap() {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const container = useScrollContainer();
  const gradientId = useId();
  useLineReveal(headingRef);

  useEffect(() => {
    if (prefersReducedMotion() || !svgRef.current) return;
    const ctx = gsap.context(() => {
      // `transform-box: fill-box` with a centre origin is load-bearing: an SVG child otherwise
      // scales about the viewBox origin, so every dot flies in from the top-left corner instead
      // of growing where it sits.
      gsap.fromTo(
        ".destination-dot",
        { scale: 0, opacity: 0 },
        {
          scale: 1,
          opacity: 1,
          duration: 0.7,
          ease: "back.out(1.7)",
          stagger: { each: 0.06, from: "random" },
          scrollTrigger: {
            trigger: svgRef.current,
            scroller: container?.current ?? undefined,
            start: "top 80%",
          },
        }
      );
    }, svgRef);
    return () => ctx.revert();
  }, [container]);

  return (
    <section
      id="destinations"
      className="scene-band is-quiet has-rule pointer-events-auto"
      {...devLabel("DestinationMap")}
    >
      <SectionOpener label="Reach" headingRef={headingRef}>
        <h2 className="font-scene-display is-quiet text-foreground">
          Anywhere you can name
        </h2>
      </SectionOpener>

      {/* The `lg:ml-[calc(11rem+2.5rem)]` that used to be here is gone with the thing it aligned
          to: the opener's old 11rem label column plus its 2.5rem gutter, which put this paragraph
          under the heading rather than under the label. The opener no longer has a left column, so
          the indent had nothing to line up with and was simply pushing the copy 217px right of
          every other paragraph on the page. */}
      <p className="scene-prose mt-6 max-w-xl text-muted">
        The planner geocodes the destination you type, then pulls that place&rsquo;s real forecast,
        public holidays and opening hours. There is no list of supported cities to be missing from.
      </p>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${MAP_VIEWBOX.width} ${MAP_VIEWBOX.height}`}
        className="mt-12 w-full"
        role="img"
        aria-label="A world map with destinations marked across the Americas, Europe, Africa, Asia and Oceania."
      >
        <defs>
          <radialGradient id={gradientId}>
            <stop offset="0%" stopColor={DOT_COLOR} stopOpacity="0.9" />
            <stop offset="100%" stopColor={DOT_COLOR} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* The land. Filled at a low alpha under a slightly brighter hairline, so the coastline
            reads without the landmass competing with the dots sitting on it. */}
        <path
          d={WORLD_LAND_PATH}
          className="fill-white/[0.07] stroke-white/20"
          strokeWidth={0.6}
          strokeLinejoin="round"
        />

        {/* Destinations. The accent's one real appearance on the page, which is the reference's
            own discipline: colour as punctuation, spent on the thing you want looked at. */}
        {DOTS.map((d) => {
          const { x, y } = projectToMap(d.lat, d.lon);
          return (
            <g
              key={d.name}
              className="destination-dot"
              style={{ transformBox: "fill-box", transformOrigin: "center" }}
            >
              <circle
                cx={x}
                cy={y}
                r={d.featured ? 26 : 16}
                fill={`url(#${gradientId})`}
                opacity={0.32}
              />
              <circle cx={x} cy={y} r={d.featured ? 3.6 : 2.6} fill={DOT_COLOR} />
            </g>
          );
        })}
      </svg>
    </section>
  );
}
