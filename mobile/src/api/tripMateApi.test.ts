import { listTrips, getTrip, getProfile, placePhoto } from "./tripMateApi";

jest.mock("./session", () => ({ fetchWithSession: jest.fn() }));
import { fetchWithSession } from "./session";
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
