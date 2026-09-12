import { closedDaysFromOpeningHours, fetchPoiOsmTags } from "./poiDetails";
import { buildTravelLegs } from "./travelTime";
import { applyRealRoutes } from "./osrmRoute";
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
      wheelchair: tags?.wheelchair ?? null,
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
  const estimatedLegs = buildTravelLegs(routable, reconciled.transportModes);
  if (routable.length < pois.length) {
    notes.push({
      field: "travelLegs",
      status: "estimated",
      detail: `${pois.length - routable.length} place(s) have no coordinates and are missing from travel times.`,
    });
  }

  // Measure whatever OSRM can reach, and leave the rest as the estimate they already are. Fails
  // soft twice over: `applyRealRoutes` returns every leg it was given whatever happens upstream,
  // and a throw here degrades to the estimate rather than failing the whole enrichment.
  let travelLegs = estimatedLegs;
  let routed = 0;
  let routableLegs = 0;
  try {
    ({ legs: travelLegs, routed, routable: routableLegs } = await applyRealRoutes(
      estimatedLegs,
      new Map(routable.map((p) => [p.name, { lat: p.lat, lon: p.lon }]))
    ));
  } catch (err) {
    console.error("[poiEnrichment] leg routing failed", err);
  }

  // The note lives here rather than in `reconcile.ts` for a plain reason: travel legs do not exist
  // at reconcile time, they are built in this step, and this function already owns the other note
  // about them ten lines up.
  //
  // A partial result gets a note saying so rather than being reported as a failure, because with
  // the default modes it *is* the normal outcome — `pickMode` sends anything past 1.5km to transit
  // and nothing routes transit, so a typical city day comes back with its short hops measured and
  // its long ones estimated. An all-transit leg set produces no note at all: nothing failed.
  if (routableLegs > 0) {
    if (routed === routableLegs) {
      notes.push({
        field: "travelLegs",
        status: "ok",
        detail: "Travel times are real road-network routes.",
      });
    } else if (routed > 0) {
      notes.push({
        field: "travelLegs",
        status: "estimated",
        detail: `${routed} of ${routableLegs} travel times are real road-network routes; the rest are straight-line estimates.`,
      });
    } else {
      notes.push({
        field: "travelLegs",
        status: "estimated",
        detail:
          "Routing unavailable — travel times are straight-line distance with a road-circuity correction.",
      });
    }
  }

  return { pois, travelLegs, notes };
}
