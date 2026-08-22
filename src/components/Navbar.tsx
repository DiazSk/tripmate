"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ButtonMark from "@/components/ButtonMark";
import LogoMark from "@/components/LogoMark";
import { prefersReducedMotion } from "@/lib/reducedMotion";
import { useScrollContainer } from "@/lib/scrollContainer";

// Same ease every other motion in this app already uses for a "smooth, not
// snappy" settle (--marker-transition, --scene-hover, the *-in keyframes).
const MENU_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

// One row shape for every item in the mobile menu, anchors and the routed link alike,
// so the panel can render and stagger them from a single list.
//
// The lucide icons these rows used to carry are gone. They were right for a 16px dropdown row and
// wrong the moment the panel went full-screen and the labels went to 2.81rem: an 18px glyph beside
// type that size stops reading as an icon and starts reading as a bullet. The reference sets these
// as bare words with a `+` in front, and so does the footer — nothing was lost, because the label
// was always the thing being read.
const MENU_ITEMS = [
  { id: "journey", label: "The Journey", kind: "anchor" as const },
  { id: "how-it-works", label: "How It Works", kind: "anchor" as const },
  { id: "trips", label: "My memories", kind: "link" as const, href: "/trips" },
  { id: "profile", label: "Profile", kind: "link" as const, href: "/profile" },
];

// The footer's link treatment — same 2.81rem ceiling, same weight, same -0.085em, same `+` at
// white/45. That is the one scale this project already derived from this reference for this exact
// job, a short list of destinations set as large as the surface allows, and the menu and the footer
// are the two places the job comes up.
//
// **The clamp's floor and slope are the menu's own, and copying the footer's was wrong.** The footer
// runs `clamp(1.75rem, 4vw, 2.81rem)`, which on a 402px phone resolves to `4vw` = 16px, loses to the
// floor, and sets 28px — correct there, where the navigation is one block among several in a footer
// that also carries a wordmark and two lines of small print. This panel *is* the viewport: nothing
// competes with it, and 28px in the middle of an empty screen read as a dropdown that had merely
// grown. Measured on the reference, its own mobile menu sits at the top of this range, not the
// bottom. `10vw` reaches the 2.81rem ceiling by 450px and gives 40px at 402px and 32px at 320px, so
// a phone gets the scale the surface is asking for and the ceiling still holds on a small tablet.
//
// The row height follows: 40px at 1.1 leading is a 44px line box, which is also what puts these
// targets on the 44px floor rather than the 31px the footer's curve was giving them.
//
// `inline-flex`, not `flex`: the hit area is the words, not the panel's full width. A full-bleed row
// means a tap on empty space to the right of "Profile" navigates, which is not what anyone aimed at.
const menuItemBase =
  "group inline-flex items-baseline text-[clamp(2rem,10vw,2.81rem)] leading-[1.1] font-semibold tracking-[-0.085em] transition-colors duration-150 hover:text-accent focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none";

/** Swapped rather than appended, for the same reason as `navLink` below. */
const menuItem = (active = false) =>
  `${menuItemBase} ${active ? "text-accent" : "text-foreground"}`;

// Shared style for every link in the nav, aside from the wordmark — plain
// text-foreground, no hero-legible, since this bar is real glass, not bare canvas.
// The rule arrives on hover/focus rather than sitting under every item permanently. Four
// always-underlined items read as unstyled anchors, and the underline was carrying no
// information: everything in this bar is a link, so marking all of them marks none of them.
// The hover state keeps the affordance where it means something. It carries two signals, not
// one: the rule appears *and* the text goes accent. Colour alone would leave anyone who cannot
// separate #fb9826 from white with no hover feedback at all, which is the reason the underline
// survived the cut in the first place.
const navLinkBase =
  "inline-flex min-h-11 items-center text-sm font-medium decoration-accent/60 underline-offset-4 transition-colors hover:text-accent hover:underline focus-visible:rounded-sm focus-visible:underline focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none";

