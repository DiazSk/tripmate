import type { TripRow } from "./db";
import { toTripDetail } from "./tripPayload";
import type { Itinerary } from "./types";

/**
 * A trip as the person holding its share link sees it.
 *
 * **Narrower than `Trip`, on purpose.** The share link is the one unauthenticated read of a whole
 * trip, so what it returns is chosen field by field rather than inherited: the plan and the facts
 * needed to draw it, and nothing that belongs to the sender alone. `userAnswers` carries their
 * dietary and access needs, `chatSessionId` names a conversation, and the trip's own id would let
 * the holder address routes that are the owner's. None of those leave here.
 */
export interface SharedTrip {
  destination: string;
  startDate: string;
  endDate: string;
  budget: number;
  itinerary: Itinerary;
  timezone: string | null;
  /** The sender's first name, or null when there is no account behind the trip or it could not
   *  be read. The phone says "A trip shared with you" rather than inventing one. */
  sharedBy: string | null;
}

export function toSharedTrip(row: TripRow, sharedBy: string | null): SharedTrip {
  const trip = toTripDetail(row);
  return {
    destination: trip.destination,
    startDate: trip.startDate,
    endDate: trip.endDate,
    budget: trip.budget,
    itinerary: copyForRecipient(trip.itinerary),
    timezone: trip.timezone ?? null,
    sharedBy,
  };
}

/**
 * The plan a recipient's own copy starts from.
 *
 * **A copy is the recipient's trip, not a view of the sender's.** It stops following the sender's
 * edits the moment it exists, so what the sender committed to stays with the sender:
 *
 * - `timeFlexibility: "FIXED"` is "the traveller booked this", and the recipient booked nothing. A
 *   copy that kept it would lock stops the planner may never move, on behalf of somebody else's
 *   reservation.
 * - `actualCost` and `costState` are the sender's real spending. A copy that kept them would open
 *   with a budget already partly spent by another person.
 *
 * Everything else — the stops, their times, the estimates, the stays — is the plan, and is copied.
 */
export function copyForRecipient(itinerary: Itinerary): Itinerary {
  return {
    ...itinerary,
    days: itinerary.days.map((day) => {
      const stops = day.stops.map((original) => {
        const stop = { ...original };
        delete stop.actualCost;
        delete stop.costState;
        if (stop.timeFlexibility === "FIXED") delete stop.timeFlexibility;
        return stop;
      });
      if (!day.lodging) return { ...day, stops };
      const lodging = { ...day.lodging };
      delete lodging.actualCost;
      delete lodging.costState;
      return { ...day, stops, lodging };
    }),
  };
}
