jest.mock("expo-secure-store");

const SIGNED_IN_KEY = "tripmate.signedIn";

function freshAuth() {
  jest.resetModules();
  /* eslint-disable @typescript-eslint/no-require-imports */
  const store = require("expo-secure-store") as { getItemAsync: jest.Mock; setItemAsync: jest.Mock; deleteItemAsync: jest.Mock };
  store.getItemAsync.mockResolvedValue(null);
  store.setItemAsync.mockResolvedValue(undefined);
  store.deleteItemAsync.mockResolvedValue(undefined);
  const session = require("./session") as typeof import("./session");
  const auth = require("./auth") as typeof import("./auth");
  /* eslint-enable @typescript-eslint/no-require-imports */
  return { ...auth, session, store };
}

test("signing out ends Clerk's session before dropping the launch flag", async () => {
  const order: string[] = [];
  const { signOut, session, store } = freshAuth();
  session.registerClerk({ getToken: async () => null, signOut: async () => { order.push("clerk"); } });
  store.deleteItemAsync.mockImplementation(async () => { order.push("flag"); });
  await signOut();
  expect(order).toEqual(["clerk", "flag"]);
});

// The traveller asked to be signed out. A dead connection must not be able to refuse them.
test("a Clerk sign-out that fails still drops the flag", async () => {
  const { signOut, session, store } = freshAuth();
  session.registerClerk({ getToken: async () => null, signOut: async () => { throw new Error("offline"); } });
  await signOut();
  expect(store.deleteItemAsync).toHaveBeenCalledWith(SIGNED_IN_KEY);
});
