import type { Metadata, Viewport } from "next";
import { Sometype_Mono, Wix_Madefor_Display, Wix_Madefor_Text } from "next/font/google";
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
 * Three faces, each with exactly one job.
 *
 * This is a deliberate reversal. The system this replaces ran on **one** face (Archivo) for
 * display, body, UI and poster alike, and reached every other register through scale, weight and
 * negative tracking — a move it had adopted wholesale from an external reference. Collapsing to
 * one face is a real and defensible strategy; it was not, here, *this project's* strategy, and
 * the thing it cost was the one register this product most needs to get right: a figure.
 *
 * A trip plan is mostly numbers — times, durations, distances, per-stop costs, day totals,
 * a budget against a target. Thirty-six sites across twelve files already carried
 * `tabular-nums` before a monospace face existed, which is the codebase saying out loud that it
 * wanted one. Proportional tabular figures line up; they do not *read* as a readout, and a
 * column of prices in the same face as the prose beside it is a column you have to look for.
 *
 * So: --font-display sets headings and the hero, --font-sans sets everything read as prose or
 * operated as a control, --font-mono sets every figure. Bridged into Tailwind in globals.css's
 * `@theme inline` block, so `font-display` / `font-sans` / `font-mono` are ordinary utilities.
 *
 * Cost is close to flat despite going from one family to three: none of these pass a `weight`
 * array, so next/font fetches the **variable** file — one request per family. The outgoing
 * Archivo declared five static weights and therefore fetched five files.
 */
const displayFace = Wix_Madefor_Display({
  variable: "--font-display-stack",
  subsets: ["latin"],
});

const textFace = Wix_Madefor_Text({
  variable: "--font-sans-stack",
  subsets: ["latin"],
});

/**
 * Figures only, and the reason it is a *warm* mono rather than a neutral one: it sits inches from
 * Wix Madefor's text on the same card, and a cold grotesque mono beside a warm humanist text face
 * reads as a paste-in from another document. Sometype Mono is drawn with enough humanist warmth to
 * belong to the same page while still holding a column.
 *
 * Never set prose in this. A "why we chose this stop" sentence in monospace is a receipt.
 */
const monoFace = Sometype_Mono({
  variable: "--font-mono-stack",
  subsets: ["latin"],
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
  themeColor: "#121110",
};

/**
 * The direction contract for this visual system, emitted as a real HTML comment in the served
 * markup rather than left as a JSX comment.
 *
 * The distinction is the whole point: JSX comments are compiled away, so a contract written as one
 * exists in the repo and the source map and nowhere a running page can be audited against. This is
 * the record of what was decided, in a place where anyone can check the shipped thing against it.
 * `grep 02f66ad0` over the built output is the audit.
 */
const DIRECTION_CONTRACT = `<!--
KILN · direction seed 02f66ad0

THESIS: A travel planner that shows you the real ground and the real price at the finish level of a
shipped consumer product. It refuses the awwwards move of one enormous word posing over a stock
mountain; the first viewport does work.

OWN-WORLD: Warm near-neutral near-black (#121110), card #1C1A18, warm off-white type. Three named
roles, each meaning one thing: jade #28B981 action, gold #E9B44C money, coral #E4553F alert. Wix
Madefor Display / Text with Sometype Mono for every figure. Round what you touch, square what you
read — pills on controls, 5-8px on surfaces. One light surface in the whole product: the hero's
entry capsule.

THE WORLD ON THE GLOBE: three faces, no exceptions. Orbitron and Rajdhani are gone, and so is the
five-hue neon route ramp they belonged to — a finish review named them a surviving foreign register
on the product's core screen and the user funded the re-derivation. The day ramp is now five earth
pigments (--route-day-1..5) at a tight luminance band, none of which falls inside the accent's hue
band, and the day badge is printed rather than lit: no coloured bloom, no inner glow, one offset
shadow. Route colour is still map-native and still must never appear in a panel, chip or button;
interface colour still stays off the globe, with --accent marking a hovered or selected stop as the
one documented exception.

STORY: The visitor sees a real place, understands within seconds that this plans a costed
day-by-day trip against real weather, and starts entering their trip without leaving the first
viewport.

FIRST VIEWPORT: One full-bleed photograph on a scroll parallax, a two-line proposition, and a
destination-plus-dates capsule that opens the wizard already filled in.

FORM: The category standard, taken as the standing exit from direction seed 02f66ad0, executed at
the craft level of Airbnb and Vercel.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the
verdict, and DESIGN.md.
-->`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${displayFace.variable} ${textFace.variable} ${monoFace.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        {/* The direction contract — see DIRECTION_CONTRACT above. Emitted as a real HTML
            comment so it can be audited in the served page, not just in source. */}
        <div hidden dangerouslySetInnerHTML={{ __html: DIRECTION_CONTRACT }} />
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
