import { fetchWithSession } from "./session";
import { createSseParser } from "./sse";
import type {
  ArrivalPoint,
  CandidatePoi,
  ChatTurn,
  CreateTripRequest,
  GenerateFailure,
  GenerateHandlers,
  GenerateRequest,
  GenerationResult,
  GeocodedPlace,
  CompletePlanRequest,
  ImportItem,
  ImportResult,
  ImportedPlan,
  Itinerary,
  PlaceCategory,
  PlacePhoto,
  PlaceSearchResult,
  ProfileStats,
  SavedPlace,
  SavedSource,
  SketchEvent,
  StageEvent,
  StreamedStop,
  Trip,
  TripEdit,
  TripSummary,
  TripUpdate,
  TravelerProfile,
  TripStatus,
} from "./types";

export async function listTrips(status: TripStatus = "saved"): Promise<TripSummary[] | undefined> {
  try {
    const res = await fetchWithSession(`/api/trips?status=${status}`, {});
    if (!res.ok) return undefined;
    const body = await res.json();
    return body.trips as TripSummary[];
  } catch {
    return undefined;
  }
}

export async function getTrip(id: string): Promise<Trip | undefined> {
  try {
    const res = await fetchWithSession(`/api/trips/${id}`, {});
    if (!res.ok) return undefined;
    return (await res.json()) as Trip;
  } catch {
    return undefined;
  }
}

export async function getProfile(): Promise<TravelerProfile | null | undefined> {
  try {
    const res = await fetchWithSession("/api/profile", {});
    if (!res.ok) return undefined;
    const body = await res.json();
    return body.profile as TravelerProfile | null;
  } catch {
    return undefined;
  }
}

/**
 * `GET /api/profile/stats` — what the trips somebody kept add up to.
 *
 * Its own route rather than fields on `/api/trips`, because the figures need every stored
 * itinerary and the trips list deliberately stopped reading them. `undefined` is "could not ask",
 * distinct from a real record of zeroes, which somebody with no trips legitimately has.
 */
export async function getProfileStats(): Promise<ProfileStats | undefined> {
  try {
    const res = await fetchWithSession("/api/profile/stats", {});
    if (!res.ok) return undefined;
    return (await res.json()) as ProfileStats;
  } catch {
    return undefined;
  }
}

/**
 * `GET /api/place-photo?name=` — the photograph and extract for a place.
 *
 * **The 200/503 split is the caching contract and it is the whole subtlety.** A miss returns all
 * three fields `null` with a 200, deliberately, so the client can cache "this place has no
 * photograph" and stop asking. A 503 means the lookup itself failed and is retryable — caching
 * that would leave a trip photo-less for the rest of the session. So a returned object is always
 * safe to cache; `undefined` never is.
 */