/**
 * The colour is swapped, not appended.
 *
 * `text-foreground` and `text-accent` are both `color` utilities at identical specificity, so
 * concatenating them leaves the winner to Tailwind's output order — which is how the first version
 * of this rendered a white "active" link while its `aria-current` was already correct. Exactly one
 * colour utility is emitted per link.
 *
 * `aria-current` accompanies it wherever it is used, so the state is never colour alone.
 */
const navLink = (active = false) =>
  `${navLinkBase} ${active ? "text-accent" : "text-foreground"}`;

// Landing-only: the two beats worth a direct jump to.
// It used to say this "deliberately excludes the final reveal section", because naming the
// closing poster in the nav would have short-circuited the withheld CTA. That poster is retired
// and the CTA is in the hero now, so the exclusion no longer defends anything — these two are
// simply the sections a visitor might want to jump *back* to. Plans and Reach are deliberately
// not here: five items in a bar this size is a menu, not wayfinding.
const SECTION_LINKS = [
  { id: "journey", label: "The Journey" },
  { id: "how-it-works", label: "How It Works" },
];

/**
 * The app's one top bar — fixed and blurred through the entire scroll on every route,
 * replacing the old plain-text wordmark that used to sit unblurred over the bare globe.
 * Also the one place "My memories"/"New trip" live now: both used to be scattered across
 * individual pages as bare-canvas links (the landing's closing CTA row, page.tsx's plan step,
 * trips/page.tsx, TripView.tsx) — consolidated here since they're utility wayfinding,
 * not page content, and don't need to float in and out with scroll position or step.
 *
 * Known, accepted gap: the `/` section-anchor links render regardless of the landing
 * page's own step state. If a visitor has already advanced past the hero
 * (step !== "landing"), `ScrollStory` is unmounted, the target ids don't exist, and a
 * click is a silent no-op. Fixing that needs `step` lifted out of page.tsx's local state
 * into something this component can read — a real change for two nav links, and out of
 * scope here. "My memories" has no such gap; it's a plain route, always present.
 */
/**
 * Which section anchor is currently on screen, or null.
 *
 * `IntersectionObserver` rather than a scroll handler: the callback fires only when a section
 * crosses the threshold, where a scroll listener would run on every frame of every scroll for a
 * value that changes five times a page.
 *
 * Two details the naive version gets wrong. The `root` has to be AppShell's content overlay —
 * `window` never scrolls here (see `scrollContainer.ts`), so a null root observes a viewport that
 * never moves and nothing ever intersects. And with several sections tall enough to be on screen
 * at once, "is intersecting" is ambiguous; the topmost intersecting one is the one the visitor is
 * reading, so entries are sorted by position and the first wins.
 */
function useActiveSection(ids: string[], enabled: boolean): string | null {
  const container = useScrollContainer();
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const root = container?.current ?? null;
    const sections = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      () => {
        const onScreen = sections
          .filter((el) => {
            const r = el.getBoundingClientRect();
            const bottom = root ? root.getBoundingClientRect().bottom : window.innerHeight;
            return r.top < bottom * 0.5 && r.bottom > 0;
          })
          .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
        setActive(onScreen.length ? onScreen[onScreen.length - 1].id : null);
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] }
    );
    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [ids, enabled, container]);

  return active;
}

const SECTION_IDS = SECTION_LINKS.map((l) => l.id);

