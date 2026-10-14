import { fetchWithSession } from "./session";
import type { TravelerProfile } from "./types";
import { listTrips, getTrip, getProfile, getProfileStats, saveProfile, placePhoto, geocode, createTripDraft, promoteTrip, generateTrip } from "./tripMateApi";

// Reads as though it runs too late, and does not: babel-jest hoists every `jest.mock` above the
// imports, so the mock is registered before `tripMateApi` resolves `./session`.
jest.mock("./session", () => ({ fetchWithSession: jest.fn() }));

const mockedFetch = fetchWithSession as jest.Mock;

beforeEach(() => jest.clearAllMocks());

test("listTrips returns the trips array on success", async () => {
  mockedFetch.mockResolvedValue(
    new Response(JSON.stringify({ trips: [{ id: "1", destination: "Kyoto", startDate: "2026-10-01", endDate: "2026-10-05", budget: 2000, status: "saved" }] }), { status: 200 })
  );

  const result = await listTrips();

  expect(result).toEqual([{ id: "1", destination: "Kyoto", startDate: "2026-10-01", endDate: "2026-10-05", budget: 2000, status: "saved" }]);
  expect(mockedFetch).toHaveBeenCalledWith("/api/trips?status=saved", expect.anything());
});

test("listTrips returns undefined when the fetch fails", async () => {
  mockedFetch.mockResolvedValue(new Response("", { status: 500 }));

  expect(await listTrips()).toBeUndefined();
});

test("listTrips returns undefined when the fetch rejects", async () => {
  mockedFetch.mockRejectedValue(new Error("network down"));

  expect(await listTrips()).toBeUndefined();
});

test("getTrip returns the trip on success", async () => {
  const trip = {
    id: "1", destination: "Kyoto", startDate: "2026-10-01", endDate: "2026-10-05",
    budget: 2000, status: "saved", itinerary: { days: [] }, userAnswers: null, chatSessionId: null,
  };
  mockedFetch.mockResolvedValue(new Response(JSON.stringify(trip), { status: 200 }));

  expect(await getTrip("1")).toEqual(trip);
  expect(mockedFetch).toHaveBeenCalledWith("/api/trips/1", expect.anything());
});

test("getTrip returns undefined when the fetch rejects", async () => {
  mockedFetch.mockRejectedValue(new Error("network down"));

  expect(await getTrip("1")).toBeUndefined();
});

test("getProfile returns null when the traveler has no saved profile", async () => {
  mockedFetch.mockResolvedValue(new Response(JSON.stringify({ profile: null }), { status: 200 }));

  expect(await getProfile()).toBeNull();
});

test("getProfile returns undefined when the fetch fails", async () => {
  mockedFetch.mockResolvedValue(new Response("", { status: 500 }));

  expect(await getProfile()).toBeUndefined();
});

// Zeroes are a real record — somebody who has kept no trips has exactly this — so they must not
// be confused with not having been able to ask.
test("getProfileStats returns the record, and undefined only when it could not ask", async () => {
  mockedFetch.mockResolvedValue(
    new Response(JSON.stringify({ trips: 2, places: 2, spend: 2452 }), { status: 200 })
  );
  expect(await getProfileStats()).toEqual({ trips: 2, places: 2, spend: 2452 });
  expect(mockedFetch).toHaveBeenCalledWith("/api/profile/stats", expect.anything());

  mockedFetch.mockResolvedValue(new Response("", { status: 500 }));
  expect(await getProfileStats()).toBeUndefined();
});

const profile: TravelerProfile = {
  group: "solo",
  explorerStyle: "mixed",
  energy: "moderate",
  crowds: "mixed",
  priorities: ["Food", "Nightlife"],
  topPriorities: ["Food"],
  dietary: { tags: ["Vegetarian"], note: "no shellfish" },
};

/**
 * `PUT /api/profile` **replaces** rather than merging — the route's `parseProfile` demands every
 * field and rejects anything short. So the body carrying the whole object is the contract, and
 * this assertion is what fails the day somebody "optimises" it into sending only what changed.
 */
test("saveProfile PUTs the whole profile, nested under a profile key", async () => {
  mockedFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

  expect(await saveProfile(profile)).toBe(true);

  const [url, init] = mockedFetch.mock.calls[0];
  expect(url).toBe("/api/profile");
  expect(init.method).toBe("PUT");
  expect(JSON.parse(init.body).profile).toEqual(profile);
});

