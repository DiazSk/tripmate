# Anchor Hours Before Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the legacy planner each anchor's real OpenStreetMap opening hours before it writes the plan. Make the post-generation OSM lookup find places whose OSM `name` is a local name. Score the legacy bench arm against the hours the route actually had.

**Architecture:**
- **OSM lookup.** `fetchPoiOsmTags` gains a name clause that also matches `name:en`/`int_name`/`alt_name`, plus a pure `matchElementsToPois` that files results under the name the caller asked for. This fixes all three callers at once.
- **New module.** A small `anchorHours.ts` fetches and attaches hours to anchors inside a hard time budget.
- **Wiring.** `runGeneration` calls it concurrently with the waits it already does, and `formatAnchors` prints the hours.
- **Bench.** `withSeenAnchorHours`, beside `withSeenWeather`, makes the bench judge only what the model was told.

**Tech Stack:** TypeScript (Next.js 16 app code), Node ≥ 22 `node:test`, Overpass QL. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-26-anchor-hours-before-generation-design.md`

**Worktree:** `/Users/zaidshaikh/GitHub/tripmate/.worktrees/react-native-app` (branch `react-native-app`). Run every command from there.

## Global Constraints

- **No new dependencies.**
- **Fail-soft everywhere.** An Overpass failure, timeout or no match leaves anchors without hours, and the prompt then reads exactly as today. `fetchPoiOsmTags` keeps `null` = "fetch failed" and `{}` = "asked, matched nothing".
- **Pre-generation budget: ~15s** (`ANCHOR_HOURS_BUDGET_MS = 15_000`). It runs concurrently with the existing `contextInsightPromise`/`sketchPromise` waits.
- **Refine skips the lookup.** It reuses the previous plan's anchors, the same way it skips the geocode.
- **An anchor with no known hours prints its old line byte-for-byte.**
- **`ANCHOR_INSTRUCTION` and SKILL.md §16 stay in step.** The comment above `ANCHOR_INSTRUCTION` requires it; the spec says "§15", but the anchor section is §16 today.
- **Every model generation spends the developer's Claude subscription usage.** End-to-end verification is capped at **2 generations** (Kyoto and Rome, `AB_RUNS=1`). Ask the user before running them.
- **Commit messages carry no trailer of any kind.** Stage files by explicit path only; other sessions edit sibling checkouts.
- `.test.mjs` import specifiers use an explicit `.ts` extension. Test command: `node --import ./scripts/ts-resolve.mjs --test <file>`; full suite: `npm test`.

## Review Focus

1. **Overpass slow or down at generation time.** The plan must not wait past the ~15s budget, and the prompt must be unchanged. Tested in Task 2 (budget and throw cases).
2. **An anchor with no coordinates** (a typed place the geocoder missed). It must not be queried, and it must still reach the prompt, without hours. Tested in Task 2.
3. **Two requested places sharing a name** (a chain, or two "Starbucks"). Each OSM element must go to the nearer request, never both. Tested in Task 1.
4. **Names with quotes, apostrophes or parentheses** ("St. Peter's Basilica (Vatican)"). The query must stay valid Overpass. Tested in Task 1.
5. **Hours in syntax the parser can't read** (`"Mo-Fr 09:00-17:00; PH off"`). The raw string passes through, with no invented "closed" claim. Tested in Task 3.

Old arm files with no `seenAnchors` are scored exactly as before. Tested in Task 5.

---

### Task 1: `fetchPoiOsmTags` matches the English name and answers by the requested name

**Files:**
- Modify: `src/lib/poiDetails.ts` (add `poiNameClauses` and `matchElementsToPois` near `escapeForOverpassRegex` ~line 28; use both in `fetchPoiOsmTags` ~line 37 and `fetchPoiOsmTagsUncached` ~line 70)
- Create: `src/lib/poiDetails.test.mjs`

**Ruling (carried from planning):** the spec proposes one key-regex clause (`[~"^(name|name:…)$"~…]`). This plan instead uses one clause per key: `name`, `name:en`, `int_name`, `alt_name`. That is the same `nwr["key"~"^(…)$"]` shape `resolveNamedPlaceCoords` in this file already runs in production, and the spec's own Risks section names "name plus name:en" as the fallback. The traveller's names are English or local, so `name:en` covers the Nijo/Colosseum case.

**Interfaces:**
- Produces:
  ```ts
  export function poiNameClauses(poi: { name: string; lat: number; lon: number }, radiusM?: number): string
  export function matchElementsToPois(
    elements: OverpassPoiElement[],
    pois: { name: string; lat: number; lon: number }[]
  ): Map<string, OverpassPoiElement>   // keyed by the REQUESTED name
  export interface OverpassPoiElement { lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }  // now exported
  ```
- `fetchPoiOsmTags`'s signature and return type are unchanged: `Record<requestedName, PoiOsmTags> | null`.

- [ ] **Step 1: Write the failing tests** in `src/lib/poiDetails.test.mjs`:

```js
/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/poiDetails.test.mjs */
import assert from "node:assert/strict";
import test from "node:test";
import { matchElementsToPois, poiNameClauses } from "./poiDetails.ts";

