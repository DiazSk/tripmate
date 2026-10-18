import { test } from "node:test";
import assert from "node:assert/strict";
import { copyForRecipient, toSharedTrip } from "./sharedTrip.ts";

const stop = (over = {}) => ({ name: "Amber Fort", lat: 26.98, lng: 75.85, cost: 12, note: "", time: "09:00", durationLabel: "2 hr", category: "entry", ...over });

test("a copy drops the sender's bookings and real spending, and keeps the plan", () => {
  const itinerary = {
    tier: "midrange",
    days: [
      {
        date: "2026-11-06",
        weather: "Clear",
        lodging: { name: "Samode Haveli", cost: 210, note: "", actualCost: 230, costState: "spent" },
        stops: [
          stop({ timeFlexibility: "FIXED", actualCost: 15, costState: "booked" }),
          stop({ name: "Hawa Mahal", timeFlexibility: "PREFERRED" }),
          stop({ name: "Jantar Mantar" }),
        ],
      },
    ],
  };
  const copy = copyForRecipient(itinerary);
  const [fort, hawa, jantar] = copy.days[0].stops;
  assert.equal(fort.timeFlexibility, undefined);
  assert.equal(fort.actualCost, undefined);
  assert.equal(fort.costState, undefined);
  assert.equal(fort.cost, 12, "the estimate is the plan's, and stays");
  assert.equal(hawa.timeFlexibility, "PREFERRED");
  assert.equal("timeFlexibility" in jantar, false);
  assert.deepEqual(copy.days[0].lodging, { name: "Samode Haveli", cost: 210, note: "" });
  assert.equal(copy.tier, "midrange");
  assert.equal(itinerary.days[0].stops[0].timeFlexibility, "FIXED", "the sender's plan is not mutated");
});

test("the shared payload carries the plan and none of the sender's own fields", () => {
  const row = {
    id: "trip-1",
    destination: "Jaipur, India",
    start_date: "2026-11-06",
    end_date: "2026-11-12",
    budget: 1800,
    itinerary_json: JSON.stringify({ days: [{ date: "2026-11-06", weather: "Clear", stops: [stop()] }] }),
    run_id: "run-1",
    user_answers_json: JSON.stringify({ dietary: { vegetarian: true } }),
    chat_session_id: "session-1",
    status: "saved",
    owner_id: "owner-1",
    timezone: "Asia/Kolkata",
    share_token: "token-1",
    created_at: "2026-10-01T00:00:00.000Z",
  };
  const shared = toSharedTrip(row, "Maya");
  assert.deepEqual(Object.keys(shared).sort(), ["budget", "destination", "endDate", "itinerary", "sharedBy", "startDate", "timezone"]);
  assert.equal(shared.sharedBy, "Maya");
  assert.equal(shared.itinerary.days[0].stops[0].name, "Amber Fort");
});

test("toSharedTrip strips actualCost and costState from stops and lodging", () => {
  const row = {
    destination: "Jaipur, India",
    start_date: "2026-11-06",
    end_date: "2026-11-12",
    budget: 1800,
    itinerary_json: JSON.stringify({
      days: [{
        date: "2026-11-06",
        weather: "Clear",
        lodging: { name: "Samode Haveli", cost: 210, note: "", actualCost: 230, costState: "spent" },
        stops: [stop({ actualCost: 15, costState: "booked" })],
      }],
    }),
    user_answers_json: null,
    chat_session_id: null,
    timezone: null,
    share_token: "token-1",
  };
  const day = toSharedTrip(row, null).itinerary.days[0];
  assert.equal("actualCost" in day.stops[0] || "costState" in day.stops[0], false);
  assert.equal("actualCost" in day.lodging || "costState" in day.lodging, false);
  assert.equal(day.stops[0].cost, 12);
});
