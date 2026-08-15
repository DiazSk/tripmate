import type { Metadata } from "next";
import TripView from "./TripView";

/**
 * Server wrapper that exists only to carry this route's metadata.
 *
 * The App Router has no `head()` convention — that was the Pages Router, and `next/head` still
 * lives under `docs/02-pages/`. Metadata comes from a `metadata` export or `generateMetadata`,
 * and both are Server Component only, while the trip view is `"use client"` from top to bottom
 * (it owns fetches, camera state and the itinerary panel). So the segment splits in two: this
 * file for the head tags, TripView.tsx for everything that renders.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  // The trip itself is fetched client-side from SQLite via /api/trips/[id], so the destination
  // is not known here without duplicating that read on the server. Rather than fetch twice, the
  // title stays generic but route-specific — enough to distinguish a shared trip link from the
  // planner in a tab strip or a chat unfurl.
  const title =
    id === "preview" ? "Preview trip · TripMate" : "Your trip itinerary · TripMate";
  const description =
    "A day-by-day itinerary on a living globe — glowing stop markers, arcs between them, real weather and budget tracking.";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default function TripPage({ params }: { params: Promise<{ id: string }> }) {
  // Passed through unresolved — TripView unwraps it with React's `use`, so awaiting here would
  // only delay rendering the shell for nothing.
  return <TripView params={params} />;
}
