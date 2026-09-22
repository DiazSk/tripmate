jest.mock("expo-secure-store");

type Store = {
  getItemAsync: jest.Mock;
  setItemAsync: jest.Mock;
};

/**
 * A fresh copy of the module, with its secure-store mock from the same registry.
 *
 * `session` memoises the owner for the life of the process — that memo is what stops two
 * concurrent first requests minting two identities — so each test needs the module reloaded, and
 * a reload gives it a new `expo-secure-store` instance that the outer mock handles would miss.
 */
function freshSession(stored: string | null = null) {
  jest.resetModules();
  /* eslint-disable @typescript-eslint/no-require-imports */
  const store = require("expo-secure-store") as Store;
  store.getItemAsync.mockResolvedValue(stored);
  store.setItemAsync.mockResolvedValue(undefined);
  const mod = require("./session") as typeof import("./session");
  /* eslint-enable @typescript-eslint/no-require-imports */
  return { ...mod, store };
}

beforeEach(() => {
  (globalThis as unknown as { fetch: jest.Mock }).fetch = jest
    .fn()
    .mockResolvedValue(new Response("{}", { status: 200 }));
});

const cookieOf = (call: number) =>
  ((globalThis.fetch as unknown as jest.Mock).mock.calls[call][1].headers as Record<string, string>)
    .Cookie;

test("mints an owner on first use and stores it", async () => {
  const { fetchWithSession, store } = freshSession();

  await fetchWithSession("/api/trips");

  const [key, value] = store.setItemAsync.mock.calls[0];
  expect(key).toBe("tripmate.session.owner");
  // Only a UUID-shaped owner is accepted; anything else lands in the server's legacy bucket.
  expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  expect(cookieOf(0)).toBe(`tripmate_owner=${value}`);
});

test("reuses the stored owner rather than minting another", async () => {
  const { fetchWithSession, store } = freshSession("11111111-2222-4333-8444-555555555555");

  await fetchWithSession("/api/trips");

  expect(store.setItemAsync).not.toHaveBeenCalled();
  expect(cookieOf(0)).toBe("tripmate_owner=11111111-2222-4333-8444-555555555555");
});

// The bug this replaced: a trip and the profile written milliseconds apart landed under two
// different owners, so promoting the draft answered 404. Every request must be the same person.
test("concurrent first requests share one identity", async () => {
  const { fetchWithSession, store } = freshSession();

  await Promise.all([fetchWithSession("/api/trips"), fetchWithSession("/api/profile")]);

  expect(cookieOf(0)).toBe(cookieOf(1));
  expect(store.setItemAsync).toHaveBeenCalledTimes(1);
});

test("every later request carries the same owner", async () => {
  const { fetchWithSession } = freshSession();

  await fetchWithSession("/api/trips");
  await fetchWithSession("/api/profile");

  expect(cookieOf(0)).toBe(cookieOf(1));
});

test("caller headers survive alongside the cookie", async () => {
  const { fetchWithSession } = freshSession();

  await fetchWithSession("/api/trips", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  const headers = (globalThis.fetch as unknown as jest.Mock).mock.calls[0][1].headers as Record<
    string,
    string
  >;
  expect(headers["Content-Type"]).toBe("application/json");
  expect(headers.Cookie).toContain("tripmate_owner=");
});
