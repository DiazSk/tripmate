import type { Metadata, Viewport } from "next";
import { Archivo, Orbitron, Rajdhani } from "next/font/google";
import AppShell from "@/components/AppShell";
import { LlmTraceFabProvider } from "@/components/LlmTraceFab";
import "./globals.css";

/**
 * The trace viewer is a development tool: a fixed z-50 FAB on every route that opens the raw
 * prompt and raw model response. It stays gated because that is an information leak in front of
 * an actual traveller, whatever it looks like.
 *
 * It no longer carries the second visual language it used to. This comment used to read "drawn in
 * the light stone palette this design system replaced", and that was true — a white card with
 * stone borders floating over the dark product. It has since been moved onto the system's own
 * tokens (`glass-control`, `surface-deep`, `card-border`, tinted-on-dark status badges), because
 * `dev` is the mode the app is demoed in, and a light-mode panel in the corner of a demo is a
 * visible seam even when it is only ever seen by us.
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

/**
 * Where this deploy lives, for the absolute URLs Open Graph requires — a social crawler cannot
 * resolve `/opengraph-image.png`, it needs the origin in front of it.
 *
 * Env-driven rather than hardcoded because the same build serves localhost and Railway. Falling
 * back to localhost is deliberate: a wrong absolute URL in a share card is harder to notice than
 * a localhost one, which is obviously unset the first time anybody looks at a preview.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

const DESCRIPTION =
  "Day-by-day itineraries planned against your real dates — weather, public holidays, opening " +
  "hours and travel times checked before a single word is written.";

/**
 * `opengraph-image.png` sits beside this file and Next picks it up by convention, emitting
 * `og:image` and `twitter:image` for every route. It is a committed static render rather than an
 * `ImageResponse` route: this card never varies per request, and generating it at runtime would
 * mean shipping a font loader for a picture that is identical every time.
 *
 * `/trip/[id]` sets its own title and description on top of these; it inherits this image, which
 * is why its long-standing `twitter: { card: "summary_large_image" }` declaration finally has an
 * image behind it instead of rendering an empty card.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "TripMate — Plan your trip",
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "TripMate",
    title: "TripMate — Plan your trip",
    description: DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "TripMate — Plan your trip",
    description: DESCRIPTION,
  },
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
