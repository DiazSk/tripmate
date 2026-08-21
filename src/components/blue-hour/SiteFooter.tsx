import Image from "next/image";
import Link from "next/link";

import { devLabel } from "@/lib/devInspector";

/**
 * The end of the page.
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
      className="pointer-events-auto border-t border-white/10 px-5 pt-16 pb-8 sm:px-6 sm:pt-24"
      {...devLabel("SiteFooter")}
    >
      {/* The closing image, which the footer was missing.
          The reference ends on a wide, short landscape banner under a scrim of its own base colour
          at 40% — not a full-bleed photo, and not an undimmed one. The scrim is what keeps it a
          closing note rather than a second hero competing with the poster directly above it, and
          it is the Darken-Never-Lighten Rule doing its job over arbitrary imagery.
          `aria-hidden` with an empty alt: this is atmosphere at the end of a page, and announcing
          it would interrupt a screen-reader user on their way to the navigation below. */}
      <div className="relative mb-16 aspect-[1200/280] w-full overflow-hidden">
        <Image
          src="/scenes/hero-dawn.jpg"
          alt=""
          aria-hidden
          fill
          sizes="100vw"
          className="object-cover object-center"
        />
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ background: "rgb(var(--surface-deep-rgb) / 0.4)" }}
        />
      </div>

      <div className="flex flex-col gap-12 lg:flex-row lg:items-start lg:justify-between lg:gap-16">
        <p className="text-2xl font-semibold tracking-[-0.106em] text-foreground">TripMate</p>

        <nav aria-label="Footer">
          <ul className="space-y-1">
            {LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="group inline-flex items-baseline text-[clamp(1.75rem,4vw,2.81rem)] font-semibold leading-[1.1] tracking-[-0.085em] text-foreground transition-colors duration-150 hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
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

        <div className="text-sm text-muted">
          <p>Plans priced against real dates.</p>
          <p className="mt-1 text-muted">Weather, holidays and opening hours included.</p>
        </div>
      </div>

      <div className="mt-16 flex flex-col gap-2 border-t border-white/10 pt-6 text-xs text-white/55 sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} TripMate</p>
        <p>Built with real data, not guesses.</p>
      </div>
    </footer>
  );
}
