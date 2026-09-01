import { randomUUID } from "crypto";
import { enrichSelectedPois } from "../poiEnrichment";
import { reconcileTrip } from "../reconcile";
import { fetchRawTrip } from "../tripFetch";
import type { CandidatePoi } from "../pois";
import type {
  CrowdPreference,
  EnergyLevel,
  ExplorerStyle,
  GroupType,
  UserAnswers,
} from "../types";
import type { BenchFixture } from "./fixtures";
import type { TripLogistics } from "./types";

/**
 * Builds a benchmark fixture from a trip the developer typed in, by running the app's REAL
 * Step 2a → 3 → 4 path: `fetchRawTrip()` (geocode, weather, holidays, candidate POIs) →
 * `reconcileTrip()` → `enrichSelectedPois()`. Same functions the pipeline runs, so a custom trip
 * reaches the model in exactly the shape a real trip would.
 *
 * THE FETCH HAPPENS ONCE, AND THE RESULT IS FROZEN.
 *
 * This is the whole reason a custom trip is built up front and stored rather than assembled per
 * run. Weather forecasts move, holiday endpoints flake, and OpenTripMap returns a different
 * candidate list on a different day — so fetching per model would hand each one a slightly
 * different trip-context and quietly destroy the only thing that makes the comparison meaningful.
 * Built-in fixtures get this property by being literals; a custom trip gets it by being frozen
 * here, at creation, and read back from storage for every model afterwards.
 */

export interface CustomTripInput {
  destination: string;
  startDate: string;
  endDate: string;
  budget: number;
  purpose: string;
  explorerStyle: ExplorerStyle;
  group: GroupType;
  energy: EnergyLevel;
  crowds: CrowdPreference;
  /** Every interest tag selected, using the app's own `INTEREST_TAGS` vocabulary. */
  priorities: string[];
  /** The (up to 3) starred ones — the primary weighting signal. */
  topPriorities: string[];
  /** Optional anchors picked from the fetched candidate list, by name. */
  anchorNames?: string[];
  /** Optional anchors the traveler typed themselves; these carry no coordinates. */
  customPois?: string[];
  arrivalTime?: string | null;
  arrivalPoint?: string | null;
  departureTime?: string | null;
  departurePoint?: string | null;
  stayBooked?: string | null;
}

export interface CustomTripResult {
  fixture: BenchFixture;
  /** Surfaced so the form can say what degraded rather than silently planning on defaults. */
  notes: { field: string; status: string; detail: string }[];
  candidatePois: CandidatePoi[];
}

export async function buildCustomFixture(input: CustomTripInput): Promise<CustomTripResult> {
  const rawFetch = await fetchRawTrip({
    destination: input.destination,
    startDate: input.startDate,
    endDate: input.endDate,
  });

  // Anchors are matched against what the fetch actually returned — a name the traveler picked from
  // the candidate list keeps its coordinates, anything else falls through to `customPois` and is
  // treated as a coordinate-less entry, exactly as Step 2b does.
  const wanted = new Set((input.anchorNames ?? []).map((n) => n.toLowerCase()));
  const selectedPois = rawFetch.candidatePois.pois.filter((p) => wanted.has(p.name.toLowerCase()));
  const matched = new Set(selectedPois.map((p) => p.name.toLowerCase()));
  const unmatchedAnchors = (input.anchorNames ?? []).filter((n) => !matched.has(n.toLowerCase()));

  const logistics: TripLogistics | undefined =
    input.arrivalTime ||
    input.arrivalPoint ||
    input.departureTime ||
    input.departurePoint ||
    input.stayBooked
      ? {
          arrivalTime: input.arrivalTime || null,
          arrivalPoint: input.arrivalPoint || null,
          departureTime: input.departureTime || null,
          departurePoint: input.departurePoint || null,
          stayBooked: input.stayBooked || null,
        }
      : undefined;

  const userAnswers: UserAnswers = {
    purpose: input.purpose,
    explorerStyle: input.explorerStyle,
    group: input.group,
    energy: input.energy,
    crowds: input.crowds,
    budget: input.budget,
    priorities: input.priorities,
    topPriorities: input.topPriorities,
    selectedPois,
    customPois: [...(input.customPois ?? []), ...unmatchedAnchors],
    ...(logistics ? { logistics } : {}),
  };

  const reconciled = reconcileTrip(rawFetch, userAnswers);
  if (!reconciled.usable) {
    throw new Error(reconciled.error ?? "Trip is not ready to plan");
  }

  const poiDetails = await enrichSelectedPois(reconciled);

  const region = rawFetch.destination.region ?? input.destination;
  const fixture: BenchFixture = {
    id: `custom-${randomUUID().slice(0, 8)}`,
    title: `${input.destination} — ${input.group.replace(/_/g, " ")}, ${reconciled.resolvedFlags.paceResolved} pace`,
    covers: `Custom trip. ${rawFetch.dateContext.tripDays} days in ${region}; fetched live and frozen at ${new Date().toISOString().slice(0, 16).replace("T", " ")}.`,
    reconciled,
    poiDetails,
  };

  return {
    fixture,
    notes: [...reconciled.notes, ...poiDetails.notes],
    candidatePois: rawFetch.candidatePois.pois,
  };
}
