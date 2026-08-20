"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bookmark, Compass, Sparkles, UserRound } from "lucide-react";
import { prefersReducedMotion } from "@/lib/reducedMotion";

// Same ease every other motion in this app already uses for a "smooth, not
// snappy" settle (--marker-transition, --scene-hover, the *-in keyframes).
const MENU_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

// One row shape for every item in the mobile menu, anchors and the routed link alike,
// so the disclosure panel can render and stagger them from a single list.
const MENU_ITEMS = [
  { id: "journey", label: "The Journey", icon: Compass, kind: "anchor" as const },
  { id: "how-it-works", label: "How It Works", icon: Sparkles, kind: "anchor" as const },
  { id: "trips", label: "My memories", icon: Bookmark, kind: "link" as const, href: "/trips" },
  { id: "profile", label: "Profile", icon: UserRound, kind: "link" as const, href: "/profile" },
];

const menuItemClass =
  "group flex min-h-11 items-center gap-3 rounded-xl px-3 text-base font-medium text-foreground transition-colors hover:bg-white/8 active:bg-white/12 focus-visible:bg-white/8 focus-visible:outline-none";

// Shared style for every link in the nav, aside from the wordmark — plain
// text-foreground, no hero-legible, since this bar is real glass, not bare canvas.
// The rule arrives on hover/focus rather than sitting under every item permanently. Four
// always-underlined items read as unstyled anchors, and the underline was carrying no
// information: everything in this bar is a link, so marking all of them marks none of them.
// The hover state keeps the affordance where it means something, and text-foreground →
// white on hover carries it for anyone who can't see the 1px rule.
const navLinkClass =
  "inline-flex min-h-11 items-center text-sm font-medium text-foreground decoration-white/60 underline-offset-4 transition-colors hover:text-white hover:underline focus-visible:rounded-sm focus-visible:underline focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none";

// Landing-only: the two beats worth a direct jump to. Deliberately excludes the final
// reveal section — naming it in a permanent nav item is exactly the shortcut that would
// undo the "uncover Plan a Trip only at the end" design the rest of the scroll story
// builds toward.
const SECTION_LINKS = [
  { id: "journey", label: "The Journey" },
  { id: "how-it-works", label: "How It Works" },
];

/**
 * The app's one top bar — fixed and blurred through the entire scroll on every route,
 * replacing the old plain-text wordmark that used to sit unblurred over the bare globe.
 * Also the one place "My memories"/"New trip" live now: both used to be scattered across
 * individual pages as bare-canvas links (HeroPoster's CTA row, page.tsx's plan step,
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
export default function Navbar() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const isTripDetail = pathname.startsWith("/trip/");
  const navRef = useRef<HTMLElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

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

  // Closes on an outside tap. A 2-item menu doesn't need a full focus-trap/modal
  // treatment, but leaving it open until the next unrelated tap lands somewhere else
  // on the page is a worse default than just closing it.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

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
      ref={navRef}
      className="glass-nav pointer-events-auto fixed inset-x-0 top-0 z-20 flex h-[var(--nav-h)] items-center justify-between px-5 sm:px-6"
    >
      <Link
        href="/"
        className="inline-flex min-h-11 items-center font-display text-xl font-semibold tracking-tight text-foreground focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"
      >
        TripMate
      </Link>
      <div className="flex items-center gap-4 sm:gap-6">
        {/* Section anchors + My memories, desktop: inline in the bar itself. On
            mobile all four move into the dropdown below instead of one staying
            pinned in the bar beside the hamburger — a bar carrying "TripMate",
            a link, and an icon toggle for two more links was busier than the
            96-item menu it was collapsing warranted. */}
        {isHome && (
          <div className="hidden items-center gap-6 sm:flex">
            {SECTION_LINKS.map((link) => (
              <a
                key={link.id}
                href={`#${link.id}`}
                onClick={(e) => scrollToSection(e, link.id)}
                className={navLinkClass}
              >
                {link.label}
              </a>
            ))}
            <Link href="/trips" className={navLinkClass}>
              My memories
            </Link>
            <Link href="/profile" className={navLinkClass}>
              Profile
            </Link>
          </div>
        )}
        {pathname === "/trips" && (
          <Link href="/" className={navLinkClass}>
            New trip
          </Link>
        )}
        {isTripDetail && (
          <Link href="/trips" className={navLinkClass}>
            My memories
          </Link>
        )}
        {/* Both user-facing routes that aren't `/` or `/profile` itself. Listed
            explicitly rather than as a `!isHome` catch-all so the internal /backend
            dashboards — which render this same nav — don't pick it up too. */}
        {(pathname === "/trips" || isTripDetail) && (
          <Link href="/profile" className={navLinkClass}>
            Profile
          </Link>
        )}
        {/* Section anchors, mobile: behind a hamburger instead of hidden outright.
            "My memories"/"New trip" above are never hidden — they're single always-
            visible links replacing what used to be always-visible canvas links, not
            secondary chrome, so they don't belong behind the toggle. */}
        {isHome && (
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
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
      {isHome && (
        // Stays mounted open or closed — only its track height animates (the CSS
        // grid 0fr/1fr auto-height trick) — so both opening AND closing play a
        // transition, instead of the panel just popping in and vanishing.
        <div
          className="absolute inset-x-0 top-full grid transition-[grid-template-rows] duration-300 sm:hidden"
          style={{ gridTemplateRows: menuOpen ? "1fr" : "0fr", transitionTimingFunction: MENU_EASE }}
        >
          <div className="glass-nav-menu overflow-hidden border-t border-card-border">
            <div className="flex flex-col gap-1 p-3">
              {MENU_ITEMS.map((item, index) => {
                const Icon = item.icon;
                const rowStyle: React.CSSProperties = {
                  opacity: menuOpen ? 1 : 0,
                  transform: menuOpen ? "translateY(0)" : "translateY(-6px)",
                  transitionDelay: `${index * 60}ms`,
                };
                return item.kind === "anchor" ? (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    onClick={(e) => scrollToSection(e, item.id)}
                    tabIndex={menuOpen ? 0 : -1}
                    style={rowStyle}
                    className={`${menuItemClass} transition-[opacity,transform,background-color] duration-300`}
                  >
                    <Icon size={18} className="text-muted transition-colors group-hover:text-foreground" />
                    {item.label}
                  </a>
                ) : (
                  <Link
                    key={item.id}
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    tabIndex={menuOpen ? 0 : -1}
                    style={rowStyle}
                    className={`${menuItemClass} transition-[opacity,transform,background-color] duration-300`}
                  >
                    <Icon size={18} className="text-muted transition-colors group-hover:text-foreground" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