const NIJO = { name: "Nijo Castle", lat: 35.0142, lon: 135.7481 };

test("a place whose OSM name is local is found by its English name", () => {
  const el = { lat: 35.0143, lon: 135.748, tags: { name: "二条城", "name:en": "Nijo Castle", opening_hours: "Mo-Su 08:45-17:00" } };
  const m = matchElementsToPois([el], [NIJO]);
  assert.equal(m.get("Nijo Castle"), el, "filed under the requested name, not 二条城");
  assert.equal(m.size, 1);
});

test("matching ignores case and surrounding space", () => {
  const el = { lat: 35.0142, lon: 135.7481, tags: { name: "NIJO CASTLE " } };
  assert.equal(matchElementsToPois([el], [NIJO]).get("Nijo Castle"), el);
});

test("an element goes to the nearer of two same-named requests, never both", () => {
  const a = { name: "Starbucks", lat: 35.0, lon: 135.7 };
  const b = { name: "Starbucks", lat: 35.002, lon: 135.7 };
  const near = { lat: 35.0019, lon: 135.7, tags: { name: "Starbucks" } };
  const m = matchElementsToPois([near], [a, b]);
  assert.equal(m.size, 1);
  assert.equal(m.get("Starbucks"), near);
});

test("an element beyond the match radius, or matching nothing, is dropped", () => {
  const far = { lat: 35.1, lon: 135.9, tags: { name: "Nijo Castle" } };
  const other = { lat: 35.0142, lon: 135.7481, tags: { name: "Some Shop" } };
  assert.equal(matchElementsToPois([far, other], [NIJO]).size, 0);
});

test("the first matching element wins when OSM returns the place twice", () => {
  const way = { center: { lat: 35.0142, lon: 135.7481 }, tags: { name: "二条城", "name:en": "Nijo Castle", opening_hours: "A" } };
  const node = { lat: 35.0142, lon: 135.7481, tags: { "name:en": "Nijo Castle", opening_hours: "B" } };
  assert.equal(matchElementsToPois([way, node], [NIJO]).get("Nijo Castle"), way);
});

test("the name clause searches name, name:en, int_name and alt_name, case-insensitively", () => {
  const q = poiNameClauses(NIJO);
  for (const key of ["name", "name:en", "int_name", "alt_name"]) {
    assert.ok(q.includes(`nwr["${key}"~"^Nijo Castle$",i](around:300,35.0142,135.7481);`), key);
  }
});

