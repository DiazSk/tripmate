import test from "node:test";
import assert from "node:assert/strict";
import { autoDismissMs, currentCopy, formatClockTime, holdSentence, pushToast, MAX_VISIBLE, TOAST_MS } from "./toastQueue.ts";

const success = { id: 1, kind: "success", title: "Bar Luce added to Day 3" };
const error = { id: 2, kind: "error", title: "Couldn't make a link", detail: "TripMate couldn't make a share link just now." };
const hold = {
  id: 3,
  kind: "error",
  hold: "plan",
  title: "You've planned 3 trips in the last 10 minutes.",
  detail: "You can plan another in {mm:ss}.",
  resolved: { title: "You can plan another trip now." },
};

test("an error toast has no auto-dismiss timer; a success toast still fades at 3200ms", () => {
  assert.equal(autoDismissMs(error), null);
  assert.equal(autoDismissMs(hold), null);
  assert.equal(autoDismissMs(success), 3200);
  assert.equal(TOAST_MS, 3200);
});

test("the stack keeps 3, dropping the oldest", () => {
  let list = [];
  for (let id = 1; id <= 5; id++) list = pushToast(list, { ...error, id, title: `e${id}` });
  assert.equal(MAX_VISIBLE, 3);
  assert.deepEqual(list.map((t) => t.id), [3, 4, 5]);
});

test("a hold toast keeps its copy while held and swaps to resolved when the hold ends", () => {
  assert.deepEqual(currentCopy(hold, 342), { title: hold.title, detail: hold.detail, resolved: false });
  assert.deepEqual(currentCopy(hold, null), { title: "You can plan another trip now.", resolved: true });
});

test("a hold toast with no resolved copy has nothing to say once the hold ends", () => {
  assert.equal(currentCopy({ ...hold, resolved: undefined }, null), null);
});

test("a toast without a hold ignores the clock", () => {
  assert.equal(currentCopy(error, null).title, error.title);
});

test("a second hold toast for the same bucket replaces the first; other toasts stay", () => {
  let list = pushToast([], error);
  list = pushToast(list, hold);
  list = pushToast(list, { ...hold, id: 9 });
  list = pushToast(list, { ...hold, id: 10, hold: "edit" });
  assert.deepEqual(list.map((t) => t.id), [2, 9, 10]);
});

test("past the cap the oldest success goes first, so a success never evicts an error", () => {
  let list = [{ ...error, id: 1 }, { ...success, id: 2 }, { ...error, id: 3, title: "Couldn't save" }];
  list = pushToast(list, { ...success, id: 4, title: "Another" });
  assert.deepEqual(list.map((t) => t.id), [1, 3, 4]);
  // an error arriving over a stack of successes also spares the other errors
  list = pushToast([{ ...error, id: 1 }, { ...success, id: 2 }, { ...success, id: 3 }], { ...error, id: 4, title: "Other" });
  assert.deepEqual(list.map((t) => t.id), [1, 3, 4]);
  // all errors: the oldest goes
  list = pushToast([1, 2, 3].map((id) => ({ ...error, id, title: `e${id}` })), { ...error, id: 4, title: "e4" });
  assert.deepEqual(list.map((t) => t.id), [2, 3, 4]);
  // a new success is the only success: it is dropped last, never the newest toast
  list = pushToast([1, 2, 3].map((id) => ({ ...error, id, title: `e${id}` })), { ...success, id: 4 });
  assert.deepEqual(list.map((t) => t.id), [2, 3, 4]);
});

test("an error toast with the same title replaces rather than stacks", () => {
  let list = pushToast([], error);
  list = pushToast(list, { ...error, id: 7 });
  assert.deepEqual(list.map((t) => t.id), [7]);
  list = pushToast(list, { ...error, id: 8, title: "Different" });
  assert.deepEqual(list.map((t) => t.id), [7, 8]);
  // success toasts with the same title are not merged
  list = pushToast([success], { ...success, id: 5 });
  assert.deepEqual(list.map((t) => t.id), [1, 5]);
});

test("the screen-reader sentence states the end as a clock time, never a countdown", () => {
  assert.equal(
    holdSentence("Your answers are kept. You can plan another in {mm:ss}.", "3:47 PM"),
    "Your answers are kept. You can plan another at 3:47 PM."
  );
  assert.equal(holdSentence("You can look again in {mm:ss}.", "9:05 AM"), "You can look again at 9:05 AM.");
  assert.ok(!holdSentence(hold.detail, "3:47 PM").includes("{mm:ss}"));
});

test("formatClockTime is hour and minute, no seconds", () => {
  const ms = new Date(2026, 9, 17, 15, 47, 31).getTime();
  const s = formatClockTime(ms);
  assert.match(s, /^\d{1,2}[:.]47/);
  assert.doesNotMatch(s, /31/);
});
