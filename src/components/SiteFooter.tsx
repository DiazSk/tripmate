import Image from "next/image";
import Link from "next/link";

import { devLabel } from "@/lib/devInspector";

/**
 * The end of the page — on every scrolling, user-facing surface: the landing, `/trips` and
 * `/profile`. It lived in `blue-hour/` while the landing was its only caller; it takes no props
 * and knows nothing about a scene, so being there was only ever about who imported it.
 *
 * The two links stay plain on the route they point at, rather than picking up the
 * `aria-current="page"` treatment the navbar's Profile link carries. A footer is a list of
 * destinations, not a position indicator, and marking one would mean turning this into a client
 * component for `usePathname()` — which would also drag `new Date().getFullYear()` below into
 * hydration, where it is currently a server render with no mismatch to worry about.
 *
 * The landing used to stop on the poster CTA, which leaves a visitor who did not click it with
 * nowhere to go but back. The reference treats its footer as a section rather than a legal strip:
 * navigation set larger than most sites' headings, then a thin bar for the small print.
 *
 * The `+` prefix is the reference's, and it is doing a real job — at 2.81rem a bare word reads as a
 * heading, and the prefix is what marks it as something to press. It is set at white/30 so it
 * registers as a mark rather than as part of the word, and it is `aria-hidden` so the link's
 * accessible name stays "Coaches", not "+Coaches".
 */

const LINKS = [
  { href: "/trips", label: "Memories" },
  { href: "/profile", label: "Profile" },
];

export default function SiteFooter() {
  return (
    <footer
      className="scene-band has-rule pointer-events-auto pt-16 pb-8 sm:pt-24"
      {...devLabel("SiteFooter")}
    >
      {/* The closing image, which the footer was missing.
          The reference ends on a wide, short landscape banner under a scrim of its own base colour
          at 40% — not a full-bleed photo, and not an undimmed one. The scrim is what keeps it a
          closing note rather than a second hero competing with the poster directly above it, and
          it is the Darken-Never-Lighten Rule doing its job over arbitrary imagery.
          `aria-hidden` with an empty alt: this is atmosphere at the end of a page, and announcing
          it would interrupt a screen-reader user on their way to the navigation below. */}
      {/* **Re-sourced 2026-09-09, for provenance rather than for looks.** The outgoing frame was
          Santa Maddalena in Val di Funes and it was a fine picture; what it had no record of was
          where it came from. The only reference to `footer_scenic.webp` anywhere in the repo was
          the `src` below, so it could not be re-cropped, re-encoded, or shown to be licensed —
          the failure `planExamples.ts` documents learning the expensive way.

          The replacement is the Engadin from above: golden larches on both slopes, a lakeside
          town, the valley receding to snow. Two reasons it is the better closing note. It
          *recedes* — a page about going somewhere should end on distance rather than on a wall of
          mountain — and it is 4:3 at source, so the 4.29:1 banner is a deliberate band cut out of
          a landscape rather than a squeeze. Also, deliberately not the Tuscan dawn that beat it on
          pure looks: Vernazza already opens `ImageRow` and Val d'Orcia is the first plan card, and
          a third Italian landscape on a page claiming "anywhere you can name" argues the other way.

          Pexels 34451716 (Oskar Gross), 4024x3018 source. The licence permits commercial use
          without attribution, so nothing renders that name — it is here so the next person can
          find the original. */}
      <div className="footer-banner-frame relative mb-16 aspect-[1200/280] w-full overflow-hidden">
        <Image
          src="/scenes/graubunden-autumn-valley.webp"
          alt=""
          aria-hidden
          fill
          sizes="100vw"
          className="footer-banner object-cover object-center"
        />
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ background: "rgb(var(--surface-deep-rgb) / 0.4)" }}
        />
      </div>

      {/* The banner carries `footer-banner`, not `footer-rise`, and the difference is the whole
          reason it can be animated at all: `footer-rise` translates, and translating a full-bleed
          element pulls it off the page edge. The banner instead scales *inside* its own
          `overflow-hidden` frame, so the crop opens while the frame's gutters never move.

          **`footer-copy` is what the timeline keys off, and it exists because keying off the
          footer did not work.** The footer is ~680px tall and the banner plus its margin take the
          top ~344px of that, so by the time this type scrolled into view the footer's own `entry`
          range was long finished and every part was already at rest. The animation was running
          and nobody could see it. Bound to this group instead, `entry` means "the words are
          arriving", which is the thing being animated. */}
      <div className="footer-copy">
      <div className="flex flex-col gap-12 lg:flex-row lg:items-start lg:justify-between lg:gap-16">
        <p className="footer-rise text-2xl font-semibold tracking-[var(--tracking-heading)] text-foreground">
          TripMate
        </p>

        <nav aria-label="Footer" className="footer-rise" style={{ "--rise-step": "9%" } as React.CSSProperties}>
          <ul className="space-y-1">
            {LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="group inline-flex items-baseline text-[clamp(1.75rem,4vw,2.81rem)] font-semibold leading-[1.1] tracking-[var(--tracking-display)] text-foreground transition-colors duration-150 hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                >
                  <span aria-hidden className="text-white/45 transition-colors duration-150 group-hover:text-accent/60">
                    +
                  </span>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="footer-rise text-sm text-muted" style={{ "--rise-step": "18%" } as React.CSSProperties}>
          <p>Plans priced against real dates.</p>
          <p className="mt-1 text-muted">Weather, holidays and opening hours included.</p>
        </div>
      </div>

      <div
        className="footer-rise mt-16 flex flex-col gap-2 border-t border-white/10 pt-6 text-xs text-white/55 sm:flex-row sm:items-center sm:justify-between"
        style={{ "--rise-step": "27%" } as React.CSSProperties}
      >
        <p>© {new Date().getFullYear()} TripMate</p>
        <p>Built with real data, not guesses.</p>
      </div>
      </div>
    </footer>
  );
}