test("quotes and parentheses in a name cannot break the query", () => {
  const q = poiNameClauses({ name: `St. Peter's "Basilica" (Vatican)`, lat: 41.9, lon: 12.45 });
  assert.ok(q.includes(`St\\. Peter's \\"Basilica\\" \\(Vatican\\)`));
  assert.ok(!/[^\\]"Basilica/.test(q), "every double quote is escaped");
});
```

- [ ] **Step 2: Run them and confirm they fail.**
Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/poiDetails.test.mjs`
Expected: FAIL with `does not provide an export named 'matchElementsToPois'`.

- [ ] **Step 3: Implement it in `src/lib/poiDetails.ts`.**

Export the element type by changing `interface OverpassPoiElement {` to `export interface OverpassPoiElement {`. Then add, directly below `escapeForOverpassRegex`:

```ts
/** Every tag a traveller's name for a place can sit in. OSM's `name` is the LOCAL name — 二条城,
 *  Colosseo — so an exact `name` match found nothing for most of the world's sights, and the
 *  closed-day check after generation silently had no facts. Same `nwr["key"~"^…$"]` shape
 *  `resolveNamedPlaceCoords` below already runs. */
const NAME_KEYS = ["name", "name:en", "int_name", "alt_name"] as const;

export function poiNameClauses(poi: { name: string; lat: number; lon: number }, radiusM = MATCH_RADIUS_M): string {
  const value = escapeForOverpassRegex(poi.name);
  return NAME_KEYS.map((key) => `nwr["${key}"~"^${value}$",i](around:${radiusM},${poi.lat},${poi.lon});`).join("");
}

/** Case- and Unicode-safe. `normalizeStopName` cannot be used: it strips every non-ASCII
 *  character, so "二条城" would normalise to "". */
const sameName = (a: string, b: string) => a.normalize("NFKC").trim().toLowerCase() === b.normalize("NFKC").trim().toLowerCase();

function elementPoint(el: OverpassPoiElement): { lat: number; lon: number } | null {
  return el.center ?? (el.lat !== undefined && el.lon !== undefined ? { lat: el.lat, lon: el.lon } : null);
}

function metres(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  return haversineKm(a, b) * 1000;
}

/**
 * Files each OSM element under the REQUESTED name it answers to — every caller looks results up by
 * the name it asked for, and the old keying by the element's own `name` filed 二条城 where nobody
 * would ever read it. An element goes to the nearest request whose name equals any of its name
 * tags and that lies within the match radius; the first element per request wins, so a place
 * mapped as both a way and a node is not overwritten by its duplicate.
 */
export function matchElementsToPois(
  elements: OverpassPoiElement[],
  pois: { name: string; lat: number; lon: number }[]
): Map<string, OverpassPoiElement> {
  const out = new Map<string, OverpassPoiElement>();
  for (const el of elements) {
    const point = elementPoint(el);
    const names = NAME_KEYS.map((k) => el.tags?.[k]).filter((n): n is string => Boolean(n));
    if (!point || names.length === 0) continue;
    const candidates = pois
      .filter((p) => names.some((n) => sameName(n, p.name)))
      .map((p) => ({ p, d: metres(point, { lat: p.lat, lon: p.lon }) }))
      .filter(({ d }) => d <= MATCH_RADIUS_M)
      .sort((x, y) => x.d - y.d);
    const best = candidates[0]?.p;
    if (best && !out.has(best.name)) out.set(best.name, el);
  }
  return out;
}
```

`haversineKm` is declared further down this file (`function haversineKm(a, b)` at ~line 158). Function declarations hoist, so no move is needed. If it turns out to be a `const`, move `metres` below it.

- [ ] **Step 4: Use them in `fetchPoiOsmTags`.** Replace the clause builder:

```ts
  const clauses = pois.map((p) => poiNameClauses(p)).join("");
  const query = `[out:json][timeout:30];(${clauses});out center tags;`;
```

Change `fetchPoiOsmTagsUncached` to take the POIs and pass them through. The call becomes `cached(key, TTL.CHURNING, () => fetchPoiOsmTagsUncached(query, pois, timeoutMs))` and the signature becomes `async function fetchPoiOsmTagsUncached(query: string, pois: { name: string; lat: number; lon: number }[], timeoutMs: number)`. In its body, replace the keying loop header:

```ts
    const byName: Record<string, PoiOsmTags> = {};
    for (const el of elements) {
      const name = el.tags?.name;
      if (!name || byName[name]) continue;
```

with:

```ts
    const byName: Record<string, PoiOsmTags> = {};
    for (const [name, el] of matchElementsToPois(elements, pois)) {
```

Leave the body that builds `byName[name] = { openingHours: …, lat: point?.lat ?? null, … }` unchanged. It already reads `el` and computes `point` itself.

**Bump the cache key's prefix** from `"osmtags:"` to `"osmtags2:"`. Rows cached under the old keying would otherwise be served for up to `TTL.CHURNING` with their local-name keys.

- [ ] **Step 5: Run the tests, then the full suite and typecheck.**
Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/poiDetails.test.mjs && npm test && npx tsc --noEmit -p tsconfig.json`
Expected: all PASS, tsc clean.

- [ ] **Step 6: Commit.**
```bash
git add src/lib/poiDetails.ts src/lib/poiDetails.test.mjs
git commit -m "Find a place in OSM by its English name, and answer by the name asked

OSM's name tag is the local name, so an exact match on \"Nijo Castle\" or
\"Colosseum\" found nothing, and results were keyed by the element's own
name besides. Every non-English-named stop went unenriched after
generation: no closed-day conflict, no step-free check, no pinned cost."
```

---

### Task 2: `anchorHours.ts` — fetch and attach hours inside a budget

**Files:**
- Modify: `src/lib/types.ts` (`Anchor`, ~line 44)
- Create: `src/lib/anchorHours.ts`
- Create: `src/lib/anchorHours.test.mjs`

**Interfaces:**
- Consumes: `fetchPoiOsmTags(pois, timeoutMs)` and `closedDaysFromOpeningHours(openingHours)` from `src/lib/poiDetails.ts` (Task 1); `Anchor` and `PoiOsmTags` from `src/lib/types.ts`
- Produces:
  ```ts
  // types.ts — Anchor gains two optional fields
  openingHours?: string | null;
  closedDays?: string[] | null;
  // anchorHours.ts
  export const ANCHOR_HOURS_BUDGET_MS = 15_000;
  export function attachHours(anchors: Anchor[], tags: Record<string, PoiOsmTags> | null): Anchor[]
  export async function fetchAnchorHours(
    anchors: Anchor[],
    fetchTags?: (pois: { name: string; lat: number; lon: number }[], timeoutMs: number) => Promise<Record<string, PoiOsmTags> | null>,
    budgetMs?: number
  ): Promise<Anchor[]>
  ```

- [ ] **Step 1: Write the failing tests** in `src/lib/anchorHours.test.mjs`:

```js
/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/anchorHours.test.mjs */
import assert from "node:assert/strict";
import test from "node:test";
import { attachHours, fetchAnchorHours } from "./anchorHours.ts";

const NIJO = { name: "Nijo Castle", lat: 35.0142, lng: 135.7481, priority: "must" };
const UFFIZI = { name: "Uffizi Gallery", lat: 43.7678, lng: 11.2553, priority: "want" };
const TYPED = { name: "My aunt's café", lat: null, lng: null, priority: "want" };
const tag = (openingHours) => ({ openingHours, lat: null, lon: null, wheelchair: null });

test("attachHours adds hours and the closed days they imply", () => {
  const [nijo, uffizi] = attachHours([NIJO, UFFIZI], {
    "Nijo Castle": tag("Mo-Su 08:45-17:00"),
    "Uffizi Gallery": tag("Tu-Su 08:15-18:30"),
  });
  assert.equal(nijo.openingHours, "Mo-Su 08:45-17:00");
  assert.deepEqual(nijo.closedDays, []);
  assert.deepEqual(uffizi.closedDays, ["Mo"]);
});

test("attachHours leaves an anchor untouched when OSM has no hours for it", () => {
  const out = attachHours([NIJO], { "Nijo Castle": tag(null) });
  assert.deepEqual(out[0], NIJO);
  assert.deepEqual(attachHours([NIJO], null)[0], NIJO, "a failed fetch changes nothing");
});

test("fetchAnchorHours queries only located anchors and keeps the rest", async () => {
  let asked = null;
  const out = await fetchAnchorHours([NIJO, TYPED], async (pois) => {
    asked = pois;
    return { "Nijo Castle": tag("Mo-Su 08:45-17:00") };
  });
  assert.deepEqual(asked, [{ name: "Nijo Castle", lat: 35.0142, lon: 135.7481 }]);
  assert.equal(out[0].openingHours, "Mo-Su 08:45-17:00");
  assert.deepEqual(out[1], TYPED, "the typed place still reaches the prompt, without hours");
});

test("fetchAnchorHours makes no call when nothing is located", async () => {
  let called = false;
  const out = await fetchAnchorHours([TYPED], async () => ((called = true), {}));
  assert.equal(called, false);
  assert.deepEqual(out, [TYPED]);
});

test("fetchAnchorHours gives up at its budget and changes nothing", async () => {
  const slow = () => new Promise((resolve) => setTimeout(() => resolve({ "Nijo Castle": tag("X") }), 500));
  const started = Date.now();
  const out = await fetchAnchorHours([NIJO], slow, 50);
  assert.ok(Date.now() - started < 400, "did not wait for the slow lookup");
  assert.deepEqual(out, [NIJO]);
});

test("fetchAnchorHours survives a lookup that throws", async () => {
  const out = await fetchAnchorHours([NIJO], async () => {
    throw new Error("overpass down");
  });
  assert.deepEqual(out, [NIJO]);
});
```

- [ ] **Step 2: Run them and confirm they fail.**
Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/anchorHours.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Add the optional fields to `Anchor`** in `src/lib/types.ts`, after `source?`:

```ts
  /** OSM `opening_hours`, looked up before generation (`anchorHours.ts`). Absent or null means
   *  not known — never "no hours". Optional so every stored anchor stays valid. */
  openingHours?: string | null;
  /** Derived from `openingHours` by `closedDaysFromOpeningHours`; null when that syntax is too
   *  rich to read confidently. */
  closedDays?: string[] | null;
```

- [ ] **Step 4: Implement `src/lib/anchorHours.ts`:**

```ts
import { closedDaysFromOpeningHours, fetchPoiOsmTags } from "./poiDetails";
import type { Anchor, PoiOsmTags } from "./types";

/** On the critical path before the plan exists, so far tighter than the 45s batch default. It
 *  overlaps the context and sketch waits in `runGeneration`, so it costs nothing unless Overpass is
 *  slower than both. */
export const ANCHOR_HOURS_BUDGET_MS = 15_000;

type FetchTags = (
  pois: { name: string; lat: number; lon: number }[],
  timeoutMs: number
) => Promise<Record<string, PoiOsmTags> | null>;

/** Hours onto the anchors OSM knows. An anchor with no hours is returned as-is, so its prompt line
 *  reads exactly as it did before this existed. */
export function attachHours(anchors: Anchor[], tags: Record<string, PoiOsmTags> | null): Anchor[] {
  if (!tags) return anchors;
  return anchors.map((a) => {
    const hours = tags[a.name]?.openingHours;
    return hours ? { ...a, openingHours: hours, closedDays: closedDaysFromOpeningHours(hours) } : a;
  });
}

/**
 * The traveller's places with their real opening hours, before generation — the planner is told
 * "schedule every MUST place at a time it is open" and, until this, never when that was.
 *
 * Fail-soft and bounded: a lookup that errors, returns null or outlasts `budgetMs` leaves the
 * anchors unchanged. `askOverpass` may try several mirrors, so the race is the real cap rather
 * than the timeout it is also handed.
 */
export async function fetchAnchorHours(
  anchors: Anchor[],
  fetchTags: FetchTags = fetchPoiOsmTags,
  budgetMs: number = ANCHOR_HOURS_BUDGET_MS
): Promise<Anchor[]> {
  const located = anchors
    .filter((a) => a.lat !== null && a.lng !== null)
    .map((a) => ({ name: a.name, lat: a.lat as number, lon: a.lng as number }));
  if (located.length === 0) return anchors;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), budgetMs);
  });
  try {
    const tags = await Promise.race([fetchTags(located, budgetMs).catch(() => null), deadline]);
    return attachHours(anchors, tags);
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 5: Run the tests, the typecheck and the suite.**
Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/anchorHours.test.mjs && npx tsc --noEmit -p tsconfig.json && npm test`
Expected: all PASS, tsc clean. If tsc flags an exhaustive `Anchor` literal or a mapper elsewhere, the fields are optional, so the fix is to spread (`...a`) rather than rebuild the object. Change only what tsc names.

- [ ] **Step 6: Commit.**
```bash
git add src/lib/types.ts src/lib/anchorHours.ts src/lib/anchorHours.test.mjs
git commit -m "Look the traveller's places' hours up, inside a budget"
```

---

### Task 3: The prompt prints each anchor's hours

**Files:**
- Modify: `src/lib/itineraryPrompt.ts` (`ANCHOR_INSTRUCTION` ~line 209, `formatAnchors` ~line 211)
- Modify: `.claude/skills/itinerary-planner/SKILL.md` (§16 "The traveler's own places", ~line 635)
- Test: `src/lib/itineraryPrompt.test.mjs`

**Interfaces:**
- Consumes: `Anchor.openingHours?`, `Anchor.closedDays?` (Task 2)
- Produces: `formatAnchors(anchors)` lines of the form `- MUST: <name> (<lat>, <lng>) — open <hours>[; closed <days>] (OpenStreetMap)`

- [ ] **Step 1: Write the failing tests.** Append to `src/lib/itineraryPrompt.test.mjs`:

```js
test("formatAnchors prints an anchor's OSM hours and the days it is shut", () => {
  const out = formatAnchors([
    { name: "Uffizi Gallery", lat: 43.7678, lng: 11.2553, priority: "want", openingHours: "Tu-Su 08:15-18:30", closedDays: ["Mo"] },
    { name: "Nijo Castle", lat: 35.0142, lng: 135.7481, priority: "must", openingHours: "Mo-Su 08:45-17:00", closedDays: [] },
  ]);
  assert.ok(out.includes("- WANT: Uffizi Gallery (43.7678, 11.2553) — open Tu-Su 08:15-18:30; closed Mo (OpenStreetMap)"));
  assert.ok(out.includes("- MUST: Nijo Castle (35.0142, 135.7481) — open Mo-Su 08:45-17:00 (OpenStreetMap)"));
  assert.match(out, /they are OpenStreetMap data/);
});

test("formatAnchors passes unreadable hours through raw and claims no closed days", () => {
  const out = formatAnchors([
    { name: "Town Museum", lat: 1, lng: 2, priority: "want", openingHours: "Mo-Fr 09:00-17:00; PH off", closedDays: null },
  ]);
  assert.ok(out.includes("- WANT: Town Museum (1, 2) — open Mo-Fr 09:00-17:00; PH off (OpenStreetMap)"));
  assert.ok(!/closed Sa|closed Su/.test(out));
});

test("an anchor with no known hours prints its old line exactly", () => {
  const out = formatAnchors([{ name: "Yanaka Ginza", lat: 35.72, lng: 139.77, priority: "want" }]);
  assert.ok(out.includes("- WANT: Yanaka Ginza (35.72, 139.77)\n"));
});
```

- [ ] **Step 2: Run them and confirm they fail.**
Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/itineraryPrompt.test.mjs`
Expected: the first two new tests FAIL. The third passes already, because it pins today's behaviour so the change cannot alter it.

- [ ] **Step 3: Implement it.** In `src/lib/itineraryPrompt.ts`, append one sentence to the end of `ANCHOR_INSTRUCTION`'s template string, after `Use "unplaced": [] when everything fits.`:

```
 Where a place's hours are given, they are OpenStreetMap data — schedule it inside them; where none are given, do not state hours for it.
```

Then replace `formatAnchors`'s `lines` mapping with:

```ts
  const lines = anchors.map((a) => {
    const where = a.lat !== null && a.lng !== null ? `(${a.lat}, ${a.lng})` : "(location unknown)";
    // Raw OSM string always, plus "closed" only where the narrow parser is sure — "PH off" and
    // seasonal syntax pass through for the model to read rather than being guessed at here.
    const closed = a.closedDays && a.closedDays.length > 0 ? `; closed ${a.closedDays.join(", ")}` : "";
    const hours = a.openingHours ? ` — open ${a.openingHours}${closed} (OpenStreetMap)` : "";
    return `- ${a.priority === "must" ? "MUST" : "WANT"}: ${a.name} ${where}${hours}`;
  });
```

- [ ] **Step 4: Keep SKILL.md in step.** In `.claude/skills/itinerary-planner/SKILL.md` §16, add this bullet after "Fit `want` places where they suit a day's route…":

```
- Where an anchor carries opening hours, they are OpenStreetMap data: schedule it inside them, on a
  day it is open. Where none are given, do not state hours for it.
```

- [ ] **Step 5: Run the tests and the suite.**
Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/itineraryPrompt.test.mjs && npm test`
Expected: all PASS, including the existing `formatAnchors lists priority, name and coordinates, and states the rule`.

- [ ] **Step 6: Commit.**
```bash
git add src/lib/itineraryPrompt.ts src/lib/itineraryPrompt.test.mjs .claude/skills/itinerary-planner/SKILL.md
git commit -m "Write each place's opening hours beside it in the prompt"
```

---

### Task 4: `runGeneration` looks the hours up before generating

**Files:**
- Modify: `src/lib/generationRunner.ts` (import; the generate branch at ~lines 286-292)

**Interfaces:**
- Consumes: `fetchAnchorHours(anchors)` from `src/lib/anchorHours.ts` (Task 2)

`runGeneration` is not reachable from a `.mjs` test (see CLAUDE.md, the `CritiqueResult` value import). This task's behaviour is covered by Task 2's unit tests of what it calls, by tsc, and by Task 6's end-to-end run.

- [ ] **Step 1: Wire it in.** Add `import { fetchAnchorHours } from "./anchorHours";` beside the other `./anchor*` imports. Then replace:

```ts
    if (geoPoint && anchors.length > 0) anchors = await geocodeAnchors(anchors, geoPoint);

    contextInsight = await contextInsightPromise;
    onStage({ stage: "context", status: "done" });
    sketch = await sketchPromise;
```

with:

```ts
    if (geoPoint && anchors.length > 0) anchors = await geocodeAnchors(anchors, geoPoint);

    // The planner is told to schedule each place "at a time it is open" and, until now, never
    // told when that was. Started here — it needs the coordinates just resolved — and awaited
    // after the context and sketch calls already in flight, so it costs wall clock only when
    // Overpass is slower than both. Bounded and fail-soft inside `fetchAnchorHours`.
    const anchorHoursPromise = anchors.length > 0 ? fetchAnchorHours(anchors) : Promise.resolve(anchors);

    contextInsight = await contextInsightPromise;
    onStage({ stage: "context", status: "done" });
    sketch = await sketchPromise;
    anchors = await anchorHoursPromise;
```

The refine branch is not touched. It never reaches this code, so it keeps the previous plan's anchors, hours included.

- [ ] **Step 2: Typecheck, lint and run the suite.**
Run: `npx tsc --noEmit -p tsconfig.json && npm run lint && npm test`
Expected: tsc clean; lint shows only the pre-existing `_omitted` warning in `travelerProfile.test.mjs`; all tests PASS.

- [ ] **Step 3: Commit.**
```bash
git add src/lib/generationRunner.ts
git commit -m "Hand the planner its anchors' hours before it writes the plan"
```

---

### Task 5: The bench judges legacy anchor hours against what the route had

**Files:**
- Modify: `src/lib/bench/sweep.ts` (add `withSeenAnchorHours`)
- Modify: `scripts/skill-ab.mjs` (`runLegacy` stores `seenAnchors`; `scoreCell` applies it)
- Test: `src/lib/bench/sweep.test.mjs`

**Interfaces:**
- Consumes: `nameMatches(a, b)` from `src/lib/bench/scorers/domain.ts`; `BenchFixture` from `./fixtures`
- Produces:
  ```ts
  export function withSeenAnchorHours(
    fixture: BenchFixture,
    seen: { name: string; openingHours?: string | null; closedDays?: string[] | null }[]
  ): BenchFixture
  ```

- [ ] **Step 1: Write the failing tests.** Add `withSeenAnchorHours` to the `./sweep.ts` import in `src/lib/bench/sweep.test.mjs`, then append:

```js
test("withSeenAnchorHours scores anchors against the hours the route had", () => {
  const nijoBefore = KYOTO.poiDetails.pois.find((p) => p.name === "Nijo Castle");
  assert.match(nijoBefore.openingHours, /Mo off/, "the fixture's invented Monday closure");
  const f = withSeenAnchorHours(KYOTO, [{ name: "Nijo Castle", openingHours: "Mo-Su 08:45-17:00", closedDays: [] }]);
  const nijo = f.poiDetails.pois.find((p) => p.name === "Nijo Castle");
  assert.equal(nijo.openingHours, "Mo-Su 08:45-17:00");
  assert.deepEqual(nijo.closedDays, []);
});

test("an anchor the route had no hours for is unchecked, not judged on the fixture", () => {
  const f = withSeenAnchorHours(KYOTO, [{ name: "Nijo Castle" }]);
  for (const p of f.poiDetails.pois) {
    assert.equal(p.openingHours, null, p.name);
    assert.equal(p.closedDays, null, p.name);
  }
  assert.equal(f.poiDetails.pois.length, KYOTO.poiDetails.pois.length, "anchors stay, so coverage is unchanged");
});

test("withSeenAnchorHours does not mutate the frozen fixture", () => {
  const before = JSON.stringify(KYOTO.poiDetails);
  withSeenAnchorHours(KYOTO, []);
  assert.equal(JSON.stringify(KYOTO.poiDetails), before);
});
```

- [ ] **Step 2: Run them and confirm they fail.**
Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/bench/sweep.test.mjs`
Expected: FAIL with `does not provide an export named 'withSeenAnchorHours'`.

- [ ] **Step 3: Implement it in `src/lib/bench/sweep.ts`.** Add `import { nameMatches } from "./scorers/domain";` at the top, then append:

```ts
/**
 * The fixture, but with each anchor's hours as the route actually gave them to the model.
 *
 * Fixture hours are sometimes deliberate tests — `kyoto-couple-mixed` closes Nijo Castle on
 * Mondays; OSM has it open daily. Fair on the staged path, whose context carries those hours;
 * unanswerable on the legacy path, which never saw them. So a legacy anchor is checked against
 * the hours in its own context, and against nothing (null = unchecked) when it had none. The
 * anchors themselves stay, so coverage and missing-anchor checks are unchanged.
 */
export function withSeenAnchorHours(
  fixture: BenchFixture,
  seen: { name: string; openingHours?: string | null; closedDays?: string[] | null }[]
): BenchFixture {
  const pois = fixture.poiDetails.pois.map((p) => {
    const hit = seen.find((s) => nameMatches(s.name, p.name));
    return hit?.openingHours
      ? { ...p, openingHours: hit.openingHours, closedDays: hit.closedDays ?? null }
      : { ...p, openingHours: null, closedDays: null };
  });
  return { ...fixture, poiDetails: { ...fixture.poiDetails, pois } };
}
```

- [ ] **Step 4: Store and apply it in `scripts/skill-ab.mjs`.** Add `withSeenAnchorHours` to the `sweep.ts` import. In `runLegacy`, replace:

```js
  const context = getGeneration(payload.runId)?.context_json;
  const seenWeather = context ? JSON.parse(context).weather ?? [] : null;
```

with:

```js
  const contextJson = getGeneration(payload.runId)?.context_json;
  const context = contextJson ? JSON.parse(contextJson) : null;
  const seenWeather = context ? context.weather ?? [] : null;
  // What the route told the model about each anchor, hours included. Absent on runs recorded
  // before anchor hours existed; those are scored exactly as they were.
  const seenAnchors = context ? context.anchors ?? [] : null;
```

and add `seenAnchors,` beside `seenWeather,` in the returned object. In `scoreCell`, replace:

```js
  const seen = cell.seenWeather ? withSeenWeather(fixture, cell.seenWeather) : fixture;
```

with:

```js
  const weathered = cell.seenWeather ? withSeenWeather(fixture, cell.seenWeather) : fixture;
  const seen = cell.seenAnchors ? withSeenAnchorHours(weathered, cell.seenAnchors) : weathered;
```

- [ ] **Step 5: Run the tests and check that old arm files still score as before.**
Run: `node --import ./scripts/ts-resolve.mjs --test src/lib/bench/sweep.test.mjs && npm test && node --check scripts/skill-ab.mjs && node --import ./scripts/ts-resolve.mjs scripts/skill-ab.mjs --report docs/superpowers/plans/legacy-baseline-2026-09-26.json`
Expected: all PASS. The 2026-09-26 report still shows `kyoto-couple-mixed … closed_or_hours,travel_leg` and `rome-family-slow … closed_or_hours`, because those runs carry no `seenAnchors`, so they are scored exactly as before.

- [ ] **Step 6: Commit.**
```bash
git add src/lib/bench/sweep.ts src/lib/bench/sweep.test.mjs scripts/skill-ab.mjs
git commit -m "Judge the legacy arm's anchor hours on what the route told the model"
```

---

### Task 6: End-to-end check (2 generations) and docs

**Files:**
- Create: `docs/superpowers/plans/legacy-hours-2026-09-26.json` (arm output)
- Modify: `docs/itinerary-quality.md` (a short "after" note under the 2026-09-26 addendum)
- Modify: `docs/llm.md` (one Features row)

- [ ] **Step 1: Ask the user before spending usage.** Say it runs 2 generations (~15 minutes of their Claude subscription). Offer to let them run the two commands themselves; they ran the last sweep from their own terminal. Wait for a yes.

- [ ] **Step 2: Run it.** The dev server must run from this worktree, because the script reads its `tripmate.db`. Commands for the user or the executor:
```bash
cd ~/GitHub/tripmate/.worktrees/react-native-app && npm run dev
```
```bash
cd ~/GitHub/tripmate/.worktrees/react-native-app && AB_PATH=legacy AB_RUNS=1 AB_FIXTURES=kyoto-couple-mixed,rome-family-slow node --import ./scripts/ts-resolve.mjs scripts/skill-ab.mjs --arm docs/superpowers/plans/legacy-hours-2026-09-26.json
```
Expected: `wrote … — 2/2 runs`.

- [ ] **Step 3: Verify from what was stored (no model calls).**
```bash
node --import ./scripts/ts-resolve.mjs -e '
const { getGeneration, getRunSteps } = await import("./src/lib/db.ts"); const fs = await import("fs");
const a = JSON.parse(fs.readFileSync("docs/superpowers/plans/legacy-hours-2026-09-26.json","utf8"));
for (const c of a.cells) { const r = c.runs[0]; const p = getGeneration(r.runId).prompt;
  console.log(c.fixtureId, "| anchor lines:", p.split("\n").filter((l) => /^- (MUST|WANT):/.test(l)));
  const cr = getRunSteps(r.runId).find((s) => s.type === "critique");
  console.log("  critique closed/conflict lines:", (cr?.prompt.match(/[^\n]*(closed|conflict)[^\n]*/gi) ?? []).slice(0, 3)); }' 2>/dev/null
node --import ./scripts/ts-resolve.mjs scripts/skill-ab.mjs --report docs/superpowers/plans/legacy-hours-2026-09-26.json 2>/dev/null
```
Expected:
- Each anchor OSM knows prints `— open … (OpenStreetMap)`; Nijo Castle and the Colosseum at least.
- `--report` shows no `closed_or_hours` for an anchor whose hours were in the prompt.

Record the result either way. If an hours miss remains with the hours in the prompt, that is the rule problem the spec said would then be worth a rule. Note it; do not add a rule here. If Overpass was down during the run, the prompt lines have no hours. Record that, and do not re-run without asking.

- [ ] **Step 4: Write the note.** Under `### Addendum — two weather runs …` in `docs/itinerary-quality.md`, add a short `#### After: anchor hours in the prompt (2026-09-26, Claude)` paragraph containing:
- the two anchor lines as the model saw them;
- whether the critique got closed-day lines;
- the `--report` table and headline;
- the caveat that it is 2 runs.

Add a `docs/llm.md` Features row: "Anchor hours before generation (`src/lib/anchorHours.ts`, `formatAnchors`)", Active, Since 2026-09-26, Developer Claude, with a one-sentence note on the 15s budget, the fail-soft behaviour and the `name:en` match fix.

- [ ] **Step 5: Commit.**
```bash
git add docs/superpowers/plans/legacy-hours-2026-09-26.json docs/itinerary-quality.md docs/llm.md
git commit -m "Measure the planner with its anchors' hours in front of it"
```
