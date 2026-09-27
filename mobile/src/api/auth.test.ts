jest.mock("expo-secure-store");

const TOKEN_KEY = "tripmate.session.token";

/**
 * Sign-out has to revoke before it forgets, and that ordering is the whole test.
 *
 * Dropping the token does not sign this app out on its own: the platform holds Better Auth's
 * session cookie where JS cannot reach it, so a request made between "token cleared" and "session
 * revoked" still comes back as the account. That window is what showed Profile the account's trip
 * count after signing out.
 */
function freshAuth(token: string | null) {
  jest.resetModules();
  /* eslint-disable @typescript-eslint/no-require-imports */
  const store = require("expo-secure-store") as {
    getItemAsync: jest.Mock;
    setItemAsync: jest.Mock;
    deleteItemAsync: jest.Mock;
  };
  store.getItemAsync.mockImplementation(async (key: string) => (key === TOKEN_KEY ? token : null));
  store.setItemAsync.mockResolvedValue(undefined);
  store.deleteItemAsync.mockResolvedValue(undefined);
  const mod = require("./auth") as typeof import("./auth");
  /* eslint-enable @typescript-eslint/no-require-imports */
  return { ...mod, store };
}

test("signing out revokes the session before forgetting the token", async () => {
  const order: string[] = [];
  const { signOut, store } = freshAuth("tok_live");
  store.deleteItemAsync.mockImplementation(async () => {
    order.push("cleared");
  });
  (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("/api/auth/sign-out")) order.push("revoked");
    return new Response("{}", { status: 200 });
  });

  await signOut();

  expect(order).toEqual(["revoked", "cleared"]);
});

// The traveller asked to be signed out. A dead connection must not be able to refuse them.
test("an unreachable server still drops the token", async () => {
  const { signOut, store } = freshAuth("tok_live");
  (globalThis as unknown as { fetch: jest.Mock }).fetch = jest
    .fn()
    .mockRejectedValue(new Error("offline"));

  await signOut();

  expect(store.deleteItemAsync).toHaveBeenCalledWith(TOKEN_KEY);
});
