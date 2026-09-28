jest.mock("expo-secure-store");

type Store = {
  getItemAsync: jest.Mock;
  setItemAsync: jest.Mock;
  deleteItemAsync: jest.Mock;
};

const OWNER_KEY = "tripmate.session.owner";
const TOKEN_KEY = "tripmate.session.token";

/**
 * A fresh copy of the module, with its secure-store mock from the same registry.
 *
 * `session` memoises the owner for the life of the process — that memo is what stops two
 * concurrent first requests minting two identities — so each test needs the module reloaded, and
 * a reload gives it a new `expo-secure-store` instance that the outer mock handles would miss.
 *
 * **The store is mocked per key, not per call.** Two things live in it now, and a blanket
 * `mockResolvedValue` hands the same string back for both — which reads as a signed-in session
 * whose token happens to equal the anonymous owner id. Every assertion below about a bearer being
 * absent would pass for the wrong reason.
 */
function freshSession({ owner = null, token = null }: { owner?: string | null; token?: string | null } = {}) {
  jest.resetModules();
  /* eslint-disable @typescript-eslint/no-require-imports */
  const store = require("expo-secure-store") as Store;
  store.getItemAsync.mockImplementation(async (key: string) =>
    key === TOKEN_KEY ? token : key === OWNER_KEY ? owner : null,
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

test("no Authorization header when signed out", async () => {
  const { fetchWithSession } = freshSession();

  await fetchWithSession("/api/trips");

  expect(headersOf(0).Authorization).toBeUndefined();
  // The anonymous identity still travels, so a signed-out app is a working app.
  expect(ownerOf(0)).toBeDefined();
});

test("a stored token rides on every request, beside the owner", async () => {
  const { fetchWithSession } = freshSession({ token: "tok_abc" });

  await fetchWithSession("/api/trips");
  await fetchWithSession("/api/profile");

  expect(headersOf(0).Authorization).toBe("Bearer tok_abc");
  expect(headersOf(1).Authorization).toBe("Bearer tok_abc");
  expect(ownerOf(0)).toBeDefined();
});

test("adopting a token takes effect on the very next request", async () => {
  const { fetchWithSession, adoptToken, store } = freshSession();

  await fetchWithSession("/api/trips");
  await adoptToken("tok_fresh");
  await fetchWithSession("/api/trips");

  expect(headersOf(0).Authorization).toBeUndefined();
  expect(headersOf(1).Authorization).toBe("Bearer tok_fresh");
  expect(store.setItemAsync).toHaveBeenCalledWith(TOKEN_KEY, "tok_fresh");
});

// A rejected token is a sign-out, not a retry: nothing the app can do makes it acceptable again,
// and retrying turns one failure into a loop.
test("a 401 drops the token, so the next request goes out anonymously", async () => {
  const { fetchWithSession, store } = freshSession({ token: "tok_stale" });
  (globalThis.fetch as unknown as jest.Mock).mockResolvedValueOnce(new Response("{}", { status: 401 }));

  await fetchWithSession("/api/trips");
  await fetchWithSession("/api/trips");

  expect(headersOf(0).Authorization).toBe("Bearer tok_stale");
  expect(headersOf(1).Authorization).toBeUndefined();
  expect(store.deleteItemAsync).toHaveBeenCalledWith(TOKEN_KEY);
});

// Clearing a token nobody holds would announce a sign-out that never happened, and a 401 on an
// anonymous request means something else entirely.
test("a 401 while signed out clears nothing", async () => {
  const { fetchWithSession, store } = freshSession();
  (globalThis.fetch as unknown as jest.Mock).mockResolvedValueOnce(new Response("{}", { status: 401 }));

  await fetchWithSession("/api/trips");

  expect(store.deleteItemAsync).not.toHaveBeenCalled();
});

test("signing out tells anything watching", async () => {
  const { adoptToken, clearToken, subscribeToSession } = freshSession();
  const seen: boolean[] = [];
  subscribeToSession(() => seen.push(true));

  await adoptToken("tok");
  await clearToken();

  expect(seen).toHaveLength(2);
});

/**
 * The launch gate awaits `currentToken()` and branches the whole app on it
 * (`src/app/+native-intent.tsx`), so its two contracts are worth pinning. Every other token test
 * here reaches it as a side effect of `fetchWithSession`; these two call it directly.
 */
test("a stored token is read from the keychain once, and only when asked", async () => {
  const { currentToken, store } = freshSession({ token: "tok_cold" });

  // Importing the module must not touch the keychain — the read is lazy, which is what lets the
  // gate decide when to pay for it.
  expect(store.getItemAsync.mock.calls.filter(([key]) => key === TOKEN_KEY)).toHaveLength(0);

  expect(await currentToken()).toBe("tok_cold");
  expect(await currentToken()).toBe("tok_cold");

  // Read through once and cached. On the request path this is a syscall per call otherwise.
  expect(store.getItemAsync.mock.calls.filter(([key]) => key === TOKEN_KEY)).toHaveLength(1);
});

test("no stored token reads as signed out, and mints nothing", async () => {
  const { currentToken, store } = freshSession();

  expect(await currentToken()).toBeNull();
  // An owner is minted by `fetchWithSession`, never by asking whether somebody is signed in — the
  // gate runs before the first request and must not have identity side effects.
  expect(store.setItemAsync).not.toHaveBeenCalled();
});
