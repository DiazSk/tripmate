import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
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
 * Three faces, each with exactly one job — and, unlike the set they replace, chosen rather than
 * arrived at.
 *
 * Wix Madefor Display / Text / Sometype Mono got here by elimination: avoid the training-default
 * faces, avoid Geist because Vercel was the named craft bar, ship. Competent, and it read as
 * well-made SaaS. The bar is now luxury travel and quiet-luxury retail, and that is a different
 * problem — one these faces could not solve by being set better.
 *
 * **The mechanism is contrast in the face, not weight in the type.** A bold grotesk is loud; a
 * light didone is expensive. Melodrama carries high thick-to-thin modulation at weight 400, which
 * is the couture move and the thing no amount of extra weight buys. Everything dense stays in a
 * neutral grotesk, because a display serif in a day row is a costume.
 *
 * Self-hosted from `public/fonts` via `next/font/local`, not `next/font/google` — these are
 * Fontshare faces (Indian Type Foundry). Licence checked directly before committing them: free for
 * personal and commercial use, self-hosting explicitly permitted.
 *
 * **Payload went down, not up.** Three variable files totalling 108KB, against roughly 115KB for
 * the three Google families they replace — and the single Archivo file still committed for the
 * export is 90KB on its own.
 */
const displayFace = localFont({
  src: "../../public/fonts/melodrama-variable.woff2",
  variable: "--font-display-stack",
  weight: "300 700",
  display: "swap",
});

const textFace = localFont({
  src: "../../public/fonts/switzer-variable.woff2",
  variable: "--font-sans-stack",
  weight: "100 900",
  display: "swap",
});

/**
 * Figures, and only in a column.
 *
 * This is the rule that changed. The previous system said "mono for every figure" and a census
 * found it honoured in about a quarter of cases: 5 of 19 money renders, and **no date, time,
 * duration or temperature anywhere**. A whole variable family was being preloaded on every route
 * for eight spans.
 *
 * So the rule is narrower and now actually true: **tabular mono where values are compared** — the
 * dl columns, the stop-time gutter, the day totals, the budget readout. A price a visitor is meant
 * to feel rather than compare is set in the display face at display scale, which is what a menu or
 * a lot listing does and what a monospace can never do. Never prose.
 */
const monoFace = localFont({
  src: "../../public/fonts/tabular-variable.woff2",
  variable: "--font-mono-stack",
  weight: "300 700",
  display: "swap",
  // Five sites: the dl columns, the stop-time gutter, the day totals, the budget readout, and the
  // how-it-works step numbers. Only the last is on a landing route, and it is in the third band —
  // so the face is still fetched there, just not in the preload that competes with the hero
  // photograph and the two faces the first viewport actually paints.
  preload: false,
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
