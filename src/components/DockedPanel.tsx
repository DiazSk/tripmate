"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Maximize2 } from "lucide-react";
import { usePlacePhoto } from "@/lib/usePlacePhoto";

/**
 * What the capsule says about the trip while the panel is shut.
 *
 * Facts only, and the host's facts at that — the panel knows how to *draw* a capsule but has no
 * idea what a day or a destination is. Optional throughout: a surface with nothing to say (Focus
 * Mode's wide split, a panel showing only an error) collapses to a bare expand pill instead.
 */
export interface CapsuleSummary {
  /** The destination, e.g. `Tokyo`. Doubles as the key its thumbnail is looked up by, which is
   *  the same key the itinerary header and the /trips collage already use — so the picture is
   *  usually already in `usePlacePhoto`'s cache and costs no request. */
  title: string;
  /** Trip length, e.g. `5 days`. */
  subtitle?: string;
  /** Whatever the panel has in focus right now, e.g. `Day 1`. */
  step?: string;
}

/**
 * One control the capsule carries beside its summary, supplied by the host.
 *
 * Deliberately not folded into `CapsuleSummary`: that interface is documented as facts only, and
 * a callback is not a fact. The panel still knows nothing about what the action does — it draws a
 * round button with the host's glyph and calls the host's handler.
 *
 * One, not a list. The capsule has ~176px for its title at `sm:w-96`, and each control costs 44
 * of it; a second would take the title back under what "Mumbai, India · 7 days" needs.
 */
export interface CapsuleAction {
  /** The accessible name, and the only label this control has — it is icon-only at this size. */
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}

/** The house curve — the same easing and duration the stop rows and the map chrome animate on. */
const MORPH_TRANSITION = { duration: 0.32, ease: [0.16, 1, 0.3, 1] as const };
/** Long enough to read as a hand-off, short enough that the shape is what the eye follows. */
const CONTENT_FADE = { duration: 0.14, ease: "linear" as const };

/**
 * The right-docked content column, and the one place its geometry is written. Every
 * "content over the globe" surface uses it: the home page's result view, /trips, and
 * /trip/[id].
 *
 * Top offset reads `--nav-h` (the fixed glass navbar's height, set in globals.css) plus
 * the page's own gutter, at both breakpoints — a full-width fixed nav sits above a
 * right-docked panel too, not just a full-bleed one, unlike the small top-left wordmark
 * this replaced.
 *
 * **The collapse is not a nicety.** Below `sm` this panel covers the entire viewport,
 * which means the globe — the product's one piece of real imagery, and the thing the
 * route, the stems and the marker cards are all drawn on — is invisible on a phone, and
 * the map controls have nowhere to sit. It collapses above `sm` too, where the whole trip,
 * clustered and labelled per day, is worth looking at without a 40%-wide panel over it.
 *
 * **Collapsed, the panel becomes a capsule rather than hiding behind a control.** It was an arrow
 * before: a 40px glass circle that hid the panel and, shut, *was* the panel. That is a control,
 * not a state — it said nothing about the trip it had just swallowed, so the only way to remember
 * which day you were reading was to open it and look. The capsule keeps the trip on screen at a
 * glance (its picture, its name, its length, the day in focus) in a bar the width of a sentence,
 * and a click anywhere on it brings the panel back.
 *
 * The panel does not carry its own window chrome. It briefly did — a bar above the card holding a
 * grab line and a minimize button — and that was a strip of furniture between the map and the
 * photograph the card leads with, in a design whose whole argument is that the imagery is the
 * product. The grab line moved onto the itinerary's own header image instead (`ItineraryCard`),
 * where it sits over the picture the way a sheet's handle sits over its own sheet, and the panel
 * keeps only the shut state: the capsule.
 *
 * The shrink is a CSS transition between two fully-resolved geometries rather than a Framer layout
 * animation; see the note on the container below for why, which is measured rather than assumed.
 * Reduced motion is handled entirely by the blanket rule in globals.css, not by anything here.
 */
