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

test("stores only the name=value pair, dropping every attribute", async () => {
  const headers = new Headers();
  headers.set("set-cookie", "owner=fresh456; Path=/; HttpOnly");
  (global.fetch as jest.Mock).mockResolvedValue(new Response("{}", { status: 200, headers }));

  await fetchWithSession("/api/trips");

  expect(mockedSet).toHaveBeenCalledWith("tripmate.session.cookie", "owner=fresh456");
});

// The real header carries `Expires=Wed, 27 Oct 2027 17:47:48 GMT`. Echoed back whole, that comma
// and those spaces make the Cookie header unparseable, the server mints a fresh owner on every
// request, and each call arrives as a different person — invisible until the first owner-scoped
// write 404s.
test("drops an Expires attribute whose value contains a comma", async () => {
  const headers = new Headers();
  headers.set(
    "set-cookie",
    "tripmate_owner=abc; Path=/; Expires=Wed, 27 Oct 2027 17:47:48 GMT; Max-Age=34560000; HttpOnly; SameSite=lax"
  );
  (global.fetch as jest.Mock).mockResolvedValue(new Response("{}", { status: 200, headers }));

  await fetchWithSession("/api/trips");

  expect(mockedSet).toHaveBeenCalledWith("tripmate.session.cookie", "tripmate_owner=abc");
});

test("sends no Cookie header when nothing has been stored yet", async () => {
  (global.fetch as jest.Mock).mockResolvedValue(new Response("{}", { status: 200 }));

  await fetchWithSession("/api/trips");

  const [, init] = (global.fetch as jest.Mock).mock.calls[0];
  expect(init.headers["Cookie"]).toBeUndefined();
});
