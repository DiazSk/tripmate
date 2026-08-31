import type { Metadata, Viewport } from "next";
import { Archivo, Orbitron, Rajdhani } from "next/font/google";
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

/**
 * The second face, and the narrow exception to the one-face rule above: the day badges standing
 * on the globe, and nothing else in the product.
 *
 * The rule it breaks is real, so the boundary is drawn tightly. `.marker-day-label` is the only
 * selector allowed to reach this variable — it must never appear in a panel, a chip, a heading
 * or a button, for the same reason `--route-neon-*` must not: those labels are objects in the
 * *world*, drawn over aerial photography alongside the route geometry, not surfaces in the
 * interface. The globe already has its own colour palette on exactly that argument; this is the
 * typographic half of the same separation.
 *
 * Orbitron rather than Rajdhani/Exo/Space Grotesk because of what these labels actually contain:
 * "Day 1", uppercased and tracked out to 0.18em. Orbitron is a geometric, square-ish display
 * face that is genuinely poor at running text and excellent at four tracked-out characters over
 * a satellite image — which is the entire corpus it will ever set here. Two weights only (600
 * for the badge, 700 held in reserve), latin subset, so the exception costs one small woff2.
 */
const orbitron = Orbitron({
  variable: "--font-map-display",
  subsets: ["latin"],
  weight: ["600", "700"],
});

/**
 * The marker layer's working face: stop names and neighbouring place names — the two labels that
 * carry real words rather than a four-character readout.
 *
 * It exists because Orbitron cannot do this job. "Private car to Crawford Market" set in a square
 * geometric display face at 0.875rem is a wall, and the marker layer's whole decluttering budget
 * is measured in the horizontal pixels a name occupies (`MIN_SEPARATION_X_PX`). Rajdhani is the
 * answer to both: it is squarish and technical enough to belong beside Orbitron, and condensed
 * enough that a long stop name takes visibly less screen than Archivo did — so more names survive
 * the separation scan at the same zoom.
 *
 * Same boundary as Orbitron's: `--font-map-label` is reachable from the marker layer and nowhere
 * else in the product. See The One Face Rule in DESIGN.md.
 */
const rajdhani = Rajdhani({
  variable: "--font-map-label",
  subsets: ["latin"],
  weight: ["500", "600"],
});

export const metadata: Metadata = {
  title: "TripMate — Plan your trip",
  description: "AI-planned itineraries with real weather, budget tracking, and maps.",
};

// Matches --canvas in globals.css. manifest.ts's own theme_color covers the installed app; this
// covers the browser chrome (address bar / status bar tint) before it's installed.
export const viewport: Viewport = {
  themeColor: "#091b20",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${orbitron.variable} ${rajdhani.variable} h-full antialiased`}
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
