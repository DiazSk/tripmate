jest.mock("expo-secure-store");

type Store = {
  getItemAsync: jest.Mock;
  setItemAsync: jest.Mock;
  deleteItemAsync: jest.Mock;
};

const OWNER_KEY = "tripmate.session.owner";
const SIGNED_IN_KEY = "tripmate.signedIn";

function freshSession({ owner = null, flag = null }: { owner?: string | null; flag?: string | null } = {}) {
  jest.resetModules();
  /* eslint-disable @typescript-eslint/no-require-imports */
  const store = require("expo-secure-store") as Store;
  store.getItemAsync.mockImplementation(async (key: string) =>
    key === SIGNED_IN_KEY ? flag : key === OWNER_KEY ? owner : null,
  );
  store.setItemAsync.mockResolvedValue(undefined);
  store.deleteItemAsync.mockResolvedValue(undefined);
  const mod = require("./session") as typeof import("./session");
  /* eslint-enable @typescript-eslint/no-require-imports */
  return { ...mod, store };
}

beforeEach(() => {
  (globalThis as unknown as { fetch: jest.Mock }).fetch = jest
    .fn()
    .mockResolvedValue(new Response("{}", { status: 200 }));
});

const headersOf = (call: number) =>
  (globalThis.fetch as unknown as jest.Mock).mock.calls[call][1].headers as Record<string, string>;
const ownerOf = (call: number) => headersOf(call)["X-TripMate-Owner"];

test("mints an owner on first use and stores it", async () => {
  const { fetchWithSession, store } = freshSession();

  await fetchWithSession("/api/trips");

  const [key, value] = store.setItemAsync.mock.calls[0];
  expect(key).toBe("tripmate.session.owner");
  // Only a UUID-shaped owner is accepted; anything else lands in the server's legacy bucket.
  expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  expect(ownerOf(0)).toBe(value);
});

test("reuses the stored owner rather than minting another", async () => {
  const { fetchWithSession, store } = freshSession({ owner: "11111111-2222-4333-8444-555555555555" });

  await fetchWithSession("/api/trips");

  expect(store.setItemAsync).not.toHaveBeenCalled();
  expect(ownerOf(0)).toBe("11111111-2222-4333-8444-555555555555");
});

// The bug this replaced: a trip and the profile written milliseconds apart landed under two
// different owners, so promoting the draft answered 404. Every request must be the same person.
test("concurrent first requests share one identity", async () => {
  const { fetchWithSession, store } = freshSession();

  await Promise.all([fetchWithSession("/api/trips"), fetchWithSession("/api/profile")]);

  expect(ownerOf(0)).toBe(ownerOf(1));
  expect(store.setItemAsync).toHaveBeenCalledTimes(1);
});

test("every later request carries the same owner", async () => {
  const { fetchWithSession } = freshSession();

  await fetchWithSession("/api/trips");
  await fetchWithSession("/api/profile");

  expect(ownerOf(0)).toBe(ownerOf(1));
});

test("caller headers survive alongside the owner", async () => {
  const { fetchWithSession } = freshSession();

  await fetchWithSession("/api/trips", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  expect(headersOf(0)["Content-Type"]).toBe("application/json");
  expect(ownerOf(0)).toBeDefined();
});

// The platform overwrites a hand-set `Cookie` header from its own store, which is the whole
// reason the identity moved to a header. Sending one anyway would be silently ignored.
test("no Cookie header is sent", async () => {
  const { fetchWithSession } = freshSession();

  await fetchWithSession("/api/trips");

  expect(headersOf(0).Cookie).toBeUndefined();
});

test("no Authorization header before Clerk is registered", async () => {
  const { fetchWithSession } = freshSession();
  await fetchWithSession("/api/trips");
  expect(headersOf(0).Authorization).toBeUndefined();
});

test("Clerk's token rides on every request, beside the owner", async () => {
  const { fetchWithSession, registerClerk } = freshSession({ owner: "11111111-2222-4333-8444-555555555555", flag: "1" });
  registerClerk({ getToken: async () => "jwt_1", signOut: async () => {} });
  await fetchWithSession("/api/trips");
  expect(headersOf(0).Authorization).toBe("Bearer jwt_1");
  expect(ownerOf(0)).toBe("11111111-2222-4333-8444-555555555555");
});

test("the token is asked for on every request, never cached here", async () => {
  const { fetchWithSession, registerClerk } = freshSession({ flag: "1" });
  const getToken = jest.fn().mockResolvedValueOnce("jwt_a").mockResolvedValueOnce("jwt_b");
  registerClerk({ getToken, signOut: async () => {} });
  await fetchWithSession("/api/trips");
  await fetchWithSession("/api/trips");
  expect(headersOf(1).Authorization).toBe("Bearer jwt_b");
});

// Clerk's getToken throws ClerkOfflineError with no connection. The request must still go out —
// and fail on its own terms — rather than throw before fetch.
test("a getToken that throws sends the request anonymously", async () => {
  const { fetchWithSession, registerClerk } = freshSession({ flag: "1" });
  registerClerk({ getToken: async () => { throw new Error("offline"); }, signOut: async () => {} });
  await fetchWithSession("/api/trips");
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  expect(headersOf(0).Authorization).toBeUndefined();
});

// clerk-js failing to load leaves getToken pending forever, and every request awaits it. The
// request must still go out, anonymously, once the wait runs out.
test("a getToken that never settles does not hold the request back", async () => {
  jest.useFakeTimers();
  try {
    const { fetchWithSession, registerClerk } = freshSession({ flag: "1" });
    registerClerk({ getToken: () => new Promise<string | null>(() => {}), signOut: async () => {} });
    const sent = fetchWithSession("/api/trips");
    await jest.advanceTimersByTimeAsync(3000);
    await sent;
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(headersOf(0).Authorization).toBeUndefined();
  } finally {
    jest.useRealTimers();
  }
});

// Signed out there is nothing to send, so Clerk is not asked at all — a stuck load cannot matter.
test("no wait on Clerk when the signed-in flag is off", async () => {
  const { fetchWithSession, registerClerk } = freshSession();
  const getToken = jest.fn(() => new Promise<string | null>(() => {}));
  registerClerk({ getToken, signOut: async () => {} });
  await fetchWithSession("/api/trips");
  expect(getToken).not.toHaveBeenCalled();
  expect(headersOf(0).Authorization).toBeUndefined();
});

test("signed-in flag round-trips through the keychain", async () => {
  const { writeSignedInFlag, store } = freshSession();
  await writeSignedInFlag(true);
  expect(store.setItemAsync).toHaveBeenCalledWith(SIGNED_IN_KEY, "1");
  await writeSignedInFlag(false);
  expect(store.deleteItemAsync).toHaveBeenCalledWith(SIGNED_IN_KEY);
  expect(await freshSession({ flag: "1" }).readSignedInFlag()).toBe(true);
  expect(await freshSession({ flag: null }).readSignedInFlag()).toBe(false);
});
