import { listTrips, getTrip, getProfile } from "./tripMateApi";

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
