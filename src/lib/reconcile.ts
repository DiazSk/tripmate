import { deriveFlags } from "./userAnswers";
import {
  RawFetch,
  ReconciledTrip,
  ReconcileNote,
  TransportMode,
  UserAnswers,
} from "./types";

/** Used when 2a couldn't determine what's actually available at the destination. Walk + transit
 *  is the safe assumption for a city trip; `drive` is deliberately omitted so nothing downstream
 *  plans around a car the traveler may not have. */
const DEFAULT_TRANSPORT_MODES: TransportMode[] = ["walk", "transit"];

/**
 * Step 3 — the join/barrier. Callers await both tracks before calling this; this function owns
 * the reconciliation, and every partial-failure rule in the pipeline lives here rather than
 * being scattered across the routes that consume the result.
 *
 * The governing rule: any single missing field degrades to a flagged default and the pipeline
 * continues. Only a genuinely unusable state — no POIs from either the candidate list or the
 * user's own entries — is surfaced as a real error.
 */
export function reconcileTrip(rawFetch: RawFetch, userAnswers: UserAnswers): ReconciledTrip {
  const notes: ReconcileNote[] = [];

  // Part C derivation happens here, at the normalize boundary — the single point where raw
  // answers become the resolved flags everything downstream reads. Deliberately not in the UI:
  // the harness, the app and any future caller must all get identical flags from identical
  // answers.
  const resolvedFlags = deriveFlags(userAnswers);

  // Weather: 2a already falls back to last-year historical for far-out trips and flags it via
  // `historical` — so "estimated" here covers both that case and an outright failed fetch.
  if (!rawFetch.weather.available || rawFetch.weather.days.length === 0) {
    notes.push({
      field: "weather",
      status: "estimated",
      detail: "Weather unavailable — plan against seasonal norms for the destination.",
    });
  } else if (rawFetch.weather.historical) {
    notes.push({
      field: "weather",
      status: "estimated",
      detail: "Trip is beyond the forecast horizon — using same-dates-last-year averages.",
    });
  }

  if (!rawFetch.holidays.available) {
    notes.push({
      field: "holidays",
      status: "unavailable",
      detail: "Public holiday data unavailable — closures and crowding can't be anticipated.",
    });
  }

  // Sunrise/sunset rides along with the weather fetch, but can be absent per-day even when the
  // fetch succeeded, so it's checked independently rather than inferred from `weather.available`.
  const hasSunTimes = rawFetch.weather.days.some((d) => d.sunrise && d.sunset);
  if (!hasSunTimes) {
    notes.push({
      field: "sunTimes",
      status: "unavailable",
      detail: "Sunrise/sunset unknown — treat roughly 07:00–19:00 as usable daylight.",
    });
  }

  const transportModes = rawFetch.transportModes.available
    ? (rawFetch.transportModes.modes as TransportMode[])
    : DEFAULT_TRANSPORT_MODES;
  if (!rawFetch.transportModes.available) {
    notes.push({
      field: "transportModes",
      status: "estimated",
      detail: `Transport data unavailable — assuming ${DEFAULT_TRANSPORT_MODES.join(" + ")}.`,
    });
  }

  if (!rawFetch.destination.resolved) {
    notes.push({
      field: "destination",
      status: "unavailable",
      detail: "Destination didn't resolve to coordinates — distances and weather are unverified.",
    });
  }

  // POIs: the user's own entries are authoritative and always survive; the candidate list only
  // matters for what they picked from it. Custom entries carry no coordinates at this stage.
  const selectedPois = [
    ...userAnswers.selectedPois.map((p) => ({
      name: p.name,
      lat: p.lat,
      lon: p.lon,
      kinds: p.category,
    })),
    ...userAnswers.customPois.map((name) => ({
      name,
      lat: null,
      lon: null,
      kinds: null,
    })),
  ];

  if (!rawFetch.candidatePois.available) {
    notes.push({
      field: "candidatePois",
      status: "unavailable",
      detail:
        userAnswers.customPois.length > 0
          ? "Suggestions unavailable — proceeding with the traveler's own entries."
          : "Suggestions unavailable.",
    });
  }

  // Selecting nothing is the normal case, not a failure: places are chosen from the traveler
  // profile (energy, crowd tolerance, style, priorities), and anything listed here is
  // only an anchor the traveler had already decided on. Flagged so the model knows which mode
  // it's in rather than treating an empty list as missing data.
  if (selectedPois.length === 0) {
    notes.push({
      field: "selectedPois",
      status: "ok",
      detail: "No anchors given — select every stop from the traveler profile.",
    });
  }

  return {
    usable: true,
    error: null,
    rawFetch,
    userAnswers,
    resolvedFlags,
    transportModes,
    selectedPois,
    notes,
  };
}