export default function DockedPanel({
  collapsible = false,
  className = "space-y-6",
  /** True while a request is replacing this panel's content. Stops the stale content
   *  being clicked while the loader is over it, and says so to assistive tech. */
  busy = false,
  /** Widens the panel to fit two real panes (e.g. Focus Mode's chat + preview split)
   *  instead of the single-column summary width. */
  wide = false,
  defaultCollapsed = false,
  collapsed: controlledCollapsed,
  onCollapsedChange,
  capsule,
  capsuleAction,
  children,
}: {
  collapsible?: boolean;
  className?: string;
  busy?: boolean;
  wide?: boolean;
  /** Start collapsed. The result view does, so a finished trip opens on its own map. */
  defaultCollapsed?: boolean;
  /** Optional controlled collapse. The host takes it over when something outside the panel has
   *  to know — the result view hands the same boolean to `ItineraryCard` as `panelCollapsed`,
   *  so shutting the panel is what re-frames the day it was showing for the whole screen. */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** What the capsule carries while shut. Omitted, it shuts to a bare expand pill. */
  capsule?: CapsuleSummary;
  /** An optional action alongside that summary — the trip page and the result view both pass the
   *  stop tour, which is the one thing worth reaching while the panel is shut: you closed it to
   *  watch the map, and the tour is a map animation. */
  capsuleAction?: CapsuleAction;
  children: React.ReactNode;
}) {
  const [uncontrolledCollapsed, setUncontrolledCollapsed] = useState(defaultCollapsed);
  const collapsed = controlledCollapsed ?? uncontrolledCollapsed;
  const setCollapsed = (next: boolean) => {
    if (onCollapsedChange) onCollapsedChange(next);
    else setUncontrolledCollapsed(next);
  };
  const isCollapsed = collapsible && collapsed;
  /**
   * A percentage plus a `max-width`, and both of those choices are load-bearing.
   *
   * `min(62vw, 880px)` reads better and cannot be used: Chromium will not interpolate a `min()`
   * against a plain length, so the fold snapped. Measured on a probe with a 400ms linear
   * transition — `40%` to `20rem` ran 50 frames, `calc(100dvh - 4rem - 3rem)` to `3.5rem` ran 49,
   * and `min(40vw, 520px)` to `20rem` ran 3, which is no animation at all.
   *
   * The `max-width` then has to be on *both* states, even though the capsule is far narrower than
   * it: dropping it with the collapsed class list would let the width jump to its unclamped
   * percentage the instant the fold began, which measured as a 520 -> 576 -> 326 stutter.
   */
  const widthClass = wide
    ? "sm:w-[62%] sm:max-w-[880px]"
    : "sm:w-[40%] sm:max-w-[520px]";

  return (
    <div
      aria-busy={busy || undefined}
      // `z-10` carries the whole panel — capsule included — above the globe canvas at `z-0` and
      // the marker cards at `z-[5]`, which is what lets the shut capsule sit over live terrain
      // and still take a click. Deliberately NOT the scroll container: `.docked-panel-body` below
      // is, so the capsule can cast a shadow outside the padding edge.
      //
      // **Every dimension is an explicit value in both states, and that is what makes the morph
      // work.** Framer's layout animation was tried twice here and snapped both times — measured
      // frame by frame in Chromium, 309x57 -> 505x38 -> 520x37, with `layout` on the element and
      // then on its parent as well. Its projection has no answer for a `position: fixed` element
      // whose insets change in the same commit. A CSS transition does, but only between two
      // resolvable values: `height: auto` (from pinned top *and* bottom) and `width: auto` cannot
      // be interpolated, so the open state states its height as a `calc()` off `100dvh` and its
      // width as a `min()` rather than a percentage plus `max-width`.
      //
      // `ease-in-out`, and not the house `cubic-bezier(0.16, 1, 0.3, 1)` every other motion here
      // uses. That curve is enormously front-loaded, which is what makes it feel responsive on a
      // 12px nudge and wrong on a shape change the size of the panel: most of an 800px fold would
      // be over before the eye caught it, leaving a snap with a soft landing.
      // Written out rather than composed from `transition-[…]` + `duration-300` + `ease-*`
      // utilities: the property list, the duration and the curve are one decision, and splitting
      // them across three classes in a file where unlayered rules already outrank utilities (see
      // globals.css) is three chances to lose one of them silently.
      //
      // **Unconditional, and reduced motion is why it can be — not something it forgot.** This was
      // `useReducedMotion() ? undefined : "…"`, which hydration-mismatched on every render: that
      // hook reads `prefersReducedMotion.current`, which motion-dom's own comment documents as
      // "`null` server-side". So the server, having no media query to read, always took the
      // falsy branch and emitted this string, while a reduced-motion client's first render wanted
      // no `style` attribute at all — React reconciles that as a mismatch and the branch that
      // loses is not knowable from here.
      //
      // The check bought nothing anyway. globals.css sets `transition-duration: 0.01ms !important`
      // on `*` under `prefers-reduced-motion: reduce`, and an important author declaration outranks
      // a normal inline one, so this duration is already flattened. Measured on the mounted panel:
      // 0.3s normally, `1e-05s` with that rule in scope. The setting can also change mid-session,
      // which the media query tracks and the hook does not — it reads once into `useState` and
      // never updates (framer-motion's own source says as much).
      style={{
        transition:
          "width 300ms ease-in-out, height 300ms ease-in-out, left 300ms ease-in-out, right 300ms ease-in-out",
      }}
      className={`docked-panel fixed z-10 m-0 flex flex-col ${
        busy ? "pointer-events-none" : "pointer-events-auto"
      } ${
        isCollapsed
          ? // Shut, the panel *is* the capsule: same top-right corner it opened from, so the card
            // collapses into its own upper edge rather than flying somewhere else. `overflow-hidden`
            // is what makes the shrink read as a fold — the body is clipped by the closing box.
            // `sm:w-96`, up from `sm:w-80`. Measured at 320px the row had 14px spare — photo 32,
            // title 140, "Day 1" 44, expand 28, plus 24 padding and 36 of gaps — so an action
            // button would have taken the title down to ~58px and truncated it to "Mumbai…",
            // losing both the city and the trip length the capsule exists to keep on screen.
            // 384px leaves the title ~176px, which is more than it has today.
            `docked-panel-collapsed top-[calc(var(--nav-h)+1.25rem)] right-4 left-4 h-14 overflow-hidden sm:top-[calc(var(--nav-h)+1.5rem)] sm:right-6 sm:left-auto sm:w-96 ${
              wide ? "sm:max-w-[880px]" : "sm:max-w-[520px]"
            }`
          : `top-[calc(var(--nav-h)+1.25rem)] right-0 left-0 h-[calc(100dvh-var(--nav-h)-1.25rem)] sm:top-[calc(var(--nav-h)+1.5rem)] sm:right-6 sm:left-auto sm:h-[calc(100dvh-var(--nav-h)-3rem)] ${widthClass}`
      }`}
    >
      {collapsible && isCollapsed && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={CONTENT_FADE}
          // No `.glass-control`: its `background`, `border` and `box-shadow` are *unlayered*
          // author declarations, and the cascade ranks those above anything `@layer`-emitted, so
          // every `bg-*`/`border-*`/`shadow-*` utility here would be dead. Documented at length
          // in globals.css, where four controls lost their hovers to exactly that.
          className="docked-panel-capsule h-full w-full overflow-hidden rounded-[18px] border border-white/15 bg-slate-950/80 shadow-2xl backdrop-blur-md transition-colors duration-300 hover:border-white/30"
        >
          <Capsule summary={capsule} action={capsuleAction} onExpand={() => setCollapsed(false)} />
        </motion.div>
      )}
      {/* The scroller, and the element `className` (a `space-y-*` by default) belongs to — it
          spaces the panel's real content. `min-h-0` is load-bearing: a flex item's default
          `min-height: auto` refuses to shrink below its content, so without it a long itinerary
          grows the panel past the viewport instead of scrolling inside it.

          `display: none` while collapsed (globals.css) rather than unmounted: the active day, the
          scroll position, the stop tour's interval and the reveal stagger all live in this
          subtree, and unmounting would reset every one of them on each glance at the map. The
          opacity animation is therefore only ever seen on the way *back* — expanding fades the
          plan in behind the opening panel, while collapsing cuts, because the capsule taking its
          place is the thing worth watching. */}
      <motion.div
        initial={false}
        animate={{ opacity: isCollapsed ? 0 : 1 }}
        transition={{ ...MORPH_TRANSITION, delay: isCollapsed ? 0 : 0.06 }}
        className={`docked-panel-body min-h-0 flex-1 overflow-y-auto ${className}`}
      >
        {children}
      </motion.div>
    </div>
  );
}

