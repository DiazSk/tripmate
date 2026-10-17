"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import LogoMark from "@/components/LogoMark";
import { prefersReducedMotion } from "@/lib/reducedMotion";
import { useScrollContainer } from "@/lib/scrollContainer";
import { requestPlan } from "@/lib/planIntent";
import { useHomeScreen } from "@/lib/homeScreen";

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
  { id: "day", label: "A day in Petra", kind: "anchor" as const },
  { id: "ways", label: "Four ways", kind: "anchor" as const },
  { id: "the-plan", label: "The plan", kind: "anchor" as const },
  { id: "plans", label: "More journeys", kind: "anchor" as const },
  { id: "knows", label: "What a plan knows", kind: "anchor" as const },
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
// Polar's display face, uppercase at weight 400 — the canvas menu's rows. Named through the stack
// variable rather than `font-display`, which in this file's cascade is the sans heading step.
const menuItemBase =
  "group inline-flex items-baseline gap-2 [font-family:var(--font-display-stack),ui-serif,Georgia,serif] text-[clamp(1.9rem,9vw,2.6rem)] leading-[1.05] font-normal uppercase tracking-[var(--tracking-display)] transition-colors duration-150 hover:text-accent focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none";

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
  "polar-chip inline-flex min-h-10 items-center text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/**
 * A Polar nav chip: its own small glass, so the bar needs no band behind it. Current carries
 * `aria-current` and the inverted fill together — the state is never colour alone.
 */
const navLink = (active = false) => `${navLinkBase}${active ? " is-current" : ""}`;

