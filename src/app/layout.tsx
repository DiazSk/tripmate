import type { Metadata } from "next";
import { Archivo, Source_Serif_4 } from "next/font/google";
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

const sourceSerif = Source_Serif_4({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
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

export const metadata: Metadata = {
  title: "TripMate — Plan your trip",
  description: "AI-planned itineraries with real weather, budget tracking, and maps.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sourceSerif.variable} ${archivo.variable} h-full antialiased`}>
      <body className="min-h-full">
        {SHOW_LLM_TRACES ? (
          <LlmTraceFabProvider>
            <AppShell>{children}</AppShell>
          </LlmTraceFabProvider>
        ) : (
          <AppShell>{children}</AppShell>
        )}
      {/* impeccable-live-start */}
<script src="http://localhost:8400/live.js?token=f341fc43-efb4-4e49-9d34-7b25f203cc5d"></script>
{/* impeccable-live-end */}
</body>
    </html>
  );
}