/**
 * What the capsule shows: the trip in one row, and at most one thing to do with it.
 *
 * It was a single `<button>` filling the whole shape — one target, one accessible name instead of
 * four — and that is still the shape when no action is passed. An action cannot go *inside* that
 * button (a `<button>` may not contain a `<button>`; browsers recover, but the inner control's
 * activation is not reliably its own), so the row splits: the summary keeps the growing, oversized
 * expand target it always had, and the action is its sibling at the trailing edge.
 *
 * What that costs is one extra tab stop, which is the honest price of putting a second verb here.
 * What it keeps is the property that mattered: clicking anywhere on the trip's own name, picture
 * or day chip still opens the plan. The `Maximize2` stays decorative inside that target.
 */
function Capsule({
  summary,
  action,
  onExpand,
}: {
  summary?: CapsuleSummary;
  action?: CapsuleAction;
  onExpand: () => void;
}) {
  const photo = usePlacePhoto(summary?.title ?? "");
  const [photoFailed, setPhotoFailed] = useState(false);

  return (
    <div className="flex h-full w-full items-center px-3">
      <button
        type="button"
        onClick={onExpand}
        aria-label="Show the plan"
        className="group flex h-full min-w-0 grow items-center gap-3 pr-2 text-left focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2"
      >
        {summary && (
          // The tile stays whatever the photo does: a lookup that misses (or 404s on the way in)
          // leaves a filled rounded square rather than a torn image icon or a collapsed row.
          <span className="relative block h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-white/10">
            {photo && !photoFailed && (
              // eslint-disable-next-line @next/next/no-img-element -- arbitrary external Wikipedia thumbnails, small and lazy, not worth next/image config
              <img
                src={photo}
                alt=""
                onError={() => setPhotoFailed(true)}
                className="value-in absolute inset-0 h-8 w-8 object-cover"
              />
            )}
          </span>
        )}
        {summary && (
          <span className="min-w-0 truncate text-sm font-medium whitespace-nowrap text-white">
            {summary.title}
            {summary.subtitle && (
              // Desktop only. Below `sm` the capsule is the viewport minus 32px, and the action
              // button takes 48 of that: measured at 375px the title had 121px and truncated
              // "Mumbai, India · 7 days" to "Mumbai, India · 7…", cutting a number in half, which
              // reads as broken rather than as elided. Of the three facts here the trip length is
              // the one worth dropping — the city says where and the chip says which day, and
              // both survive. Restored the moment there is room for it.
              <span className="hidden font-normal text-white/55 sm:inline">
                {" "}
                · {summary.subtitle}
              </span>
            )}
          </span>
        )}
        {summary?.step && (
          <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[0.6875rem] font-medium whitespace-nowrap text-white/75">
            {summary.step}
          </span>
        )}
        <span className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/55 transition-colors group-hover:bg-white/10 group-hover:text-white">
          <Maximize2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
        </span>
      </button>
      {action && (
        // 44px, not the 36 the shape would prefer: this is the one control on screen while the
        // plan is shut, and it is reached with a thumb over a live map as often as with a mouse.
        // It clears the 56px capsule with 6px either side, the same gutter the navbar keeps.
        <button
          type="button"
          onClick={action.onClick}
          aria-label={action.label}
          className="ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-accent transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2"
        >
          {action.icon}
        </button>
      )}
    </div>
  );
}
