import type { Metadata } from "next";
import { Archivo, Source_Serif_4, Manrope } from "next/font/google";
import AppShell from "@/components/AppShell";
import { LlmTraceFabProvider } from "@/components/LlmTraceFab";
import "./globals.css";

/**
 * The trace viewer is a development tool: a fixed z-50 FAB on every route that
 * opens the raw prompt and raw model response, drawn in the light stone palette
 * this design system replaced. Useful while building, and both a second visual
 * language and an information leak in front of an actual traveller.
 */
const SHOW_LLM_TRACES = process.env.NODE_ENV === "development";

// The one display face, everywhere — page titles, card headings, and (in italic) the Blue
// Hour scene's own headlines, which used to be Playfair Display. The italic style is loaded
// explicitly rather than left to the browser: a synthesised oblique is a sheared upright, not
// a drawn italic, and the scene's headlines are set large enough to show it.
const sourceSerif = Source_Serif_4({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
});

// The landing headline only — everything else keeps Source Serif 4 or the system sans.
// `axes: ["wdth"]` is load-bearing: Archivo's width axis is what makes it *wide* rather
// than merely bold, and without the axis loaded `font-stretch: 125%` in .font-hero is a
// silent no-op (browsers don't synthesise width).
const archivo = Archivo({
  variable: "--font-hero",
  subsets: ["latin"],
  axes: ["wdth"],
});

// The body/UI face for the whole app — wired to Tailwind's `--font-sans` in globals.css's
// `@theme`, so every unstyled run of text is Manrope rather than whatever sans the OS
// happens to ship. It arrived as a Blue Hour scene font (`--font-scene-body`) and was
// promoted when the app cut from five faces to two: a platform default is not a typographic
// choice, and having one face carry every label, figure and control is what lets the serif
// and the poster read as decisions.
//
// Playfair Display was the third face, the scene's italic display voice. It is gone: Source
// Serif 4's italic does the same job, and two high-contrast serifs splitting the display role
// by route was the clearest of the reasons the landing and the app read as different products.
const manrope = Manrope({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "TripMate — Plan your trip",
  description: "AI-planned itineraries with real weather, budget tracking, and maps.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sourceSerif.variable} ${archivo.variable} ${manrope.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        {SHOW_LLM_TRACES ? (
          <LlmTraceFabProvider>
            <AppShell>{children}</AppShell>
          </LlmTraceFabProvider>
        ) : (
          <AppShell>{children}</AppShell>
        )}
      </body>
    </html>
  );
}
