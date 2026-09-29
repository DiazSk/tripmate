import { NextResponse } from "next/server";
import { exportFilename } from "@/lib/export/itineraryHtml";
import { renderTripDocument } from "@/lib/export/tripDocument";
import { readOwnTrip } from "@/lib/ownerRequest";
import { toTripDetail } from "@/lib/tripPayload";

/**
 * The traveler's copy of one trip: a single self-contained .html file — a map of the trip over the
 * day it belongs to — that renders identically with no network.
 *
 * Distinct from `/trip/[id]/print`, which is a reviewer document — it labels every stop
 * "Day 2 · Stop 3" for bug reports and ends with critique questions. That route keeps its job.
 *
 * `force-dynamic` because the itinerary is edited in place and a cached export would hand the
 * traveler a plan they have already changed.
 */
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Owner-only. This hands back the entire trip as a document, so leaving it open while the page
  // beside it was gated would have made the gate decorative.
  const row = await readOwnTrip(id);
  if (!row) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  const trip = toTripDetail(row);
  // Shared with `/s/[token]`, which serves these same bytes as a page rather than a download.
  const html = await renderTripDocument(trip);

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(trip.destination)}"`,
      "Cache-Control": "no-store",
    },
  });
}