// A 400 is the route refusing the shape. Reporting it as saved would leave the screen showing
// edits the server never took.
test("saveProfile reports failure on a refused shape and on a dead connection", async () => {
  mockedFetch.mockResolvedValue(new Response(JSON.stringify({ error: "bad" }), { status: 400 }));
  expect(await saveProfile(profile)).toBe(false);

  mockedFetch.mockRejectedValue(new Error("network down"));
  expect(await saveProfile(profile)).toBe(false);
});

test("getProfile returns undefined when the fetch rejects", async () => {
  mockedFetch.mockRejectedValue(new Error("network down"));

  expect(await getProfile()).toBeUndefined();
});

// A 200 with all-null fields is the route's way of saying "this place has no photograph" and is
// meant to be cached; a 503 means the lookup itself failed and must stay retryable. The two must
// not collapse into one return value.
test("placePhoto returns the all-null object on a 200, so it can be cached", async () => {
  mockedFetch.mockResolvedValue(
    new Response(JSON.stringify({ thumbnailUrl: null, imageUrl: null, extract: null }), { status: 200 })
  );

  expect(await placePhoto("Kyoto")).toEqual({ thumbnailUrl: null, imageUrl: null, extract: null });
  expect(mockedFetch).toHaveBeenCalledWith("/api/place-photo?name=Kyoto", expect.anything());
});

test("placePhoto returns a photo on success", async () => {
  mockedFetch.mockResolvedValue(
    new Response(JSON.stringify({ thumbnailUrl: "t.jpg", imageUrl: "i.jpg", extract: "A city." }), { status: 200 })
  );

  expect(await placePhoto("Kyoto")).toEqual({ thumbnailUrl: "t.jpg", imageUrl: "i.jpg", extract: "A city." });
});

test("placePhoto returns undefined on a 503, keeping the lookup retryable", async () => {
  mockedFetch.mockResolvedValue(new Response("", { status: 503 }));

  expect(await placePhoto("Kyoto")).toBeUndefined();
});

test("placePhoto returns undefined when the fetch rejects", async () => {
  mockedFetch.mockRejectedValue(new Error("network down"));

  expect(await placePhoto("Kyoto")).toBeUndefined();
});

test("placePhoto never fires a request for an empty name", async () => {
  expect(await placePhoto("   ")).toBeUndefined();
  expect(mockedFetch).not.toHaveBeenCalled();
});

test("placePhoto encodes a name with spaces and punctuation", async () => {
  mockedFetch.mockResolvedValue(
    new Response(JSON.stringify({ thumbnailUrl: null, imageUrl: null, extract: null }), { status: 200 })
  );

  await placePhoto("Val d'Orcia, Italy");

  expect(mockedFetch).toHaveBeenCalledWith(
    "/api/place-photo?name=Val%20d'Orcia%2C%20Italy",
    expect.anything()
  );
});

// --- Creating a trip -------------------------------------------------------

// 404 and 500 are different on purpose: one says "no such place", the other says "we couldn't
// ask". Collapsing them would tell a traveller their destination doesn't exist during an outage.
test("geocode reports a 404 as a miss, distinct from a failure", async () => {
  mockedFetch.mockResolvedValue(new Response(JSON.stringify({ error: "nope" }), { status: 404 }));
  expect(await geocode("Atlantis")).toEqual({ missed: true });
});

test("geocode reports a 500 as undefined, making no claim about the place", async () => {
  mockedFetch.mockResolvedValue(new Response("", { status: 500 }));
  expect(await geocode("Kyoto")).toBeUndefined();
});

test("geocode returns the place on success", async () => {
  mockedFetch.mockResolvedValue(
    new Response(JSON.stringify({ lat: 35.01, lng: 135.76, name: "Kyoto" }), { status: 200 })
  );
  expect(await geocode("Kyoto")).toEqual({ place: { lat: 35.01, lng: 135.76, name: "Kyoto" } });
});

test("geocode never fires a request for an empty destination", async () => {
  expect(await geocode("  ")).toBeUndefined();
  expect(mockedFetch).not.toHaveBeenCalled();
});

