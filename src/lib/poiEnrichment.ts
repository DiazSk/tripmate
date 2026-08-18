import { closedDaysFromOpeningHours, fetchPoiOsmTags } from "./poiDetails";
import { buildTravelLegs } from "./travelTime";
import { estimateVisitMinutes } from "./visitDuration";
import type { EnrichedPoi, PoiDetails, ReconcileNote, ReconciledTrip } from "./types";

/**
 * Step 4 — detail fetch for the traveler's SELECTED POIs only (never the whole candidate list).
 * Fails soft per POI: one POI that can't be resolved ships with unknown fields and `partial:
 * true` rather than failing the batch.
 */
export async function enrichSelectedPois(reconciled: ReconciledTrip): Promise<PoiDetails> {
  const notes: ReconcileNote[] = [];
  const selected = reconciled.selectedPois;

  // Only POIs with coordinates can be matched against OSM; custom entries typed by hand have
  // none yet, so they skip the lookup rather than dragging the whole query down.
  const locatable = selected.filter(
    (p): p is typeof p & { lat: number; lon: number } => p.lat !== null && p.lon !== null
  );
  const fetched = await fetchPoiOsmTags(locatable);
  const osmTags = fetched ?? {};

  if (fetched === null) {
    notes.push({
      field: "poiOpeningHours",
      status: "unavailable",
      detail: "Opening-hours lookup failed — verify hours before visiting.",
    });
  } else if (locatable.length > 0 && Object.keys(osmTags).length === 0) {
    notes.push({
      field: "poiOpeningHours",
      status: "unavailable",
      detail: "No opening hours on record for these places — verify hours before visiting.",
    });
  }

  const pois: EnrichedPoi[] = selected.map((poi) => {
    const tags = osmTags[poi.name];
    const openingHours = tags?.openingHours ?? null;
    const lat = poi.lat ?? tags?.lat ?? null;
    const lon = poi.lon ?? tags?.lon ?? null;

    return {
      name: poi.name,
      lat,
      lon,
      openingHours,
      closedDays: closedDaysFromOpeningHours(openingHours),
      visitMinutes: estimateVisitMinutes(poi.kinds),
      visitMinutesEstimated: true,
      partial: lat === null || openingHours === null,
    };
  });

  const partialCount = pois.filter((p) => p.partial).length;
  if (partialCount > 0) {
    notes.push({
      field: "poiDetails",
      status: "estimated",
      detail: `${partialCount} of ${pois.length} places have incomplete details.`,
    });
  }

  const routable = pois.filter(
    (p): p is EnrichedPoi & { lat: number; lon: number } => p.lat !== null && p.lon !== null
  );
  const travelLegs = buildTravelLegs(routable, reconciled.transportModes);
  if (routable.length < pois.length) {
    notes.push({
      field: "travelLegs",
      status: "estimated",
      detail: `${pois.length - routable.length} place(s) have no coordinates and are missing from travel times.`,
    });
  }

  return { pois, travelLegs, notes };
}
