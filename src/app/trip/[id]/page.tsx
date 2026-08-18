import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTrip } from "@/lib/db";
import { toTripDetail } from "@/lib/tripPayload";
import TripView from "./TripView";

/**
 * Server half of `/trip/[id]`: reads the trip and renders the view with it already in hand.
 *
 * This file used to exist only to carry metadata, because the App Router has no `head()`
 * convention — that was the Pages Router, and `next/head` still lives under `docs/02-pages/`.
 * Metadata comes from a `metadata` export or `generateMetadata`, both Server Component only,
 * while the trip view is `"use client"` from top to bottom (it owns camera state, the itinerary
 * panel, and every edit). The split stays; what changed is that the server half now also does
 * the read, so the client half no longer fetches a row this component already had.
 *
 * `/trip/preview` is the one id with no database row — a hardcoded fixture, loaded client-side
 * by TripView so real trips never carry it in their bundle. It therefore skips the read here
 * rather than 404ing.
 */
export const dynamic = "force-dynamic";

const PREVIEW_ID = "preview";

const DESCRIPTION =
  "A day-by-day itinerary on a living globe — glowing stop markers, arcs between them, real weather and budget tracking.";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  // The title used to stay generic on the grounds that naming the destination would mean reading
  // the row twice. It no longer would — the page component below reads it either way — so a
  // shared link can finally say where it goes.
  const destination = id === PREVIEW_ID ? null : getTrip(id)?.destination;
  const title = destination
    ? `${destination} · TripMate`
    : id === PREVIEW_ID
      ? "Preview trip · TripMate"
      : "Your trip itinerary · TripMate";

  return {
    title,
    description: DESCRIPTION,
    openGraph: { title, description: DESCRIPTION, type: "website" },
    twitter: { card: "summary_large_image", title, description: DESCRIPTION },
  };
}

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (id === PREVIEW_ID) return <TripView id={id} initialTrip={null} />;

  const row = getTrip(id);
  // `notFound()` rather than a rendered message: an unknown id is a genuinely missing resource,
  // and routing it through not-found.tsx also gets the 404 status the old client-side error
  // state could never set.
  if (!row) notFound();

  return <TripView id={id} initialTrip={toTripDetail(row)} />;
}
