/* Run: node --import ./scripts/test-db.mjs --import ./scripts/ts-resolve.mjs --test src/lib/claimOwner.test.mjs
 *
 * Both `--import`s, and test-db.mjs is not optional here: this file opens a database, and
 * without it `db.ts` falls back to the repo's own `tripmate.db` and the run leaves real rows in it. */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  claimAnonymousOwner,
  getOrCreateAccount,
  insertTrip,
  listSavedPlaces,
  listTrips,
  readProfile,
  upsertSavedPlaces,
  writeProfile,
} from "./db.ts";
import { LEGACY_OWNER } from "./owner.ts";

// Real UUIDs, not the `test-owner-…` shape used elsewhere in this suite: `claimAnonymousOwner`
// validates both ends with `isValidOwnerId`, so a made-up string would be refused for the right
// reason and the test would pass while proving nothing.
const owner = () => randomUUID();

const trip = (ownerId, destination = "Kyoto") =>
  insertTrip({
    id: randomUUID(),
    destination,
    start_date: "2026-04-01",
    end_date: "2026-04-04",
    budget: 1200,
    itinerary_json: JSON.stringify({ days: [] }),
    owner_id: ownerId,
  });

const profile = (priority) => ({
  group: "solo",
  explorerStyle: "relaxed",
  energy: "moderate",
  crowds: "avoid",
  priorities: [priority],
  topPriorities: [priority],
  dietary: { restrictions: [], notes: "" },
  accessibility: { needs: [], notes: "" },
});

const place = (name) => ({
  name,
  lat: null,
  lng: null,
  city: "Kyoto, Japan",
  source: "screenshot",
  url: null,
});

test("a sign-in carries the trips, places and profile made before it", () => {
  const anon = owner();
  const user = owner();
  trip(anon, "Kyoto");
  upsertSavedPlaces(anon, [place("Nishiki Market")]);
  writeProfile(profile("food"), anon);

  assert.equal(claimAnonymousOwner(anon, user), 1);

  // `true` — a signed-in account reads its own rows only.
  assert.equal(listTrips("saved", user, true).length, 1);
  assert.equal(listTrips("saved", anon, true).length, 0);
  assert.equal(listSavedPlaces(user, true).length, 1);
  assert.equal(readProfile(user)?.priorities[0], "food");
});

test("the shared legacy bucket is never claimed, in either direction", () => {
  // It holds every pre-ownership row and belongs to nobody. Claiming it *from* would hand one
  // account the whole app's history; claiming it *to* would push a real account's rows back into
  // a pool everyone can read.
  const user = owner();
  trip(LEGACY_OWNER, "Legacy town");
  const before = listTrips("saved", LEGACY_OWNER).length;

  assert.equal(claimAnonymousOwner(LEGACY_OWNER, user), 0);
  assert.equal(claimAnonymousOwner(user, LEGACY_OWNER), 0);
  assert.equal(listTrips("saved", LEGACY_OWNER).length, before);
});

test("claiming yourself, or from a junk id, moves nothing", () => {
  const user = owner();
  trip(user);
  assert.equal(claimAnonymousOwner(user, user), 0);
  assert.equal(claimAnonymousOwner("not-a-uuid", user), 0);
  assert.equal(listTrips("saved", user, true).length, 1);
});

test("signing in on a second device does not overwrite the account's profile", () => {
  // The second device carries its own anonymous answers. The account's existing profile is the
  // considered one and has to win — a silent overwrite is the expensive kind of surprise.
  const user = owner();
  writeProfile(profile("museums"), user);
  const secondDevice = owner();
  writeProfile(profile("nightlife"), secondDevice);

  claimAnonymousOwner(secondDevice, user);

  assert.equal(readProfile(user)?.priorities[0], "museums");
});

test("a place the account already saved does not break the claim", () => {
  // `saved_places` is UNIQUE (owner_id, place_key), so an unguarded UPDATE would throw and take
  // the trips with it.
  const anon = owner();
  const user = owner();
  upsertSavedPlaces(user, [place("Fushimi Inari")]);
  upsertSavedPlaces(anon, [place("Fushimi Inari"), place("Gion")]);
  trip(anon);

  assert.equal(claimAnonymousOwner(anon, user), 1);

  const names = listSavedPlaces(user, true).map((r) => r.name).sort();
  assert.deepEqual(names, ["Fushimi Inari", "Gion"]);
  assert.equal(listSavedPlaces(anon, true).length, 0);
});

test("claim refuses an id that belongs to another account", () => {
  const x = getOrCreateAccount(`user_${randomUUID()}`);
  const y = getOrCreateAccount(`user_${randomUUID()}`);
  const t = trip(y.owner_id);

  assert.equal(claimAnonymousOwner(y.owner_id, x.owner_id), 0);
  assert.equal(listTrips("saved", y.owner_id, true).some((r) => r.id === t.id), true);
  assert.equal(listTrips("saved", x.owner_id, true).length, 0);
});
