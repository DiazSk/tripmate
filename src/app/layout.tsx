import type { Metadata } from "next";
import { Archivo } from "next/font/google";
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

/**
 * One face for the entire product — display, body, UI, the landing poster, all of it.
 *
 * It was three (Source Serif 4, Archivo, Manrope), and before that five. The cut to one is the
 * central move of the Vita-derived system: every bit of expression now comes from scale, weight
 * and negative tracking rather than from a second family. Three webfonts became one, which is
 * also the cheapest performance win on the page.
 *
 * What this deliberately gives up: Source Serif 4's italic was the app's voice on `/trip/[id]`
 * and `/trips`, and DESIGN.md defended it as the thing that separated "a real plan to look at"
 * from the marketing surface. That distinction is gone on purpose — landing and app now speak
 * once. Reversible in one commit if the itinerary views read worse for it.
 *
 * No `axes: ["wdth"]` any more. The width axis existed solely for `font-stretch: 125%` on the
 * poster, and widening a heavy grotesk was the single strongest template tell on the page.
 * Loading the axis with nothing using it would ship bytes for a property no rule sets.
 */
const archivo = Archivo({
  variable: "--font-sans-stack",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "900"],
});

export const metadata: Metadata = {
  title: "TripMate — Plan your trip",
  description: "AI-planned itineraries with real weather, budget tracking, and maps.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} h-full antialiased`}
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