export async function placePhoto(name: string): Promise<PlacePhoto | undefined> {
  const trimmed = name.trim();
  // A caller passing a field the traveler hasn't filled in would otherwise fire a lookup for ""
  // on every render, which can only 400.
  if (!trimmed) return undefined;
  try {
    const res = await fetchWithSession(`/api/place-photo?name=${encodeURIComponent(trimmed)}`, {});
    if (!res.ok) return undefined;
    return (await res.json()) as PlacePhoto;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Creating a trip
// ---------------------------------------------------------------------------

/**
 * `GET /api/geocode` — where the destination actually is.
 *
 * **A miss and a failure are different status codes on purpose, and the caller must keep them
 * apart.** 404 means the geocoder ran and found nothing, which is worth telling the traveller.
 * 500 means the lookup never completed, which is not a claim anybody can make about what they
 * typed. Neither ever blocks generating.
 */
export async function geocode(
  destination: string
): Promise<{ place: GeocodedPlace } | { missed: true } | undefined> {
  const trimmed = destination.trim();
  if (!trimmed) return undefined;
  try {
    const res = await fetchWithSession(
      `/api/geocode?destination=${encodeURIComponent(trimmed)}`,
      {}
    );
    if (res.status === 404) return { missed: true };
    if (!res.ok) return undefined;
    return { place: (await res.json()) as GeocodedPlace };
  } catch {
    return undefined;
  }
}

/**
 * `POST /api/import` — read screenshots, links and notes for the places they name.
 *
 * A string return is the route's own `{error}` body (400/413/429/503) — a real answer about why
 * these couldn't be read, not a transport failure, so the caller shows it rather than the generic
 * "couldn't reach TripMate" line. `undefined` is the transport failure, per the house rule.
 */
export async function importPlaces(
  items: ImportItem[],
  destination?: string
): Promise<ImportResult | string | undefined> {
  try {
    const res = await fetchWithSession('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, destination }),
    });
    if (!res.ok) return errorMessage(res);
    return (await res.json()) as ImportResult;
  } catch {
    return undefined;
  }
}

/** `POST /api/import-plan` — read a traveller's own plan into days, and find each stop on the map. */
export async function readPlan(
  items: ImportItem[],
  destination?: string
): Promise<ImportedPlan | string | undefined> {
  try {
    const res = await fetchWithSession("/api/import-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, destination }),
    });
    if (!res.ok) return errorMessage(res);
    return (await res.json()) as ImportedPlan;
  } catch {
    return undefined;
  }
}

