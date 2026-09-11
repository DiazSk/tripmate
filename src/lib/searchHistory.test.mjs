import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_HISTORY,
  forgetSearch,
  itineraryHighlights,
  recentSearches,
  rememberSearch,
} from "./searchHistory.ts";

/**
 * A `localStorage` good enough for this module, installed on `globalThis.window`.
 *
 * The module guards on `typeof window === "undefined"` and reaches for `window.localStorage`, so a
 * bare object with the three methods it calls is the whole contract. `throwOnWrite` covers the
 * private-mode / quota-full path, which is the one that has to degrade rather than throw.
 */
function installStorage({ throwOnWrite = false } = {}) {
  let store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => {
        if (throwOnWrite) throw new Error("QuotaExceededError");
        store.set(k, v);
      },
      removeItem: (k) => store.delete(k),
    },
  };
  return {
    seed: (value) => store.set("tripmateSearchHistory", value),
    raw: () => store.get("tripmateSearchHistory"),
  };
}

test.afterEach(() => {
  delete globalThis.window;
});

// --- recording ---------------------------------------------------------------------------------

test("a search goes to the front of the list", () => {
  installStorage();
  rememberSearch("ramen");
  assert.deepEqual(rememberSearch("gelato"), ["gelato", "ramen"]);
});

test("re-searching something moves it up rather than duplicating it", () => {
  installStorage();
  rememberSearch("ramen");
  rememberSearch("gelato");
  assert.deepEqual(rememberSearch("ramen"), ["ramen", "gelato"]);
});

test("case and spacing differences are the same search, and the newest spelling wins", () => {
  installStorage();
  rememberSearch("Bar Luce");
  assert.deepEqual(rememberSearch("  bar   luce "), ["bar luce"]);
});

test("the list is capped", () => {
  installStorage();
  let list = [];
  for (let i = 0; i < MAX_HISTORY + 4; i++) list = rememberSearch(`query ${i}`);
  assert.equal(list.length, MAX_HISTORY);
  assert.equal(list[0], `query ${MAX_HISTORY + 3}`, "newest first");
});

test("blank and absurdly long queries are not recorded", () => {
  installStorage();
  rememberSearch("keeper");
  assert.deepEqual(rememberSearch("   "), ["keeper"]);
  assert.deepEqual(rememberSearch("x".repeat(200)), ["keeper"]);
});

// --- reading, and surviving whatever is in storage -----------------------------------------------

test("no storage at all reads as no history", () => {
  installStorage();
  assert.deepEqual(recentSearches(), []);
});

test("corrupt JSON reads as no history rather than throwing into the render", () => {
  const s = installStorage();
  s.seed("{not json");
  assert.deepEqual(recentSearches(), []);
});

test("a non-array payload reads as no history", () => {
  const s = installStorage();
  s.seed(JSON.stringify({ ramen: true }));
  assert.deepEqual(recentSearches(), []);
});

test("non-string entries are dropped, not rendered", () => {
  const s = installStorage();
  s.seed(JSON.stringify(["ramen", 42, null, { q: "x" }, "gelato", "  "]));
  assert.deepEqual(recentSearches(), ["ramen", "gelato"]);
});

test("server-side rendering has no window and no stored history", () => {
  assert.deepEqual(recentSearches(), []);
  // Same contract as the quota-full case below: the entry comes back so a caller holding the
  // returned list stays correct, even though there was nowhere to persist it.
  assert.deepEqual(rememberSearch("ramen"), ["ramen"]);
});

test("storage that refuses writes still returns a correct list for this session", () => {
  installStorage({ throwOnWrite: true });
  assert.deepEqual(rememberSearch("ramen"), ["ramen"], "the UI must behave in private mode");
  assert.deepEqual(recentSearches(), [], "nothing persisted, which is the honest read-back");
});

// --- forgetting --------------------------------------------------------------------------------

test("forgetting drops one entry and keeps the rest in order", () => {
  installStorage();
  rememberSearch("a");
  rememberSearch("b");
  rememberSearch("c");
  assert.deepEqual(forgetSearch("b"), ["c", "a"]);
});

test("forgetting matches the same way recording deduplicates", () => {
  installStorage();
  rememberSearch("Bar Luce");
  assert.deepEqual(forgetSearch("  BAR LUCE  "), []);
});

test("forgetting something absent is a no-op", () => {
  installStorage();
  rememberSearch("a");
  assert.deepEqual(forgetSearch("nope"), ["a"]);
});

// --- itinerary highlights ------------------------------------------------------------------------

test("highlights come back in visit order across days", () => {
  const days = [
    { stops: [{ name: "Colosseum" }, { name: "Trattoria" }] },
    { stops: [{ name: "Vatican" }] },
  ];
  assert.deepEqual(itineraryHighlights(days), ["Colosseum", "Trattoria", "Vatican"]);
});

test("a stop visited twice is listed once", () => {
  const days = [{ stops: [{ name: "Hotel" }, { name: "Museum" }] }, { stops: [{ name: "hotel" }] }];
  assert.deepEqual(itineraryHighlights(days), ["Hotel", "Museum"]);
});

test("unnamed stops are skipped rather than rendered blank", () => {
  const days = [{ stops: [{ name: "" }, { name: "   " }, { name: "Real Place" }] }];
  assert.deepEqual(itineraryHighlights(days), ["Real Place"]);
});

test("highlights are capped, and stop scanning once full", () => {
  const days = [{ stops: Array.from({ length: 40 }, (_, i) => ({ name: `Stop ${i}` })) }];
  assert.equal(itineraryHighlights(days).length, MAX_HISTORY);
  assert.equal(itineraryHighlights(days, 2).length, 2);
});

test("an empty plan has no highlights", () => {
  assert.deepEqual(itineraryHighlights([]), []);
  assert.deepEqual(itineraryHighlights([{ stops: [] }]), []);
});
