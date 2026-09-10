"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";

import { devLabel } from "@/lib/devInspector";
import { formatMoney } from "@/lib/format";
import { gsap } from "@/lib/gsap";
import { useLineReveal } from "@/lib/lineReveal";
import { prefersReducedMotion } from "@/lib/reducedMotion";
import { useScrollContainer } from "@/lib/scrollContainer";
import { MAP_PLACES } from "./mapPlaces";
import SectionOpener from "./SectionOpener";
import { planExamples, toPrefill, type PlanExample, type PlanPrefill } from "./planExamples";
import { MAP_VIEWBOX, WORLD_LAND_PATH, projectToMap } from "./worldLand";

/**
 * Where the planner can go, on a real map.
 *
 * **Deliberately not the globe.** DESIGN.md records the cold cost of booting Cesium on a route that
 * does not need one — 5410ms of long tasks across 32 tasks, a 2287KB chunk, 33 `/cesium/` asset
 * requests — and The Mounted-Surface Gate exists to keep it off exactly this kind of surface. This
 * is one committed SVG path, one `<pattern>`, and no WebGL context.
 *
 * ## What this beat was getting wrong, which was not polish
 *
 * The heading is "Anywhere you can name" and the standfirst says there is no list of supported
 * cities to be missing from. The visual was **exactly twelve pins**, which states the opposite: we
 * support these twelve. It also flagged four of them `featured: true` — Kyoto, Lisbon, Reykjavík,
 * Marrakesh — which have **zero overlap** with the four plans the site actually ships. And every
 * one of the twelve wore an accent-coloured radial glow while doing nothing at all, against The One
 * Meaning Rule's "jade acts".
 *
 * So the density now carries the claim and the accent is spent on the things that can be acted on:
 *
 * - **The field.** The land is filled with a stipple `<pattern>`, not a flat alpha. Hundreds of
 *   faint marks across every landmass is "anywhere" stated in the artifact rather than only in the
 *   heading. A `<pattern>` used as a `fill` clips to the continents for free, which is why there is
 *   no generated geometry here — the costed alternative was rasterising the land path offline to
 *   sample a grid, meaning a new build script and ~12KB of committed coordinates to do what the
 *   platform does in five lines. The hairline coastline stays, so the continents keep their edges
 *   rather than dissolving into texture.
 * - **The destinations.** Ninety-odd well-known places from `mapPlaces.ts`, on every inhabited
 *   continent, each drawn as a **real point symbol** — hairline ring plus a solid core, the same
 *   geometry as a plan marker, in the one slate instead of jade. The first cut of this rebuild had
 *   only the four plans, and four marks on a world map reads as half-finished — which is fair, and
 *   is the same defect as the twelve pins seen from the other side. The resolution is *quantity*:
 *   twelve is a countable set and reads as an inventory, ninety is not counted and reads as "the
 *   world is full of places".
 *
 *   The cut after that drew them as faint 4px dots, on the reasoning that anything more would be
 *   `featured: true` coming back. **That reasoning was wrong and the result proved it**: at that
 *   weight they read as *texture* rather than as places, so the map still said "four locations plus
 *   a speckle". The `featured` sin was flagging four arbitrary cities as special when they had
 *   nothing to do with the product; distinguishing the four *shipped plans* is not that, because
 *   those four genuinely differ — they are the ones you can press. Which is also why the separation
 *   is carried by **hue, label and size** and not by inventing a tier inside the destination layer:
 *   nothing in it is ranked, one radius and one alpha for all ninety.
 * - **The plan marks.** Four, and they are the four real plans read straight from `planExamples.ts`,
 *   so the `featured` fiction cannot come back. Each one is a *control*: it opens the wizard
 *   prefilled, the same `toPrefill` path `FeaturedPlans` uses one band above. Hairline ring plus a
 *   small solid core; the zero-offset coloured halos are gone, DESIGN.md having already recorded that
 *   exact treatment being removed from the app's own day badges as the clearest AI-dashboard tell
 *   there is. These are the only accent-bearing and only interactive things on the field, which is
 *   what keeps the two layers legible as "places exist" and "these four you can press".
 *
 * ## Why the markers are HTML over the SVG rather than `<text>` inside it
 *
 * SVG content scales with the viewBox, and this viewBox is 1200 units across a box that is 350 CSS
 * px wide on a phone and 1760 at the band's ceiling — a 5x range. Type set in user units is either
 * unreadable at one end or a billboard at the other, and there is no `vector-effect` for font size.
 * Positioned HTML gets a fixed type step at every width, real `:hover`/`:focus-visible`, a real
 * accessible name, and `.focus-ring` for nothing.
 *
 * Centring is `margin`, not `translate`, and that is load-bearing: GSAP writes `transform`
 * wholesale, so a Tailwind `-translate-x-1/2` would be silently dropped the moment the entrance
 * tween touched the element. Negative margins put the mark on its coordinate and leave `transform`
 * entirely to the animation.
 *
 * ## The marks appear at `lg`, and that is a measurement rather than a shrug
 *
 * Three of the four plans are in western Eurasia. At 375px the map is 335px wide and Val d'Orcia,
 * Sinaia and Wadi Rum land inside a 22x17px box — three rings in that space are a smudge, and
 * three tap targets 13px apart fail WCAG 2.2's target spacing outright. So below `lg` the band is
 * the field and the paragraph, and it is `display: none` rather than a visual hide, which is what
 * also takes the buttons out of the tab order. Nothing actionable is lost: all four of these plans
 * are full cards with their own buttons in `FeaturedPlans`, one band above. What is left is still
 * strictly more than the twelve haloed pins this replaced — the destination layer renders at every
 * width and is what stops the phone getting a bare stipple.
 *
 * ## No ambient anything
 *
 * The fixed navbar's `backdrop-filter: blur(16px)` is on screen at every scroll position, so any
 * continuous animation here re-rasters it at refresh rate whether or not the page is scrolling —
 * the reason `.hero-light` is paused while the hero film runs. The entrance is one-shot and
 * terminating: no pulse on the marks, no travelling arcs, no drifting wash.
 *
 * And this beat keeps ScrollTrigger rather than moving to the `--story` timeline, which everything
 * else scroll-driven on this page uses. `--story`'s `animation-range` offsets are absolute scroll
 * lengths from the scroller's origin, and this band is fifth of six, so its range would shift
 * whenever any band above it changed height — the silent failure globals.css documents at length.
 * `trigger` + `start` is element-relative and immune to it.
 */

