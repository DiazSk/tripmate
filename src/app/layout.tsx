import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { ClerkProvider } from "@clerk/nextjs";
import AppShell from "@/components/AppShell";
import { LlmTraceFabProvider } from "@/components/LlmTraceFab";
import { clerkClientConfigured } from "@/lib/clerkConfig";
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
 * Two faces, from the Polar Interior system on the canvas ("White Desert — Design Tokens").
 *
 * **Cormorant Garamond for display, Inter Tight for everything read or pressed.** Cormorant stands
 * in for the reference's Cardinal Classic Long, a commercial face; it keeps the high-contrast
 * didone voice — at weight 400 the thick-thin modulation does the work bold type would only fake —
 * and its italic carries the reference's kicker lines, so both cuts ship. Inter Tight is the
 * reference's own text face. Oswald, the reference's third face, sets the nav's wordmark on every
 * route and the full-width monuments the landing prints over its photographs.
 *
 * **Figures no longer have a face of their own.** Kiln preloaded a whole mono family for the
 * columns that compare values; Polar sets them in Inter Tight with tabular figures, which line up
 * just as well without a second register. `--font-mono` in globals.css now resolves to the text
 * face, so the five `font-mono` sites keep working unchanged.
 *
 * Self-hosted from `public/fonts` via `next/font/local`, not `next/font/google`, so a build never
 * reaches the network — the Latin variable files as Google Fonts serves them, both under the SIL
 * Open Font License, which permits self-hosting. Melodrama and Switzer stay in `public/fonts` for
 * the itinerary export, which inlines them and has not been redesigned yet.
 */
const displayFace = localFont({
  src: [
    { path: "../../public/fonts/cormorant-garamond-variable.woff2", style: "normal" },
    { path: "../../public/fonts/cormorant-garamond-italic-variable.woff2", style: "italic" },
  ],
  variable: "--font-display-stack",
  weight: "300 700",
  display: "swap",
});

const textFace = localFont({
  src: "../../public/fonts/inter-tight-variable.woff2",
  variable: "--font-sans-stack",
  weight: "100 900",
  display: "swap",
});

const monumentFace = localFont({
  src: "../../public/fonts/oswald-variable.woff2",
  variable: "--font-condensed-stack",
  weight: "200 700",
  display: "swap",
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
  "Day-by-day itineraries planned against your real dates: weather, public holidays, opening " +
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
  title: "TripMate: Plan your trip",
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "TripMate",
    title: "TripMate: Plan your trip",
    description: DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "TripMate: Plan your trip",
    description: DESCRIPTION,
  },
};

// Matches --canvas in globals.css. manifest.ts's own theme_color covers the installed app; this
// covers the browser chrome (address bar / status bar tint) before it's installed.
export const viewport: Viewport = {
  themeColor: "#090b10",
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
POLAR INTERIOR · supersedes KILN (direction seed 02f66ad0)

THESIS: A travel planner that shows you the real ground and the real price, set with the restraint
of an expedition outfitter rather than a dashboard. Kiln refused "one enormous word over a
mountain"; Polar takes that move on purpose, on photographs of real places, and keeps the first
viewport working: the word names the destination you are about to plan.

OWN-WORLD: Two appearances under one set of names. Polar Night (default, and everything over the
map): canvas #090B10, deep #0E1118, white type, night-text-2 #A8ACB3. Polar Light (opt-in per
screen, data-appearance="light"): ice #FFFFFF, paper #F3F1EC, ink #1F2A44, charcoal #535353.
Roles, each meaning one thing: signal #FF7E15 is action and only action, a fill with ink on it;
ember #A64C09 is action set as text on light; alert #D10F0F / #FF6B6B; money has no hue — tabular
figures in ink or white. Cormorant Garamond for display, Inter Tight for everything else, Oswald
for monuments. Nearly square: 2px controls, 6px cards — depth comes from blur over photography,
not from rounding.

THE WORLD ON THE GLOBE: unchanged. The five earth-pigment day pairs stay map-native and never
appear in a panel, chip or button; interface colour stays off the globe, with --accent marking a
hovered or selected stop as the one documented exception. Day 3's core (22.3deg) now sits inside
the accent's band (10-45deg), and emphasisColorFor swaps its hover tint to white.

MOTION: white-desert.com's vocabulary — scroll-scrubbed curtains, reveals on cubic-bezier(.16,1,.3,1),
expedition moves on (.76,0,.24,1) — and prefers-reduced-motion leaves the finished layout.

FINISH: unreviewed and undocumented is unfinished; each screen ends with its review and DESIGN.md.
-->`;

function Shell({ children }: { children: React.ReactNode }) {
  const app = (
    <>
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
    </>
  );
  return clerkClientConfigured() ? <ClerkProvider>{app}</ClerkProvider> : app;
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${displayFace.variable} ${textFace.variable} ${monumentFace.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        {/* Clerk's hooks and its middleware throw without keys, so the provider is only mounted
            when its publishable key exists (the secret is runtime-only and the layout is prerendered at
            build); without it the app runs anonymously and this is a bare body. */}
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
