import { NextResponse } from "next/server";
import { getTrip } from "@/lib/db";
import { collectExportPhotos } from "@/lib/export/exportPhotos";
import { loadExportFont } from "@/lib/export/exportFont";
import { exportFilename, renderItineraryHtml } from "@/lib/export/itineraryHtml";
import { toTripDetail } from "@/lib/tripPayload";

/**
 * The traveler's copy of one trip: a single self-contained .html file, drawn as a transit line,
 * that renders identically with no network.
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

  // Photos are the only failure surface here, and `collectExportPhotos` swallows its own — an
  // export with no imagery is a complete document, so there is no error path to add.
  const [photos, fontDataUri] = await Promise.all([collectExportPhotos(trip), loadExportFont()]);

  const html = renderItineraryHtml(trip, { photos, fontDataUri });

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(trip.destination)}"`,
      "Cache-Control": "no-store",
    },
  });
}