/** Which way each label hangs off its mark. Hand-placed, because with four marks a solver is more
 *  code than the answer: Val d'Orcia and Sinaia are 3.9% of the map's width apart and Sinaia and
 *  Wadi Rum 6.1%, so the two western European labels have to leave along different axes or they
 *  overlap at every width. `right` is the default and the two Asian marks take it. */
const PLACEMENT: Record<string, "left" | "up" | "right"> = {
  tuscany: "left",
  sinaia: "up",
};

/**
 * The destinations, less the handful that a plan marker is already sitting on.
 *
 * **Measured, because the overlap is severe and was invisible in the data.** In a frame where one
 * user unit is about one pixel, `Rome` lands **4.8 units** from the Val d'Orcia marker, `Agra` 7.4
 * from Jaipur, `Jerusalem` 7.4 from Wadi Rum and `Venice` 8.4 from Val d'Orcia. A plan ring is 6.5px
 * in radius and a destination ring 4px, so anything closer than **10.5** is two rings drawn through
 * each other — which reads as a rendering fault rather than as two places, and no amount of alpha
 * fixes it.
 *
 * So the threshold is that sum, not a round number, and it is computed from `planExamples` rather
 * than applied by deleting rows from `mapPlaces.ts`. That matters: a plan's coordinates can change,
 * and a hand-pruned list would silently start colliding again — or worse, keep a hole where a plan
 * used to be. `Rome` and `Venice` leaving the field is a real cost, and it is the right side of the
 * trade: Val d'Orcia is 200km from Rome and at this scale they are the same pixel, so the choice is
 * not "show Rome or not" but "which of two marks occupies that pixel" — and the answer is the one
 * that is labelled, priced and clickable.
 *
 * Note what is deliberately **not** filtered: `Cairo` at 14 units, `Luxor` at 15.9, `Zermatt` at
 * 16.3 and `Istanbul` at 18.5 are all clear of the rings and stay. They do sit inside a plan
 * marker's 26px *hit* box, whose square corners reach 18.4 units, so they lose their hover tooltip
 * to a neighbouring button. That is accepted rather than fixed — see `.destination-dot` in
 * globals.css for the `clip-path` that solves it and the reason it cannot be used. A destination
 * that loses a tooltip to a permanently labelled, priced marker 14px away has lost very little.
 */