/** `POST /api/import-plan/complete` — build the confirmed plan into a draft trip. */
export async function completePlan(body: CompletePlanRequest): Promise<{ id: string } | string | undefined> {
  try {
    const res = await fetchWithSession("/api/import-plan/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return errorMessage(res);
    return (await res.json()) as { id: string };
  } catch {
    return undefined;
  }
}

/** `GET /api/saved-places` — the traveller's "save now, plan later" inbox, newest first. */
export async function listSavedPlaces(): Promise<SavedPlace[] | undefined> {
  try {
    const res = await fetchWithSession('/api/saved-places', {});
    if (!res.ok) return undefined;
    return ((await res.json()) as { places: SavedPlace[] }).places;
  } catch {
    return undefined;
  }
}

/** `POST /api/saved-places`. False on any failure — the caller offers Retry. */
export async function saveSavedPlaces(body: {
  places: { name: string; lat: number | null; lng: number | null }[];
  city?: string | null;
  source: SavedSource;
  url?: string;
}): Promise<boolean> {
  try {
    const res = await fetchWithSession('/api/saved-places', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteSavedPlace(id: string): Promise<boolean> {
  try {
    const res = await fetchWithSession(`/api/saved-places?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function createTripDraft(body: CreateTripRequest): Promise<string | undefined> {
  try {
    const res = await fetchWithSession('/api/trips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return undefined;
    return ((await res.json()) as { id: string }).id;
  } catch {
    return undefined;
  }
}

/**
 * Promote a draft to kept. Write-once and one-way — the route refuses to demote.
 *
 * The returned `endDate` is **recomputed server-side from the itinerary's length**, not an echo
 * of anything sent, so callers persist what comes back rather than what they had.
 */
export async function promoteTrip(
  id: string,
  itinerary: Itinerary
): Promise<TripUpdate | undefined> {
  try {
    const res = await fetchWithSession(`/api/trips/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itinerary, status: 'saved' }),
    });
    if (!res.ok) return undefined;
    return (await res.json()) as TripUpdate;
  } catch {
    return undefined;
  }
}

/**
 * Saves an itinerary onto a trip that is already kept.
 *
 * The same `PATCH` `promoteTrip` uses, without the status flip — adding a stop is an edit to a
 * saved trip, not a promotion. **The whole itinerary goes over the wire**, because there is no
 * single-stop endpoint and the server overwrites the column outright; it recomputes `endDate`
 * from the day count itself and never trusts a client's.
 */
export async function updateTripItinerary(
  id: string,
  itinerary: Itinerary,
  /** Set after a chat turn, so the next one resumes the conversation this plan came out of. */
  chatSessionId?: string | null
): Promise<TripUpdate | undefined> {
  try {
    const res = await fetchWithSession(`/api/trips/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itinerary, ...(chatSessionId ? { chatSessionId } : {}) }),
    });
    if (!res.ok) return undefined;
    return (await res.json()) as TripUpdate;
  } catch {
    return undefined;
  }
}

/**
 * Places of a kind, near a point.
 *
 * Returns `undefined` only for a transport failure, per the house rule. The route's own
 * `available: false` — "we could not ask" — is passed through untouched, because the screen has
 * to be able to say "search is busy" rather than "there is nothing here".
 */
export async function searchPlaces(params: {
  lat: number;
  lng: number;
  q?: string;
  category?: PlaceCategory;
  radius?: number;
}): Promise<PlaceSearchResult | undefined> {
  const query = new URLSearchParams({ lat: String(params.lat), lng: String(params.lng) });
  if (params.q?.trim()) query.set('q', params.q.trim());
  if (params.category) query.set('category', params.category);
  if (params.radius) query.set('radius', String(params.radius));

  try {
    const res = await fetchWithSession(`/api/place-search?${query.toString()}`, {});
    if (!res.ok) return undefined;
    return (await res.json()) as PlaceSearchResult;
  } catch {
    return undefined;
  }
}

/**
 * Publish this trip and get the link, or withdraw it.
 *
 * Idempotent in both directions, which is what lets the caller treat a second press as a retry:
 * sharing an already-shared trip returns the same link rather than breaking the one already
 * sent, and un-sharing an unshared one succeeds.
 *
 * Undefined is "the request did not land" — the same shape every mutation here uses, so an
 * offline press says nothing rather than claiming a link exists.
 */
export async function shareTrip(id: string): Promise<{ url: string } | undefined> {
  try {
    const res = await fetchWithSession(`/api/trips/${id}/share`, { method: 'POST' });
    if (!res.ok) return undefined;
    return (await res.json()) as { url: string };
  } catch {
    return undefined;
  }
}

export async function unshareTrip(id: string): Promise<boolean> {
  try {
    const res = await fetchWithSession(`/api/trips/${id}/share`, { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function discardTrip(id: string): Promise<boolean> {
  try {
    const res = await fetchWithSession(`/api/trips/${id}`, { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Stream a generation, stage by stage and stop by stop.
 *
 * Four things here are contract, not preference:
 *
 * 1. **The throttle (429) and the spend cap (503) fire before the stream opens**, as ordinary
 *    JSON with a non-200. They can never arrive as stream events, so they are checked on the
 *    response itself and reported as their own failure kinds — a traveller told "the planner
 *    didn't finish" when the real answer is "you have generated three of these in ten minutes"
 *    has been told nothing.
 * 2. **Reading stops at `plan`.** Critique runs *after* the plan is handed over and takes around
 *    150 seconds; draining to `done` leaves a spinner up with the finished plan already in hand.
 * 3. **`error` is only a failure if no plan landed.** The route cannot currently emit one after
 *    `plan`, but the Swift client guards it anyway and so does this: a late failure must never
 *    tear down something already on screen.
 * 4. **`day-coords` spells it `lon`**, alone on this wire. Not consumed here, noted so the next
 *    reader does not transcribe `lng` and silently get `undefined`.
 */
export async function generateTrip(
  request: GenerateRequest,
  handlers: GenerateHandlers
): Promise<GenerateFailure | undefined> {
  let response: Response;
  try {
    response = await fetchWithSession('/api/itinerary?stream=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(request),
    });
  } catch {
    return { kind: 'failed', message: GENERIC_FAILURE };
  }

  if (!response.ok) {
    const message = await errorMessage(response);
    if (response.status === 429) return { kind: 'throttled', message };
    if (response.status === 503) return { kind: 'spendCap', message };
    return { kind: 'failed', message };
  }

  let planned = false;
  /**
   * Terminal, where `planned` once was.
   *
   * Reading used to stop at the `plan` frame, which threw the review pass's corrections away —
   * see `GenerateHandlers`. It now runs to `done`, which is the frame that carries them.
   */
  let finished = false;
  let streamError: string | undefined;

  const parser = createSseParser((frame) => {
    if (finished) return;
    let payload: unknown;
    try {
      payload = JSON.parse(frame.data);
    } catch {
      return; // A frame we cannot read is not a reason to fail a running generation.
    }
    switch (frame.event) {
      // The progress frames stop mattering the moment a whole plan exists.
      case 'stage':
        if (!planned) handlers.onStage?.(payload as StageEvent);
        break;
      case 'stop':
        if (!planned) handlers.onStop?.(payload as StreamedStop);
        break;
      case 'sketch':
        if (!planned) handlers.onSketch?.(payload as SketchEvent);
        break;
      case 'plan':
        if (planned) break;
        planned = true;
        handlers.onPlan(payload as GenerationResult);
        break;
      case 'done':
        // Terminal either way, and it carries the finished result — the review's day set already
        // swapped in, or the original where the server judged the revision no improvement.
        //
        // The `!planned` arm is not dead code: `plan` is only emitted on the streaming path, so a
        // generation that fails to emit one still delivers its result here. That is the behaviour
        // this branch had when `plan` and `done` shared it, kept.
        finished = true;
        if (planned) handlers.onFinal?.(payload as GenerationResult);
        else {
          planned = true;
          handlers.onPlan(payload as GenerationResult);
        }
        break;
      case 'error':
        streamError = (payload as { error?: string }).error || GENERIC_FAILURE;
        finished = true;
        break;
    }
  });

  try {
    await readBody(response, (chunk) => parser.feed(chunk), () => finished);
    parser.end();
  } catch {
    if (!planned) return { kind: 'failed', message: GENERIC_FAILURE };
  }

  if (planned) return undefined;
  return { kind: 'failed', message: streamError ?? GENERIC_FAILURE };
}

const GENERIC_FAILURE = "The planner didn't finish. Try generating again.";

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error || GENERIC_FAILURE;
  } catch {
    return GENERIC_FAILURE;
  }
}

/**
 * Read the response body incrementally where the platform allows it.
 *
 * Expo replaces the global `fetch` on native with its WinterCG implementation, whose response
 * carries a real `ReadableStream` — so `getReader()` is the live path and the one that makes
 * stops appear as they are written. The whole-text fallback exists for any runtime where `body`
 * is absent: generation still completes correctly there, the traveller simply gets every stop at
 * once at the end instead of watching them arrive.
 */
async function readBody(
  response: Response,
  onChunk: (chunk: string) => void,
  done: () => boolean
): Promise<void> {
  const body = response.body as ReadableStream<Uint8Array> | null | undefined;
  if (!body?.getReader) {
    onChunk(await response.text());
    return;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done: finished, value } = await reader.read();
    if (finished) break;
    if (value) onChunk(decoder.decode(value, { stream: true }));
    // Stop pulling the moment the plan is in hand; the rest of the stream is critique.
    if (done()) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
}

/**
 * `POST /api/trip-fetch` — the places worth pinning before the plan is written.
 *
 * The route returns a whole preference-independent bundle; only the candidate POIs are read
 * here. **Never throws, and `available: false` is not the same as an empty list**: the first
 * means the source could not be reached, the second means it had nothing to say about this
 * place. The picker says different things for each.
 */
export async function candidatePois(
  destination: string,
  startDate: string,
  endDate: string
): Promise<{ available: boolean; pois: CandidatePoi[] }> {
  try {
    const res = await fetchWithSession('/api/trip-fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination, startDate, endDate }),
    });
    if (!res.ok) return { available: false, pois: [] };
    const body = (await res.json()) as {
      rawFetch?: { candidatePois?: { available?: boolean; pois?: CandidatePoi[] } };
    };
    const found = body.rawFetch?.candidatePois;
    return { available: found?.available ?? false, pois: found?.pois ?? [] };
  } catch {
    return { available: false, pois: [] };
  }
}

/** `PUT /api/profile`. The route answers `{ok:true}` and reads `body.profile`. */
export async function saveProfile(profile: TravelerProfile): Promise<boolean> {
  try {
    const res = await fetchWithSession('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * `POST /api/trip-edit` — ask the planner for a change and take the plan it sends back.
 *
 * **`dayIndex` is the traveler's choice, never the screen's.** The Swift app sent `activeDay`,
 * which scope-locked the conversation to whatever day you happened to be looking at — so "move
 * the market to day 3" came back refused by the applier, and nothing on screen had said it would
 * be. This app sent nothing at all for the same reason: a change is a thing you ask of a trip.
 *
 * It is sent now only when the sheet's scope control is set to a day, which it never is by
 * default. The difference from `activeDay` is the whole point — the narrower scope is stated
 * before you ask, and choosing it is an act rather than a side effect of where you were
 * standing. The applier enforces whatever arrives here; see `applyPatch`'s `scope`.
 *
 * The route does NOT persist the plan — it returns it, and the caller writes it back with
 * `updateTripItinerary`. `undefined` is the transport failure, per the house rule; there is no
 * partial success to represent, since the model either answered or it did not.
 */
export async function editTrip(params: {
  trip: TripSummary;
  itinerary: Itinerary;
  messages: { role: 'user' | 'assistant'; content: string }[];
  tripId: string;
  userAnswers: unknown | null;
  sessionId: string | null;
  syncedHash: string | null;
  /** The one day this turn may change, or omitted for the whole trip. */
  dayIndex?: number;
}): Promise<TripEdit | undefined> {
  try {
    const res = await fetchWithSession('/api/trip-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'chat', ...params }),
    });
    if (!res.ok) return undefined;
    return (await res.json()) as TripEdit;
  } catch {
    return undefined;
  }
}

/**
 * `GET /api/trip-chat` — the conversation this trip already had, oldest first.
 *
 * Worth the call because the transcript lives on the server, not on the device: without it,
 * reopening a trip shows an empty sheet for a conversation the planner still remembers, and the
 * next reply arrives with no visible question. An empty list is the honest answer for a trip that
 * has never been asked anything, so a failure returns `[]` too — there is nothing a reader could
 * do differently, and an error strip over a chat nobody has started yet is noise.
 */
export async function chatTurns(tripId: string): Promise<ChatTurn[]> {
  try {
    const res = await fetchWithSession(`/api/trip-chat?tripId=${encodeURIComponent(tripId)}`, {});
    if (!res.ok) return [];
    const body = (await res.json()) as { turns?: ChatTurn[] };
    return body.turns ?? [];
  } catch {
    return [];
  }
}

/**
 * `GET /api/arrival-points` — the airports and stations somebody could land at.
 *
 * **Always a list, never a failure.** The route itself answers 200 with `[]` when Overpass is
 * unreachable, and this keeps that posture rather than adding an `undefined` the caller would have
 * to tell apart: the fields it fills are optional and free-text, so a throttled lookup costs a
 * convenience and nothing else. Somewhere with no airport within range answers the same way, and
 * the two are not worth distinguishing on a question nobody has to answer.
 */
export async function arrivalPoints(lat: number, lng: number): Promise<ArrivalPoint[]> {
  try {
    const res = await fetchWithSession(`/api/arrival-points?lat=${lat}&lon=${lng}`, {});
    if (!res.ok) return [];
    const body = (await res.json()) as { points?: ArrivalPoint[] };
    return body.points ?? [];
  } catch {
    return [];
  }
}
