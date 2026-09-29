import type { Trip } from "../types";
import { loadExportFont } from "./exportFont";
import { collectExportMap } from "./exportMapData";
import { renderItineraryHtml } from "./itineraryHtml";

/**
 * One trip as a finished, self-contained HTML document.
 *
 * Lifted out of the export route the moment a second caller wanted it: `/s/[token]` serves a
 * shared trip as a *page* and `/api/trips/[id]/export` serves the same bytes as a *download*, and
 * those two differing by anything except a `Content-Disposition` header would mean the plan a
 * traveller sends is not the plan they kept a copy of.
 *
 * Both failure surfaces are swallowed downstream rather than here: `loadExportFont` falls back to
 * the system stack and `collectExportMap` returns null geometry, and the document is complete
 * without either. That is why this has no error path and returns a string rather than a result.
 */
export async function renderTripDocument(trip: Trip): Promise<string> {
  const [fonts, map] = await Promise.all([loadExportFont(), collectExportMap(trip)]);
  return renderItineraryHtml(trip, {
    fontDataUri: fonts.text,
    displayFontDataUri: fonts.display,
    map,
  });
}