test("createTripDraft returns the new id and sends draft status", async () => {
  mockedFetch.mockResolvedValue(new Response(JSON.stringify({ id: "t9" }), { status: 200 }));
  const body = {
    destination: "Kyoto", startDate: "2027-04-02", endDate: "2027-04-09", budget: 3800,
    itinerary: { days: [] }, status: "draft" as const,
  };
  expect(await createTripDraft(body)).toBe("t9");
  const [, init] = mockedFetch.mock.calls[0];
  expect(JSON.parse(init.body).status).toBe("draft");
});

test("promoteTrip returns the server's recomputed endDate, not the sent one", async () => {
  mockedFetch.mockResolvedValue(
    new Response(JSON.stringify({ ok: true, endDate: "2027-04-08", days: 7, status: "saved" }), { status: 200 })
  );
  const update = await promoteTrip("t9", { days: [] });
  expect(update?.endDate).toBe("2027-04-08");
  const [, init] = mockedFetch.mock.calls[0];
  expect(init.method).toBe("PATCH");
  expect(JSON.parse(init.body).status).toBe("saved");
});

// --- Generation ------------------------------------------------------------

const REQ = {
  destination: "Kyoto", startDate: "2027-04-02", endDate: "2027-04-09",
  budget: 3800, tier: "midrange" as const,
};

function sseResponse(body: string, status = 200) {
  // No `body` stream here, which exercises the whole-text fallback path deliberately.
  return new Response(body, { status, headers: { "Content-Type": "text/event-stream" } });
}

test("generateTrip surfaces a 429 as a throttle, not a generic failure", async () => {
  mockedFetch.mockResolvedValue(
    new Response(JSON.stringify({ error: "Too many requests. Slow down and try again shortly." }), { status: 429 })
  );
  const result = await generateTrip(REQ, { onPlan: () => {} });
  expect(result).toEqual({ kind: "throttled", message: "Too many requests. Slow down and try again shortly." });
});

test("generateTrip surfaces a 503 as the spend cap", async () => {
  mockedFetch.mockResolvedValue(
    new Response(JSON.stringify({ error: "Demo budget for today has been used up. Try again tomorrow." }), { status: 503 })
  );
  const result = await generateTrip(REQ, { onPlan: () => {} });
  expect(result?.kind).toBe("spendCap");
});

test("generateTrip delivers stages, stops and the plan, skipping padding and keepalives", async () => {
  const stages: string[] = [];
  const stops: number[] = [];
  let planned: unknown;
  mockedFetch.mockResolvedValue(
    sseResponse(
      `:${"x".repeat(2048)}\n\n` +
        'event: stage\ndata: {"stage":"geocode","status":"start"}\n\n' +
        ':\n\n' +
        'event: stop\ndata: {"dayIndex":0,"stopIndex":0,"date":"2027-04-02","stop":{"name":"Fushimi Inari"}}\n\n' +
        'event: plan\ndata: {"itinerary":{"days":[]},"traceId":"tr","runId":"r1"}\n\n'
    )
  );
  const result = await generateTrip(REQ, {
    onStage: (e) => stages.push(e.stage),
    onStop: (e) => stops.push(e.stopIndex),
    onPlan: (r) => { planned = r; },
  });
  expect(result).toBeUndefined();
  expect(stages).toEqual(["geocode"]);
  expect(stops).toEqual([0]);
  expect(planned).toEqual({ itinerary: { days: [] }, traceId: "tr", runId: "r1" });
});

test("generateTrip reports a stream error when no plan landed", async () => {
  mockedFetch.mockResolvedValue(
    sseResponse('event: error\ndata: {"error":"The planner didn\'t finish. Try generating again."}\n\n')
  );
  const result = await generateTrip(REQ, { onPlan: () => {} });
  expect(result?.kind).toBe("failed");
  expect(result?.message).toContain("didn't finish");
});

// A late failure must never tear down a plan already handed to the caller.
test("generateTrip ignores an error arriving after the plan", async () => {
  let planned = false;
  mockedFetch.mockResolvedValue(
    sseResponse(
      'event: plan\ndata: {"itinerary":{"days":[]},"traceId":"t","runId":"r"}\n\n' +
        'event: error\ndata: {"error":"too late"}\n\n'
    )
  );
  const result = await generateTrip(REQ, { onPlan: () => { planned = true; } });
  expect(planned).toBe(true);
  expect(result).toBeUndefined();
});

test("generateTrip returns a failure when the request itself throws", async () => {
  mockedFetch.mockRejectedValue(new Error("network down"));
  expect((await generateTrip(REQ, { onPlan: () => {} }))?.kind).toBe("failed");
});
