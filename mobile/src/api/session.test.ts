import * as SecureStore from "expo-secure-store";
import { fetchWithSession } from "./session";

jest.mock("expo-secure-store");

const mockedGet = SecureStore.getItemAsync as jest.Mock;
const mockedSet = SecureStore.setItemAsync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockedGet.mockResolvedValue(null);
  global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;
});

test("sends a stored cookie on the request when one was saved", async () => {
  mockedGet.mockResolvedValue("owner=abc123");
  (global.fetch as jest.Mock).mockResolvedValue(new Response("{}", { status: 200 }));

  await fetchWithSession("/api/trips");

  const [, init] = (global.fetch as jest.Mock).mock.calls[0];
  expect(init.headers["Cookie"]).toBe("owner=abc123");
});

test("stores a Set-Cookie header from the response for next time", async () => {
  const headers = new Headers();
  headers.set("set-cookie", "owner=fresh456; Path=/; HttpOnly");
  (global.fetch as jest.Mock).mockResolvedValue(new Response("{}", { status: 200, headers }));

  await fetchWithSession("/api/trips");

  expect(mockedSet).toHaveBeenCalledWith("tripmate.session.cookie", "owner=fresh456; Path=/; HttpOnly");
});

test("sends no Cookie header when nothing has been stored yet", async () => {
  (global.fetch as jest.Mock).mockResolvedValue(new Response("{}", { status: 200 }));

  await fetchWithSession("/api/trips");

  const [, init] = (global.fetch as jest.Mock).mock.calls[0];
  expect(init.headers["Cookie"]).toBeUndefined();
});