const PLAN_POINTS = planExamples.map((plan) => projectToMap(plan.lat, plan.lon));
const PLAN_MARKER_RADIUS = 6.5;
const PLACE_MARKER_RADIUS = 4;
const FIELD_PLACES = MAP_PLACES.filter(([, lat, lon]) => {
  const { x, y } = projectToMap(lat, lon);
  return !PLAN_POINTS.some(
    (p) => Math.hypot(x - p.x, y - p.y) < PLAN_MARKER_RADIUS + PLACE_MARKER_RADIUS
  );
});

export default function DestinationMap({
  onPlan,
}: {
  onPlan: (prefill?: PlanPrefill) => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const container = useScrollContainer();
  const stippleId = useId();
  useLineReveal(headingRef);

  /** Which destination the pointer is on, `null` for none. Held here rather than per-mark so there
   *  is one tooltip element on the page instead of ninety-one hidden ones. */
  const [hovered, setHovered] = useState<Hovered | null>(null);

  useEffect(() => {
    if (prefersReducedMotion() || !mapRef.current) return;
    const ctx = gsap.context(() => {
      // One timeline, one ScrollTrigger: the field resolves first and the marks land on it, which
      // is the order the eye wants — texture, then the four things to look at. `expo.out` is the
      // house curve, and replaces the `back.out(1.7)` that used to run here. That overshoot was
      // the only non-house easing in the app, undocumented, two inches under a heading revealing
      // on `expo.out`; twelve dots bouncing past their own positions is also the wrong gesture for
      // a claim about coverage.
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: mapRef.current,
          scroller: container?.current ?? undefined,
          start: "top 80%",
        },
      });
      tl.fromTo(".destination-field", { opacity: 0 }, { opacity: 1, duration: 0.9, ease: "expo.out" })
        // The destinations resolve over the field rather than with it, and slower, so the land
        // arrives as ground and the places settle onto it. One tween for all ninety — a stagger
        // across that many marks either takes seconds or is too fine to perceive, and this beat's
        // one-shot budget does not stretch to seconds of the navbar's blur panel re-rastering.
        .fromTo(
          ".destination-places",
          { opacity: 0 },
          { opacity: 1, duration: 1.1, ease: "expo.out" },
          0.15
        )
        .fromTo(
          ".destination-dot",
          { opacity: 0, scale: 0.4 },
          { opacity: 1, scale: 1, duration: 0.7, ease: "expo.out", stagger: 0.1 },
          0.45
        );
    }, mapRef);
    return () => ctx.revert();
  }, [container]);

  return (
    <section
      id="destinations"
      className="scene-band is-quiet has-rule pointer-events-auto"
      {...devLabel("DestinationMap")}
    >
      <SectionOpener label="Reach" headingRef={headingRef}>
        <h2 className="font-scene-display is-quiet text-foreground">Anywhere you can name</h2>
      </SectionOpener>

      <p className="scene-prose mt-6 max-w-xl text-muted">
        The planner geocodes the destination you type, then pulls that place&rsquo;s real forecast,
        public holidays and opening hours. There is no list of supported cities to be missing from.
      </p>

      <div
        ref={mapRef}
        className="destination-map"
        role="group"
        aria-label="Four worked example plans, placed on a world map"
      >
        {/* The field is decoration: it states the same thing the standfirst above it states, and a
            screen reader that announced a coastline would be reading out the illustration. Every
            piece of information here is in the four buttons or in the paragraph. */}
        <svg
          aria-hidden
          viewBox={`0 0 ${MAP_VIEWBOX.width} ${MAP_VIEWBOX.height}`}
          className="destination-map-svg"
        >
          <defs>
            <pattern id={stippleId} width="14" height="14" patternUnits="userSpaceOnUse">
              {/* The base wash, so a landmass narrower than the pattern cell — every island, and
                  most of Indonesia — still reads as land rather than as a gap in the stipple. */}
              <rect width="14" height="14" fill="var(--foreground)" opacity="0.028" />
              <circle cx="7" cy="7" r="1.35" fill="var(--foreground)" opacity="0.115" />
            </pattern>
          </defs>

          {/* The coastline, at the same hairline every other boundary on the page uses. It is
              barely there on purpose: the stipple is what draws the continents, and a visible
              outline around a dot field reads as a traced map rather than a printed one. Its job
              is to stop islands smaller than the pattern cell disappearing. */}
          <path
            className="destination-field"
            d={WORLD_LAND_PATH}
            fill={`url(#${stippleId})`}
            stroke="var(--card-border)"
            strokeWidth={0.6}
            strokeLinejoin="round"
          />

          {/* The destinations, and the reason there are ninety of them rather than a dozen. Twelve
              pins is a *countable* set, and a countable set under "Anywhere you can name" reads as
              an inventory — which is the defect this beat was rebuilt to fix, not a stylistic
              preference. Ninety is not counted; it is read as "the world is full of places". So the
              density is the argument, and the marks that carry it have to be inert to make it: one
              neutral slate at an alpha, one radius for all of them, no labels, no hover, no tier.
              A "major" subset drawn larger would be `featured: true` under a new name.

              They are `<circle>`s in the same SVG rather than positioned HTML — unlike the four
              plan markers, which need a fixed type step and a real focus ring. These need neither,
              and ninety absolutely-positioned elements to draw ninety dots is the trade the other
              way round. */}
          {/* **One delegated listener for ninety-one marks**, not ninety-one listeners. The name
              travels on `data-place` and the position is re-read off the target's own `cx`/`cy`,
              so the handler needs no closure per mark and the marks stay plain geometry.

              `pointer-events: all` on the ring is what makes them hoverable at all, and it is worth
              stating why: the ring is `fill: none`, so by default only its **0.7px stroke**
              hit-tests, and the core is 3px — a 3px target on a 1392px map is not a target. `all`
              makes the ring's whole disc catch the pointer, which is 7.9px at 1440, for no extra
              elements. The alternative was a third invisible circle per place, i.e. 273 SVG nodes
              to do what one declaration does. */}
          <g
            className="destination-places"
            onPointerOver={(e) => {
              const el = (e.target as SVGElement).closest("[data-place]") as SVGCircleElement | null;
              if (!el) return;
              setHovered({
                name: el.dataset.place ?? "",
                x: (el.cx.baseVal.value / MAP_VIEWBOX.width) * 100,
                y: (el.cy.baseVal.value / MAP_VIEWBOX.height) * 100,
              });
            }}
            onPointerLeave={() => setHovered(null)}
          >
            {FIELD_PLACES.map(([name, lat, lon]) => {
              const { x, y } = projectToMap(lat, lon);
              return (
                <Fragment key={name}>
                  <circle className="place-ring" cx={x} cy={y} r={3.4} data-place={name} />
                  <circle className="place-core" cx={x} cy={y} r={1.5} />
                </Fragment>
              );
            })}
          </g>
        </svg>

        {planExamples.map((plan) => (
          <Mark key={plan.id} plan={plan} onPlan={onPlan} />
        ))}

        {hovered && <PlaceTip place={hovered} />}
      </div>
    </section>
  );
}