// Landing-only: three of the Polar landing's sections, in page order. All five made the bar crowded
// at every width, so it keeps the three that carry the page (the day, the plan behind it, the other
// journeys) and the phone menu and the landing's footer carry all five. Each carries the breakpoint
// it appears at (a wrapper class, since the chip's own `inline-flex` would outrank an appended
// `hidden`): the day from `sm`, the journeys from `md`, the plan from `lg`.
const SECTION_LINKS = [
  { id: "day", label: "A day in Petra", show: "sm:inline-flex" },
  { id: "the-plan", label: "The plan", show: "lg:inline-flex" },
  { id: "plans", label: "More journeys", show: "md:inline-flex" },
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
 * (step !== "landing"), `PolarLanding` is unmounted, the target ids don't exist, and a
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

/**
 * The two things white-desert.com's nav does on scroll, read off AppShell's content overlay (the
 * window never scrolls here).
 *
 * - **Theme.** Each band of a page can say what it is with `data-nav-theme="light" | "photo"`; the
 *   bar takes the theme of whichever band is under its middle, so its chips are ink over paper and
 *   white over a photograph. Pages that say nothing are dark, which is every page over the map.
 * - **Hide on the way down, return on the way up**, after the first 10px — the reference's
 *   `yPercent: -100` over 0.3s on sine. Reduced motion keeps the behaviour and drops the slide.
 *
 * One rAF-throttled scroll listener for both; state only changes when a value does.
 */
type NavTheme = "dark" | "light" | "photo";

function useNavChrome(pathname: string): { theme: NavTheme; hidden: boolean } {
  const container = useScrollContainer();
  // `/` opens on the landing's hero, so it starts on `photo`: a band flashing in for the frame
  // before the first read is exactly the seam this theme exists to remove.
  const [theme, setTheme] = useState<NavTheme>(pathname === "/" ? "photo" : "dark");
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const el = container?.current;
    if (!el) return;
    let last = el.scrollTop;
    let frame = 0;
    const read = () => {
      frame = 0;
      const y = el.scrollTop;
      if (y <= 10) setHidden(false);
      else if (y > last + 2) setHidden(true);
      else if (y < last - 2) setHidden(false);
      last = y;
      const mid = el.getBoundingClientRect().top + 28;
      let next: NavTheme = "dark";
      for (const band of el.querySelectorAll<HTMLElement>("[data-nav-theme]")) {
        const r = band.getBoundingClientRect();
        const t = band.dataset.navTheme;
        if (r.top <= mid && r.bottom > mid) next = t === "light" || t === "photo" ? t : "dark";
      }
      setTheme(next);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    // The first read waits a frame, so a route's bands exist and so no state is set during the
    // effect itself.
    frame = requestAnimationFrame(read);
    el.addEventListener("scroll", onScroll, { passive: true });
    // A band can change its own theme without a scroll: the landing's day story goes dark on its
    // night beat a moment after the scroll that reached it has already been read.
    const themes = new MutationObserver(onScroll);
    themes.observe(el, { subtree: true, attributeFilter: ["data-nav-theme"] });
    return () => {
      el.removeEventListener("scroll", onScroll);
      themes.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [container, pathname]);

  return { theme, hidden };
}

export default function Navbar() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const isTripDetail = pathname.startsWith("/trip/");
  const isProfile = pathname === "/profile";
  /* `/` is three screens, and each gets only what it needs. The landing: three of its sections,
     My memories, Profile and Plan a trip (the other two sections stay in the phone menu). The
     planner: My memories, the way out, and nothing else while a form is half filled in. A plan on
     the map: My memories and Profile. Section links, Plan a trip and the phone menu are landing-only
     because that is the only screen where their targets and their listener exist. */
  const screen = useHomeScreen();
  const onLanding = isHome && screen === "landing";
  const showProfile = !isHome || screen !== "plan";
  /* **There is no route predicate here any more, and that is the point.**
   *
   *  This used to be `isUserFacing = isHome || "/trips" || isTripDetail || isProfile`, gating both
   *  vertical rules and the trailing cell. Everything it excluded — `/offline`, `/backend`,
   *  `/backend/pipeline`, `/bench`, and the 404 Next renders inside this same layout — got a bare
   *  wordmark on an otherwise empty bar. Two bar *shapes* shipped, and the reasoning for the split
   *  (an internal dashboard has no business carrying a Profile link) was a content argument used to
   *  justify a structural one.
   *
   *  The content argument is still true and is answered by content: the middle cell is empty on
   *  those routes, because they have nowhere to navigate to. The frame does not change. A visitor
   *  carries the header between pages; it is the last component that should redraw itself
   *  underneath them, and a 404 in particular is the worst place to hand someone a different,
   *  smaller header than the one they arrived with — it is the page they most need a way out of.
   *
   *  The two dashboards are dev-only (they 404 in production), so the Profile link they now inherit
   *  is only ever seen by us. */
  // Focus goes back here when the menu closes. Without it, dismissing a full-screen panel with
  // Escape leaves focus on a node that is now `inert` — the caret vanishes and the next Tab
  // restarts from the top of the document.
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const activeSection = useActiveSection(SECTION_IDS, pathname === "/");
  const { theme, hidden } = useNavChrome(pathname);

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

  // The menu and its toggle are `sm:hidden`, so a phone menu left open when the window widens (a
  // rotated tablet, an unfolded phone, a resized split view) has nothing left to close it with:
  // the bar would keep `is-menu-open`'s solid ground. Close it the moment the wide query matches.
  useEffect(() => {
    if (!menuOpen) return;
    const wide = window.matchMedia("(min-width: 40rem)");
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setMenuOpen(false);
    };
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
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
    requestPlan();
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
      /* The Polar nav, on every route: no band, three columns — links, the wordmark, the trailing
         controls — and each link its own glass chip. `data-theme` is ink or white for whatever is
         under the bar (see `useNavTheme`); `is-hidden` is the reference's hide-on-scroll-down. */
      data-theme={theme}
      className={`polar-nav pointer-events-auto fixed inset-x-0 top-0 z-20 grid h-[var(--nav-h)] grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 sm:px-5 ${
        menuOpen ? "is-menu-open" : ""
      } ${hidden && !menuOpen ? "is-hidden" : ""}`}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {onLanding && (
          <div className="hidden items-center gap-1.5 sm:flex">
            {SECTION_LINKS.map((link) => (
              <span key={link.id} className={`hidden ${link.show}`}>
                <a
                  href={`#${link.id}`}
                  onClick={(e) => scrollToSection(e, link.id)}
                  aria-current={activeSection === link.id ? "location" : undefined}
                  className={navLink(activeSection === link.id)}
                >
                  {link.label}
                </a>
              </span>
            ))}
          </div>
        )}
        {pathname === "/trips" && (
          <Link href="/" className={navLink()}>
            New trip
          </Link>
        )}
        {(isTripDetail || isProfile) && (
          <Link href="/trips" className={navLink()}>
            My memories
          </Link>
        )}
      </div>

      {/* The wordmark, centred: the mark, then TRIPMATE in the condensed face — the reference's
          own header arrangement. `LogoMark` fills `currentColor`, so it follows the theme. */}
      <Link
        href="/"
        className="polar-wordmark inline-flex min-h-11 items-center gap-2 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <LogoMark className="h-[1.05em] w-[1.05em]" />
        TripMate
      </Link>

      <div className="flex items-center justify-end gap-1.5">
        {/* Breakpoints ride on wrappers: the chip's own `inline-flex` outranks an appended
            `hidden`, the trap the old bar's comments measured. */}
        {/* The landing's phone menu carries My memories; off the landing it is the bar's way out. */}
        {isHome && (
          <span className={onLanding ? "hidden sm:inline-flex" : "inline-flex"}>
            <Link href="/trips" className={navLink()}>
              My memories
            </Link>
          </span>
        )}
        {/* On a phone the landing moves Profile into the menu panel, where MENU_ITEMS carries it, and a
            plan on the map keeps the bar to My memories so the two chips do not crowd the wordmark. */}
        {showProfile && (
          <span className={isHome ? "hidden sm:inline-flex" : "inline-flex"}>
            <Link href="/profile" aria-current={isProfile ? "page" : undefined} className={navLink(isProfile)}>
              Profile
            </Link>
          </span>
        )}
        {/* The landing's one "Plan a trip" above the fold; the hero carries none. Visible on every width
            (owner ruling 2026-10-16, as the MagicPath design shows): a phone's first screen needs its
            call to action, so it sits beside the menu button rather than behind it. `.polar-nav-cta`
            trims its padding below `sm` to leave the centred wordmark room at 375px. */}
        {onLanding && (
          // planFromMenu, not requestPlan: it also closes the menu, which a pathname change would
          // otherwise be the only thing to do. `invisible` while the menu is open keeps the bar from
          // showing a second "Plan a trip" above the panel's own, without moving the wordmark.
          <button type="button" onClick={planFromMenu} className={`polar-nav-cta ${menuOpen ? "max-sm:invisible" : ""}`}>
            Plan a trip
          </button>
        )}
        {onLanding && (
          <button
            ref={toggleRef}
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="nav-menu"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className="polar-chip -mr-1 inline-flex min-h-11 min-w-11 items-center justify-center focus-visible:outline-2 focus-visible:outline-accent sm:hidden"
          >
            {/* Three bars morphing into an X: one continuous shape, where swapping two icons is a cut. */}
            <span className="relative flex h-3.5 w-4.5 flex-col justify-between">
              <span
                className="h-0.5 w-full rounded-full bg-current transition-transform"
                style={{
                  transitionDuration: "300ms",
                  transitionTimingFunction: MENU_EASE,
                  transform: menuOpen ? "translateY(6px) rotate(45deg)" : undefined,
                }}
              />
              <span className="h-0.5 w-full rounded-full bg-current transition-opacity duration-150" style={{ opacity: menuOpen ? 0 : 1 }} />
              <span
                className="h-0.5 w-full rounded-full bg-current transition-transform"
                style={{
                  transitionDuration: "300ms",
                  transitionTimingFunction: MENU_EASE,
                  transform: menuOpen ? "translateY(-6px) rotate(-45deg)" : undefined,
                }}
              />
            </span>
          </button>
        )}
      </div>
      {onLanding && (
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

              The nav's own Polar signal button, full width — the reference's `full-width-mobile`
              variant — and it opens the wizard through `requestPlan`. */}
          <button
            type="button"
            onClick={planFromMenu}
            style={{
              opacity: menuOpen ? 1 : 0,
              transitionDelay: `${MENU_ITEMS.length * 60}ms`,
            }}
            className="polar-nav-cta mt-auto w-full justify-center py-5 transition-[opacity,background-color] duration-300"
          >
            Plan a trip
          </button>
        </div>
      )}
    </nav>
  );
}