export default function Navbar() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const isTripDetail = pathname.startsWith("/trip/");
  const isProfile = pathname === "/profile";
  /** Whether this route gets the full three-cell bar — wordmark │ links │ Profile — or the bare
   *  wordmark alone. The bare case is `/backend`, `/backend/pipeline`, `/bench`, and any unmatched
   *  URL: Next renders its built-in 404 *inside* the root layout, so this nav mounts there too.
   *  None of those has business carrying a user-facing profile link — two are internal dashboards
   *  over their own stone-50 ground, and the third is a dead end.
   *
   *  Still an explicit list of where the cells *belong*, and deliberately not `!isInternal`. The
   *  negation reads shorter and is wrong for exactly the reason the route table below already
   *  gives: a predicate that describes where something does *not* belong silently adopts every
   *  route added after it — the 404 included, which would get a Profile link on a dead end. This
   *  one only ever gains a route on purpose.
   *
   *  It gates both vertical rules and the trailing cell. What it no longer gates is whether there
   *  is anything to the right of the wordmark at all: `/profile` carries no outbound links and
   *  never will (`BackButton` is how you leave), but it does carry the Profile cell, marked as the
   *  current page. That is the whole point of the shape. The predecessor of this constant gated the
   *  wordmark's rule on there being links to divide from, which made `/profile` the one route
   *  rendering a bare strip while every sibling rendered a grid — the inconsistency this fixes. */
  const isUserFacing = isHome || pathname === "/trips" || isTripDetail || isProfile;
  // Focus goes back here when the menu closes. Without it, dismissing a full-screen panel with
  // Escape leaves focus on a node that is now `inert` — the caret vanishes and the next Tab
  // restarts from the top of the document.
  const toggleRef = useRef<HTMLButtonElement>(null);
  const container = useScrollContainer();
  const [menuOpen, setMenuOpen] = useState(false);
  const activeSection = useActiveSection(SECTION_IDS, pathname === "/");

  // Section links only exist on `/`, so there's nothing for the menu to hold — and
  // nothing to leave stuck open — on any other route. Reset during render rather
  // than in an effect: an effect would paint one frame of the stale-open menu first
  // (and React flags the cascading render). This is React's documented
  // adjust-state-on-prop-change pattern.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    setMenuOpen(false);
  }

  // Escape closes it, and that replaced a close-on-outside-tap listener rather than joining it.
  // The old one made sense for a dropdown: the page was still there beside the panel, and leaving
  // the menu open until some unrelated tap landed elsewhere was a worse default than closing.
  // Full-screen, **there is no outside** — every tap that is not the X or a row lands on the panel
  // itself, so the listener could only ever fire on the bar it excluded. Escape is what a surface
  // covering the viewport is expected to answer to, and the X is what a phone actually uses.
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  /**
   * The menu's own CTA. It closes and scrolls to the top, where the hero's "Plan a trip" is.
   *
   * It does not open the wizard directly, and that is a wiring fact rather than a choice about
   * behaviour: `onPlan` is local state in `HomeView`, and this component is mounted by `AppShell`
   * as a sibling of the content overlay, so there is nothing here to call. Reaching it needs the
   * same lifting the section-anchor gap above describes. Scrolling is honest in the meantime —
   * the button gets you to the thing it names in one tap.
   */
  function planFromMenu() {
    setMenuOpen(false);
    container?.current?.scrollTo({
      top: 0,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }

  function scrollToSection(e: React.MouseEvent, id: string) {
    e.preventDefault();
    setMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "start",
    });
  }

  return (
    <nav
      className={`glass-nav pointer-events-auto fixed inset-x-0 top-0 z-20 flex h-[var(--nav-h)] items-stretch ${
        menuOpen ? "is-menu-open" : ""
      }`}
    >
      {/* Mark then wordmark, which is the reference's own header arrangement. `gap-2.5` and
          `h-[1.1em]` size the mark off the wordmark rather than in pixels, so the two stay in
          proportion if the type step ever moves — and `LogoMark` fills `currentColor`, so it
          inherits `text-foreground` here and the focus colour on keyboard focus without a second
          rule. The mark is `aria-hidden`; the link's accessible name stays "TripMate" rather than
          becoming "graphic TripMate". */}
      {/* The wordmark is its own cell, ruled off from the links — the reference's arrangement, and
          the one division here that holds on every route. The rule is on this wrapper rather than
          on the Link so the Link keeps its own compact focus ring instead of the browser drawing a
          full-height rectangle around a 64px cell.

          The bar is `items-stretch` and owns no horizontal padding; the two cells carry the
          gutters instead. Both halves matter: a rule can only span the bar's full height if the
          box carrying it is that tall, and an `items-center` child stops at its own content —
          measured at 45px in a 65px bar, the same failure that left the profile split's rule
          ending halfway down the page. The cells re-centre their own content with `items-center`.

          Three cells now, which is the reference's own count. This used to say two, and defended
          it: the reference's third cell is a distinct "Explore" CTA, and walling off `Profile` — a
          peer nav link, preceded on `/trips` by `New trip` — would imply a CTA that isn't there.
          That argument mistook the rule for a CTA frame. It is the mirror of this one, and without
          it the bar is a grid drawn down a single side. Worse, its absence was the reason *this*
          rule had to be conditional: on `/profile`, which has no outbound links, there was nothing
          to divide from, so the rule was gated off and that one route rendered a bare strip while
          every sibling rendered a grid. The trailing cell holds whatever this route's single
          trailing control is — `Profile` everywhere, the menu toggle on `/` below `sm` — so it is
          never the padded empty box the links cell used to be on `/profile`. */}
      <div
        className={`flex items-center px-5 sm:px-6 ${
          isUserFacing ? "border-r border-card-border" : ""
        }`}
      >
        <Link
          href="/"
          className="inline-flex min-h-11 items-center gap-2.5 font-display text-xl font-semibold tracking-tight text-foreground focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"
        >
          <LogoMark className="h-[1.1em] w-[1.1em]" />
          TripMate
        </Link>
      </div>
      {/* The links, right-aligned against the trailing rule — the reference's are hard against its
          own third rule, and `justify-between` on the bar would centre this cell instead once it
          became the only flexible thing between two fixed ones.

          `grow`, not `flex-1`, for one edge case: `flex-1` sets `flex-basis: 0`, so this cell asks
          for the leftover space rather than for its content's width, and near 320px `New trip` gets
          squeezed toward min-content and wraps to two lines inside a 64px bar. `grow` starts from
          content width and only expands. Empty on `/profile` and on the dashboards, which costs
          nothing: with no content there is nothing for the padding to push, so both rules still
          land against real content on their outer side.

          No `gap` any more. The three route gates below are mutually exclusive — `/` vs `/trips` vs
          `/trip/*`, and `"/trips".startsWith("/trip/")` is false — and both of this cell's former
          trailing items (`Profile`, the toggle) now live in the trailing cell, so it holds at most
          one child on every route and the gap had nothing left to separate. `/`'s own group keeps
          its `gap-6`. */}
      <div className="flex grow items-center justify-end px-5 sm:px-6">
        {/* Section anchors + My memories, desktop: inline in the bar itself. On mobile all four
            destinations move into the panel below instead of one staying pinned in the bar beside
            the hamburger — a bar carrying "TripMate", a link, and an icon toggle for two more links
            was busier than the menu it was collapsing warranted. Three of the four are here;
            `Profile` is the fourth and comes from the trailing cell, which is also why it is the
            one item in this bar whose presence is a breakpoint question rather than a route one. */}
        {isHome && (
          <div className="hidden items-center gap-6 sm:flex">
            {SECTION_LINKS.map((link) => (
              <a
                key={link.id}
                href={`#${link.id}`}
                onClick={(e) => scrollToSection(e, link.id)}
                aria-current={activeSection === link.id ? "location" : undefined}
                className={navLink(activeSection === link.id)}
              >
                {link.label}
              </a>
            ))}
            <Link href="/trips" className={navLink()}>
              My memories
            </Link>
          </div>
        )}
        {pathname === "/trips" && (
          <Link href="/" className={navLink()}>
            New trip
          </Link>
        )}
        {isTripDetail && (
          <Link href="/trips" className={navLink()}>
            My memories
          </Link>
        )}
      </div>
      {isUserFacing && (
        /* The trailing cell, mirroring the wordmark's. It holds exactly one control at any width,
           never two and never none, and on `/` which one it holds is a breakpoint question:
           `MENU_ITEMS` already carries `Profile` into the full-screen panel, so below `sm` on `/`
           this cell showing it too would put the same destination in the bar and behind the toggle
           at once. Below `sm` on `/` this cell is the toggle; everywhere else, at every width, it
           is `Profile`. */
        <div className="flex items-center border-l border-card-border px-5 sm:px-6">
          {/* The breakpoint rides on a wrapper, and it has to. `navLinkBase` already sets
              `inline-flex`, and appending `hidden` to it does nothing: Tailwind emits the display
              utilities alphabetically — `.block`, `.flex`, `.hidden`, `.inline`, `.inline-flex` —
              so at equal specificity `.inline-flex` is the later rule and wins, and the link would
              stay visible at every width. Measured in this app's own compiled stylesheet (`.hidden`
              at byte 16947, `.inline-flex` at 17026), not assumed. Same trap `navLink`'s own doc
              comment describes for `text-foreground` vs `text-accent`, in a second property, and
              the same fix: emit exactly one utility for the property rather than two and a guess
              about order. `hidden`/`sm:flex` on a wrapper is what `/`'s desktop group above already
              does for this reason. */}
          <div className={isHome ? "hidden items-center sm:flex" : "flex items-center"}>
            {/* `aria-current="page"` and the accent colour together, never colour alone — the rule
                `navLink` states. `"page"` and not the `"location"` the section anchors carry: those
                mark a position within this document, this marks the document itself. It stays a
                `Link` rather than becoming inert text, so the bar's last tab stop exists on every
                route the bar is a grid on; a `span` here would make `/profile` the one route where
                the trailing cell is unreachable by keyboard, which is the same per-route
                inconsistency this cell exists to end. One accepted consequence: `hover:text-accent`
                is a no-op on the current page, so hover degrades from two signals to one — the
                underline survives, which is the half that was never colour-dependent. */}
            <Link
              href="/profile"
              aria-current={isProfile ? "page" : undefined}
              className={navLink(isProfile)}
            >
              Profile
            </Link>
          </div>
          {isHome && (
            <button
              ref={toggleRef}
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-controls="nav-menu"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              className="-mr-2 inline-flex min-h-11 min-w-11 items-center justify-center text-foreground focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none sm:hidden"
            >
              {/* A custom 3-bar mark rather than swapping lucide's Menu/X icons outright —
                  those two glyphs have no shared geometry to animate between, so swapping
                  them is always an instant cut. Three bars morphing into an X is one
                  continuous shape the whole time. */}
              <span className="relative flex h-4 w-5 flex-col justify-between">
                <span
                  className="h-0.5 w-full rounded-full bg-foreground transition-transform"
                  style={{
                    transitionDuration: "300ms",
                    transitionTimingFunction: MENU_EASE,
                    transform: menuOpen ? "translateY(7px) rotate(45deg)" : undefined,
                  }}
                />
                <span
                  className="h-0.5 w-full rounded-full bg-foreground transition-opacity duration-150"
                  style={{ opacity: menuOpen ? 0 : 1 }}
                />
                <span
                  className="h-0.5 w-full rounded-full bg-foreground transition-transform"
                  style={{
                    transitionDuration: "300ms",
                    transitionTimingFunction: MENU_EASE,
                    transform: menuOpen ? "translateY(-7px) rotate(-45deg)" : undefined,
                  }}
                />
              </span>
            </button>
          )}
        </div>
      )}
      {isHome && (
        /**
         * The menu, full-bleed below the bar.
         *
         * It was a dropdown as tall as its own content, with the CSS grid `0fr`/`1fr` trick
         * animating its height so that closing played a transition as well as opening. That trick
         * is retired here, not broken: once the panel *is* the viewport there is no height to
         * animate between, and `fixed inset-x-0 top-[var(--nav-h)] bottom-0` states the geometry
         * outright. Opacity and a 6px settle carry both directions instead, off the same
         * `MENU_EASE` as everything else in the app.
         *
         * `top-[var(--nav-h)]` rather than `inset-0`: the bar stays, holding the mark, the wordmark
         * and the toggle that is now an X — which is exactly the reference's arrangement, and means
         * the panel needs no header of its own. `.glass-nav.is-menu-open` turns the bar solid for
         * the duration so the two read as one field rather than a light strip over a dark one, and
         * `border-t` here is then the single divider under the row.
         *
         * **`inert` when closed, doing three jobs with one attribute:** out of the tab order, out of
         * the accessibility tree, and not hit-testable. It replaced `tabIndex={menuOpen ? 0 : -1}`
         * threaded through every row — correct, but per-row bookkeeping that a new row could forget,
         * and which said nothing about the panel being unreachable as a whole. `pointer-events-none`
         * rides along rather than trusting `inert` alone to stop a tap: an invisible full-viewport
         * surface swallowing taps meant for the page is the failure this project has already
         * documented, and one utility is cheaper than finding out.
         */
        <div
          id="nav-menu"
          inert={!menuOpen}
          className={`glass-nav-menu fixed inset-x-0 top-[var(--nav-h)] bottom-0 flex flex-col px-5 pt-12 pb-8 transition-[opacity,transform] duration-300 sm:hidden ${
            menuOpen
              ? "translate-y-0 opacity-100"
              : "pointer-events-none -translate-y-1.5 opacity-0"
          }`}
          style={{ transitionTimingFunction: MENU_EASE }}
        >
          {/* `ul`/`li`, matching the reference's own `header-nav` markup: this is a list of
              destinations and a screen reader should be told how many. No nested `nav` landmark —
              the element this sits inside is already one. */}
          <ul className="flex flex-col items-start gap-1">
            {MENU_ITEMS.map((item, index) => {
              const rowStyle: React.CSSProperties = {
                opacity: menuOpen ? 1 : 0,
                transform: menuOpen ? "translateY(0)" : "translateY(-6px)",
                transitionDelay: `${index * 60}ms`,
              };
              /* The `+` is the reference's and the footer's, at white/45 so it reads as a mark
                 rather than as part of the word, and `aria-hidden` so the accessible name stays
                 "Profile" and not "+Profile". */
              const plus = (
                <span
                  aria-hidden
                  className="text-white/45 transition-colors duration-150 group-hover:text-accent/60"
                >
                  +
                </span>
              );
              return (
                <li key={item.id}>
                  {item.kind === "anchor" ? (
                    <a
                      href={`#${item.id}`}
                      onClick={(e) => scrollToSection(e, item.id)}
                      aria-current={activeSection === item.id ? "location" : undefined}
                      style={rowStyle}
                      className={`${menuItem(activeSection === item.id)} transition-[opacity,transform,color] duration-300`}
                    >
                      {plus}
                      {item.label}
                    </a>
                  ) : (
                    <Link
                      href={item.href}
                      onClick={() => setMenuOpen(false)}
                      style={rowStyle}
                      className={`${menuItem()} transition-[opacity,transform,color] duration-300`}
                    >
                      {plus}
                      {item.label}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>

          {/* The floor. `mt-auto` rather than a bottom offset, so the button is pinned by the
              panel's own `pb-8` and the gap above it is whatever is left — which is the reference's
              arrangement, and which holds at any phone height without a magic number.

              The hero's CTA classes, minus its `shadow-lg shadow-black/30`. That shadow is doing
              real work there, lifting a white pill off a photograph; here the pill sits on a flat
              slate field, where a shadow would be decoration with nothing to separate it from.
              Full width is the reference's own `full-width-mobile` button variant. */}
          <button
            type="button"
            onClick={planFromMenu}
            style={{
              opacity: menuOpen ? 1 : 0,
              transitionDelay: `${MENU_ITEMS.length * 60}ms`,
            }}
            className="mt-auto inline-flex w-full items-center justify-center gap-4 rounded-full bg-white px-8 py-5 text-sm leading-[0.9] font-semibold tracking-[-0.0357em] text-accent-foreground transition-[opacity,background-color] duration-300 hover:bg-accent focus-visible:outline-2 focus-visible:outline-accent-foreground active:scale-[0.98]"
          >
            Plan a trip
            <ButtonMark />
          </button>
        </div>
      )}
    </nav>
  );
}