type Hovered = { name: string; x: number; y: number };

/**
 * The name of the destination under the pointer.
 *
 * **Hover-only, and that is a deliberate ceiling rather than an oversight.** These ninety-one marks
 * are decoration: they are `aria-hidden`, they are not controls, and they are not in the tab order.
 * Making them focusable would put ninety-one tab stops between the heading and the footer to reveal
 * ninety-one place names a screen reader gets nothing from, which is a worse page for exactly the
 * people it would claim to serve. The name is an enhancement for a pointer; the *claim* the band
 * makes lives in the heading and the standfirst, which every visitor gets.
 *
 * **No transition.** Sweeping a pointer across Europe re-anchors this twenty times in a second, and
 * a fade on each would both look like jitter and re-raster the navbar's blur panel through every
 * frame of every one of them. A cartographic callout snaps.
 *
 * The side it leaves on is picked from the anchor rather than fixed, because the extremes are real:
 * Nadi sits at 99.3% of the map's width and Bora Bora at 7.8%, so a centred tooltip would hang off
 * the frame at both ends; Tromsø is at 10% of its height, where "above" is the standfirst paragraph.
 */
function PlaceTip({ place }: { place: Hovered }) {
  const side = place.x > 84 ? "end" : place.x < 16 ? "start" : "center";
  const below = place.y < 16;
  return (
    <span
      aria-hidden
      className={`destination-tip is-${side} ${below ? "is-below" : "is-above"}`}
      style={{ left: `${place.x}%`, top: `${place.y}%` }}
    >
      {place.name}
    </span>
  );
}

