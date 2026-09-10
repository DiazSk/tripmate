import { NextResponse } from "next/server";
import { getTrip } from "@/lib/db";
import { loadExportFont } from "@/lib/export/exportFont";
import { collectExportMap } from "@/lib/export/exportMapData";
import { exportFilename, renderItineraryHtml } from "@/lib/export/itineraryHtml";
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

  const row = getTrip(id);
  if (!row) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  const trip = toTripDetail(row);

  // Map geometry is the only failure surface here and it swallows its own — an export with no map
  // is a complete document, so there is no error path to add.
  const [fonts, map] = await Promise.all([loadExportFont(), collectExportMap(trip)]);

  const html = renderItineraryHtml(trip, {
    fontDataUri: fonts.text,
    displayFontDataUri: fonts.display,
    map,
  });

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(trip.destination)}"`,
      "Cache-Control": "no-store",
    },
  });
}
