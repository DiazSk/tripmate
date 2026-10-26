import { searchApplePlaces } from "../../modules/apple-places";
import { fetchWithSession } from "./session";
import { searchPlaces } from "./tripMateApi";

jest.mock("./session", () => ({ fetchWithSession: jest.fn() }));
jest.mock("../../modules/apple-places", () => ({ searchApplePlaces: jest.fn() }));
// jest-expo runs as iOS, which is the platform that asks Apple first.

const mockedFetch = fetchWithSession as jest.Mock;
const mockedApple = searchApplePlaces as jest.Mock;
const at = { lat: 19.0544, lng: 72.8406 };

beforeEach(() => jest.clearAllMocks());

test("Apple's places come back without asking the server", async () => {
  mockedApple.mockResolvedValue([{ name: "Kala Ghoda Café", lat: 19.055, lng: 72.841, category: "MKPOICategoryCafe" }]);
  const result = await searchPlaces({ ...at, category: "cafe" });
  expect(result).toMatchObject({ provider: "apple", available: true, places: [{ name: "Kala Ghoda Café", category: "cafe" }] });
  expect(mockedApple).toHaveBeenCalledWith(expect.objectContaining({ radius: 1800, categories: ["MKPOICategoryCafe", "MKPOICategoryBakery"] }));
  expect(mockedFetch).not.toHaveBeenCalled();
});

test("nothing from Apple (or no module) asks the server, as before", async () => {
  // A fresh Response per call: a body can be read once.
  mockedFetch.mockImplementation(async () => new Response(JSON.stringify({ provider: "osm", places: [], available: false }), { status: 200 }));
  for (const apple of [[], null]) {
    mockedApple.mockResolvedValueOnce(apple);
    const result = await searchPlaces({ ...at, q: "chai" });
    expect(result).toEqual({ provider: "osm", places: [], available: false });
  }
  expect(mockedFetch).toHaveBeenCalledTimes(2);
  expect(mockedFetch.mock.calls[0][0]).toContain("/api/place-search?");
});
