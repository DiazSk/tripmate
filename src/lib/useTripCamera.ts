"use client";

import { useCallback, useState } from "react";
import { useMapCamera } from "./mapCamera";
import { geocodeDestination } from "./weather";
import { PlaceDetail, Stop } from "./types";

export type GeocodeOutcome = "found" | "missed" | "unreachable";

export function useTripCamera(destination: string, tripId?: string) {
  const {
    flyToDestination,
    flyToPlace,
    showHighways,
    showCityContext,
    setActiveStop,
    reframeRoute,
  } = useMapCamera();
  const [destinationCoords, setDestinationCoords] = useState<{
    lat: number;
    lon: number;
    name: string;
  } | null>(null);
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null);
  const [detail, setDetail] = useState<PlaceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  /**
   * Geocodes `name` and records the coordinates (closeDetail flies back to them). `fly`
   * additionally moves the camera there — pass `false` when an itinerary is about to frame
   * its own route, since the geocode resolves a few hundred ms later and would otherwise
   * land second and clobber the better framing with a visible double flight.
   *
   * Returns `"found"`, `"missed"` or `"unreachable"`. Three outcomes rather than a
   * nullable result because a miss and a dropped connection need different words on
   * screen: collapsing both to null meant a network failure was reported to the user
   * as "we couldn't find that place", which is a claim about their typing.
   *
   * The home page calls this from the destination field's blur handler, where an empty
   * string or a thrown fetch is routine rather than exceptional — hence the guard and
   * the catch here rather than at that one call site.
   */
  const flyToDestinationByName = useCallback(
    async (name: string, fly = true): Promise<GeocodeOutcome> => {
      if (!name.trim()) return "missed";
      let geo: Awaited<ReturnType<typeof geocodeDestination>>;
      try {
        geo = await geocodeDestination(name);
      } catch {
        return "unreachable";
      }
      if (!geo) return "missed";
      setDestinationCoords(geo);
      // Independent of `fly`: highways are ambient map context for wherever the trip's
      // destination turns out to be, not tied to whether the camera itself flies there (a
      // saved trip with stops already frames its own day route and skips the flight).
      showHighways(geo.lat, geo.lon);
      // Same independence as the highways, and for the same reason: the outline and the towns
      // around it are ambient context for wherever the destination turns out to be, not tied to
      // whether the camera flies there.
      showCityContext(geo.lat, geo.lon, geo.name);
      if (fly) flyToDestination(geo.lat, geo.lon, geo.name);
      return "found";
    },
    [flyToDestination, showHighways, showCityContext]
  );

  /** Same as flyToDestinationByName, but for callers (e.g. an autocomplete suggestion) that
   *  already know the coordinates — skips the redundant re-geocode round-trip. */
  const flyToDestinationByCoords = useCallback(
    (lat: number, lon: number, name: string) => {
      setDestinationCoords({ lat, lon, name });
      showHighways(lat, lon);
      showCityContext(lat, lon, name);
      flyToDestination(lat, lon, name);
    },
    [flyToDestination, showHighways, showCityContext]
  );

  const selectStop = useCallback(
    async (stop: Stop) => {
      setSelectedStop(stop);
      // Mark it selected on the globe as well, which a click on the *marker* has always done
      // (StopMarkerLayer sets the index directly) and a click on the itinerary row never did.
      // Three things ran off that and all three were quietly missing from this path: the row
      // stayed lit only while the pointer was on it, the stop's marker and the arcs touching it
      // took no emphasis, and the day/night tint reverted to daylight the moment the pointer
      // left the row — so opening an 8:45pm stop from the list put the city back in daylight.
      setActiveStop(stop);
      // No label, so no red pin — the same call StopMarkerLayer already makes when a stop's card
      // is clicked on the globe, and for the reason recorded there: the card names the place, so a
      // pin plus a Cesium label plus a card is one place labelled three times. This path passed
      // `stop.name` and got all three.
      //
      // Safe only because of the declutter promotion in StopMarkerLayer: the card *is* the label
      // now, and before that promotion the selected stop routinely lost it to a co-located
      // neighbour — clicking "Crawford Market" left "Private car to Crawford Market" holding the
      // only card on screen, so removing the pin here on its own would have replaced a duplicate
      // label with a wrong one. Don't split these two changes.
      //
      // Clearing rather than moving the pin is the intended behaviour of a labelless flight (see
      // `flyTo`), and it is what a marker click has always done. A destination pin comes back on
      // the way out: `closeDetail` flies to `destinationCoords` with its name.
      flyToPlace(stop.lat, stop.lng);
      setDetail(null);
      setDetailError(null);
      setDetailLoading(true);
      try {
        const res = await fetch("/api/place-detail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: stop.name,
            destination,
            lat: stop.lat,
            lng: stop.lng,
            tripId,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setDetail(data.detail);
      } catch (e) {
        setDetailError(
          e instanceof Error && e.message
            ? e.message
            : `We couldn't look up ${stop.name}. Reopening it will try again.`
        );
      } finally {
        setDetailLoading(false);
      }
    },
    [flyToPlace, setActiveStop, destination, tripId]
  );

  const closeDetail = useCallback(() => {
    setSelectedStop(null);
    // Back to the day that is drawn, not out to the city. Flying to `destinationCoords` was the
    // original behaviour and it put the camera 15km up over the whole destination at nadir —
    // which passed for "back out" only while a day's framing looked roughly the same. A day now
    // has its own heading and pitch, so that flight visibly discarded the view being returned to.
    // The destination flight is still the fallback for the one case with no route behind the
    // panel: a stop detail opened on the home page before a trip has been drawn.
    if (reframeRoute()) return;
    if (destinationCoords)
      flyToDestination(destinationCoords.lat, destinationCoords.lon, destinationCoords.name);
  }, [reframeRoute, destinationCoords, flyToDestination]);

  return {
    /** Exposed for the arrive/depart pickers, which need somewhere to look up airports near.
     *  Set by both paths that resolve a destination — picking a suggestion and the blur geocode. */
    destinationCoords,
    flyToDestinationByName,
    flyToDestinationByCoords,
    selectStop,
    closeDetail,
    selectedStop,
    detail,
    detailLoading,
    detailError,
  };
}