/** Read at click time rather than at render, so a tab left open past midnight still prefills a
 *  season the form's own `min={todayISO()}` will accept. Same reasoning, same shape, as
 *  `FeaturedPlans`. */
const todayISO = () => new Date().toLocaleDateString("sv-SE");

function Mark({
  plan,
  onPlan,
}: {
  plan: PlanExample;
  onPlan: (prefill?: PlanPrefill) => void;
}) {
  const { x, y } = projectToMap(plan.lat, plan.lon);
  // "Val d'Orcia, Italy" is 18 characters at the label step's 0.18em tracking — 160px, against a
  // 110px budget at the `lg` floor. The country is also the one thing a map already tells you, so
  // the visible label is the place and the full destination goes to the accessible name below.
  const place = plan.destination.split(",")[0];
  const price = formatMoney(plan.budgetUsd);

  return (
    <button
      type="button"
      className={`destination-dot focus-ring is-${PLACEMENT[plan.id] ?? "right"}`}
      style={{
        left: `${(x / MAP_VIEWBOX.width) * 100}%`,
        top: `${(y / MAP_VIEWBOX.height) * 100}%`,
      }}
      onClick={() => onPlan(toPrefill(plan, todayISO()))}
      /* An explicit `aria-label` rather than a visually-hidden span alongside `aria-hidden` content.
         Both compute the same name in a conforming engine, and the span version was measurably
         harder to *verify*: the accessibility tree read back the hidden text and both label spans,
         so nothing short of a real screen reader could confirm the marker announced once rather
         than three times. An `aria-label` overrides the subtree outright, so the name is the string
         written here whatever the engine does with `aria-hidden`. It carries the verb and the
         country the visible label drops. */
      aria-label={`Plan a trip like ${plan.destination}, from ${price}`}
    >
      <span className="destination-ring" />
      <span className="destination-leader" />
      <span className="destination-label">
        <span className="destination-place">{place}</span>
        <span className="destination-price">from {price}</span>
      </span>
    </button>
  );
}
