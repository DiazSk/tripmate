# Chaos in → trip out: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Planners drop screenshots, links and notes. The places land on the map. Places the planner marks as a
must actually shape the generated plan, and a receipt says which ones made it in. A ~20s day sketch appears before
the full plan.

**Architecture:**
- Places reach the plan as `UserAnswers.anchors`. The server normalises them (folding in the legacy
  `selectedPois`/`customPois`), geocodes them, renders them into `buildGeneratePrompt`/`buildRefinePrompt`, and
  echoes them onto the returned `Itinerary` together with the model's `unplaced` list.
- The receipt is derived in code from that itinerary by `anchorCoverage()` in `guardrails.ts`.
- Screenshots reach the model through a new `meta.images` on `runClaude()`. On CLI they go through
  `--input-format stream-json`.
- `/api/import` turns a pile into anchors: classify, read links behind an SSRF guard, run one `extract` call,
  geocode.
- The sketch is a cheap `sketch` call. It runs alongside the context call, is streamed as a new SSE `sketch`
  event, and is fed into the generate prompt.

**Tech stack:** Next.js 16 App Router, React 19, TypeScript, `node --test` with `scripts/ts-resolve.mjs`, `libsql`,
the `claude` CLI 2.1.258 or `@anthropic-ai/sdk`.

**Spec:** `docs/superpowers/specs/2026-09-25-chaos-in-trip-out-design.md` (read it first). The roadmap it belongs
to is `docs/superpowers/specs/2026-09-25-emotional-product-roadmap-design.md`.

**Worktree:** `/Users/zaidshaikh/GitHub/tripmate-chaos-in-spec`, branch `chaos-in-spec`, cut from `ios-app`.
Every path below is relative to it. The shell resets its cwd after each command, so use `cd <worktree> && …` or
`git -C <worktree>`.

### Deviations from the spec, decided while reading the code

1. **Images ride on `meta.images`; `prompt` stays a `string`.** Every trace, session and log path in `claude.ts`
   treats `prompt` as text. Widening it would touch all of them for no behavioural gain. With the text left alone,
   trace redaction becomes "append a marker, never store the bytes".
2. **The legacy `/api/itinerary` path never loads SKILL.md.** Its rules live as constants in `itineraryPrompt.ts`
   (`STOP_LINES_INSTRUCTION`, `FOOD_STOP_INSTRUCTION`, …). So the anchor rule is an `ANCHOR_INSTRUCTION` constant
   there. SKILL.md still gains §15, because `/api/trip-edit` loads the skill, and a chat edit must not drop a must
   silently either.
3. **The trace-viewer label maps** (`RunCompareModal`, `RunPipelineDiagram`, `FlowDiagram`, `PipelineConsole`,
   `BenchConsole`) are `Record<string, …>` with fallbacks, and `story` is absent from all of them today. So only
   `CALL_TYPES` in `src/app/api/llm-mode/route.ts` needs the new call types.
4. **Anchors and `unplaced` are stored on the `Itinerary`.** They are not threaded through props. That way the
   receipt works for saved trips, reloads and the draft row with no extra plumbing, and critique cannot erase them,
   since it only reassigns `itinerary.days`.
5. **The sketch doesn't place anchor pins during generation.** Seeding provisional stops would collide with the
   stream's `stopIndex` slots. Each sketched day shows its theme plus the names of its anchors instead. The pins are
   already on the map from the import step.
6. **"Fit it anyway" regenerates through `refine()` rather than a `/api/trip-edit` chat edit; on saved trips the
   receipt shows without the button (a known gap).**

## Global constraints

- Node ≥ 22 (`.nvmrc`). Run tests with `npm test`; a single file is
  `node --import ./scripts/ts-resolve.mjs --test <file>`.
- Inside a `.test.mjs`, import specifiers need an explicit `.ts` extension. Type-only imports in `.ts` files must use
  `import type`, or `.mjs` tests can't load the module.
- **Commits carry no `Co-Authored-By` or any other trailer** (CLAUDE.md).
- Don't add dependencies. Downscale images with `<canvas>`, and use `node:net`/`node:dns` for the SSRF guard.
- Every model call goes through `runClaude()`. Model names live only in `src/lib/llmConfig.ts`.
- Fail soft: `null` means the fetch failed, `[]` means it succeeded and found nothing. Nothing in the import path
  may block generation.
- `sketch` is an SSE **event**, never a new `stage` value. iOS `SSEReader.swift` throws on unknown stages.
- Images are never persisted. Traces get `[image N · SIZE]` markers only.
- Limits: 20 images and 20 links/texts per import, 25MB request body, 1568px long edge, 8s link timeout, 3
  redirects, 512KB link body, 150m anchor match radius, 30s sketch cap, and at most 8 `searchPlaces` fallbacks per
  geocode.
- Copy, verbatim from the spec:
  - "Drop what you've saved: screenshots, links, notes."
  - "Instagram links need a screenshot"
  - "Couldn't read this screenshot"
  - "Couldn't open this link"
  - "Fit it anyway"
- Each feature step also gets a row in `docs/frontend.md` or `docs/backend.md` (Features table, `Since` 2026-09-25,
  Developer: Claude).
- Before a task counts as done: `npm test`, `npx tsc --noEmit -p tsconfig.json` and `npm run lint`.

## Review focus

These failure modes are implied by the spec but untested unless the listed task adds a test. Each one below is
assigned to a task.

1. **The same place arrives twice under different spellings** ("teamLab Planets" from a screenshot and "TeamLab
   Planets Tokyo" typed). Expected: one anchor, with `must` winning. → Task 2 (`normalizeAnchors` dedupe test),
   Task 9 (`parseExtraction` dedupe).
2. **A redirect from a public link to a private address** (`https://bit.ly/x` → `http://169.254.169.254/`).
   Expected: refused. → Task 8 test.
3. **A stop name wraps the anchor** ("Morning at teamLab Planets") **or the anchor has no coordinates.** Expected:
   it still counts as placed. → Task 4 tests.
4. **The model returns `unplaced` as a string, `null`, or entries with no reason.** Expected: ignored, never a
   crash. → Task 3 test (`readUnplaced`).
5. **A refine or a critique pass runs after generation.** Expected: the anchors and receipt survive. → Task 3
   (refine carries `previousItinerary.anchors`), with a manual check in Task 12.

---

### Task 1: Spike: does the CLI accept image input?

This is throwaway. Nothing here is committed except a note in the spec.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-25-chaos-in-trip-out-design.md` (append a "Spike result" section)

- [ ] **Step 1: Pick a test image from the repo**

  Run: `cd /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec && ls public/**/*.jpg public/**/*.png 2>/dev/null | head -5`
  Choose a photo of a real place (a hero frame of Petra is ideal). Export its **absolute** path as `IMG_PATH`.

- [ ] **Step 2: Send one image block through the CLI exactly as the app will**

  ```bash
  cd /private/tmp && IMG=$(base64 -i "$IMG_PATH" | tr -d '\n') && \
  printf '{"type":"user","message":{"role":"user","content":[{"type":"image","source":{"type":"base64","media_type":"image/jpeg","data":"%s"}},{"type":"text","text":"Name the place in this image in one line."}]}}\n' "$IMG" \
  | env -u CLAUDECODE -u ANTHROPIC_API_KEY claude -p --input-format stream-json --output-format stream-json --verbose \
      --model claude-haiku-4-5 --tools "" --setting-sources "" --no-session-persistence \
  | grep '"type":"result"' | head -c 600; echo
  ```

  Use `media_type` `image/png` if the file is a PNG.
  Expected on success: a `result` event whose `result` names the place, with `"is_error":false`. Also note the
  `duration_ms`.

- [ ] **Step 3: Record the outcome in the spec**

  Append to the spec:

  ```markdown
  ## Spike result (2026-09-25)

  `claude -p --input-format stream-json` with one base64 image block, `--tools ""`, CLI 2.1.258:
  <WORKS — answered "<quote>" in <N>ms | FAILS — <error text>>.
  ```

  If it **fails**: in Task 6, set `CLI_SUPPORTS_IMAGES = false`. Task 6 already contains that branch.

- [ ] **Step 4: Commit**

  ```bash
  git -C /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec add docs/superpowers/specs/2026-09-25-chaos-in-trip-out-design.md
  git -C /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec commit -m "Record whether the CLI can read a screenshot"
  ```

---

### Task 2: Anchors: the type, normalising the legacy fields, geocoding

**Files:**
- Modify: `src/lib/types.ts` (add `Anchor`, `UnplacedAnchor`, and `anchors?` on `UserAnswers` and `Itinerary`)
- Create: `src/lib/anchors.ts`
- Test: `src/lib/anchors.test.mjs`

**Interfaces:**
- Produces:
  - `type AnchorPriority = "must" | "want"`
  - `interface Anchor { name: string; lat: number | null; lng: number | null; priority: AnchorPriority; source?: "import" | "picked" | "typed" }`
  - `interface UnplacedAnchor { name: string; reason: string }`
  - `anchorKey(name: string): string`
  - `normalizeAnchors(answers: unknown): Anchor[]`
  - `geocodeAnchors(anchors: Anchor[], near: { lat: number; lon: number }, deps?: GeocodeDeps): Promise<Anchor[]>`
  - `readUnplaced(value: unknown): UnplacedAnchor[]`
  - `MAX_ANCHORS = 40`

- [ ] **Step 1: Add the types**

  In `src/lib/types.ts`, directly above `export interface Itinerary`:

  ```ts
  export type AnchorPriority = "must" | "want";

  /**
   * A place the traveler chose themselves: imported from a screenshot or link, picked from the POI
   * suggestions, or typed. `must` is scheduled unless impossible; `want` is fitted where it suits.
   * Coordinates are null when nothing could place it — the model still sees it by name.
   */
  export interface Anchor {
    name: string;
    lat: number | null;
    lng: number | null;
    priority: AnchorPriority;
    source?: "import" | "picked" | "typed";
  }

  /** A `must` anchor the planner could not schedule, with the model's one-line reason. */
  export interface UnplacedAnchor {
    name: string;
    reason: string;
  }
  ```

  Change `Itinerary` to:

  ```ts
  export interface Itinerary {
    tier: TierId;
    days: DayPlan[];
    /** The traveler's own places this plan was generated around, echoed back server-side so the
     *  receipt survives save, reload and critique. Absent on plans generated before anchors. */
    anchors?: Anchor[];
    /** `must` anchors the model says it could not schedule, and why. */
    unplaced?: UnplacedAnchor[];
  }
  ```

  In `UserAnswers`, directly below `customPois: string[];`, add:

  ```ts
    /** The traveler's own places, with priority. Supersedes `selectedPois`/`customPois`, which are
     *  still accepted (the iOS wizard sends only those) and folded in by `normalizeAnchors`. */
    anchors?: Anchor[];
  ```

- [ ] **Step 2: Write the failing tests**

  Create `src/lib/anchors.test.mjs`:

  ```js
  /* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/anchors.test.mjs
   *
   * The wizard's POI picker collected places for months that never reached the prompt. These pin the
   * one function every path now goes through, including the iOS wizard's legacy fields. */
  import assert from "node:assert/strict";
  import test from "node:test";
  import { anchorKey, geocodeAnchors, normalizeAnchors, readUnplaced } from "./anchors.ts";

  test("anchorKey folds case, accents and punctuation", () => {
    assert.equal(anchorKey("  Café  de Flore! "), "cafe de flore");
    assert.equal(anchorKey("teamLab Planets"), anchorKey("TEAMLAB planets"));
    assert.equal(anchorKey("浅草寺"), "浅草寺");
  });

  test("legacy selectedPois and customPois become want anchors", () => {
    const out = normalizeAnchors({
      selectedPois: [{ name: "Fushimi Inari", lat: 34.96, lon: 135.77, category: "religion" }],
      customPois: ["Nishiki Market"],
    });
    assert.deepEqual(out, [
      { name: "Fushimi Inari", lat: 34.96, lng: 135.77, priority: "want", source: "picked" },
      { name: "Nishiki Market", lat: null, lng: null, priority: "want", source: "typed" },
    ]);
  });

  test("duplicates by key collapse, must wins, coordinates are kept", () => {
    const out = normalizeAnchors({
      anchors: [{ name: "teamLab Planets", lat: null, lng: null, priority: "must", source: "import" }],
      selectedPois: [{ name: "TeamLab Planets", lat: 35.65, lon: 139.79, category: "museum" }],
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].priority, "must");
    assert.equal(out[0].lat, 35.65);
  });

  test("malformed input is dropped, never thrown", () => {
    assert.deepEqual(normalizeAnchors(null), []);
    assert.deepEqual(normalizeAnchors({ anchors: "x", customPois: [3, "", "  "] }), []);
    assert.deepEqual(
      normalizeAnchors({ anchors: [{ name: "A", priority: "bogus", lat: "1", lng: 2 }] }),
      [{ name: "A", lat: null, lng: 2, priority: "want", source: undefined }]
    );
  });

  test("caps at 40 anchors", () => {
    const customPois = Array.from({ length: 60 }, (_, i) => `Place ${i}`);
    assert.equal(normalizeAnchors({ customPois }).length, 40);
  });

  test("geocodeAnchors fills misses from the batch, then the fuzzy fallback", async () => {
    const anchors = [
      { name: "Known", lat: 1, lng: 2, priority: "must" },
      { name: "Batch hit", lat: null, lng: null, priority: "want" },
      { name: "Fuzzy hit", lat: null, lng: null, priority: "want" },
      { name: "Nowhere", lat: null, lng: null, priority: "want" },
    ];
    const out = await geocodeAnchors(anchors, { lat: 0, lon: 0 }, {
      resolve: async (names) => {
        assert.deepEqual(names, ["Batch hit", "Fuzzy hit", "Nowhere"]);
        return { "Batch hit": { lat: 10, lon: 20 } };
      },
      search: async (name) => (name === "Fuzzy hit" ? { lat: 30, lng: 40 } : null),
    });
    assert.deepEqual(out.map((a) => [a.name, a.lat, a.lng]), [
      ["Known", 1, 2],
      ["Batch hit", 10, 20],
      ["Fuzzy hit", 30, 40],
      ["Nowhere", null, null],
    ]);
  });

  test("geocodeAnchors never throws when the lookups do", async () => {
    const anchors = [{ name: "X", lat: null, lng: null, priority: "must" }];
    const out = await geocodeAnchors(anchors, { lat: 0, lon: 0 }, {
      resolve: async () => { throw new Error("overpass down"); },
      search: async () => { throw new Error("also down"); },
    });
    assert.deepEqual(out, anchors);
  });

  test("readUnplaced keeps only well-formed entries", () => {
    assert.deepEqual(readUnplaced("nope"), []);
    assert.deepEqual(readUnplaced(null), []);
    assert.deepEqual(
      readUnplaced([{ name: "Kawagoe", reason: "70 min each way" }, { name: "No reason" }, 4]),
      [{ name: "Kawagoe", reason: "70 min each way" }]
    );
  });
  ```

- [ ] **Step 3: Run the tests and confirm they fail**

  Run: `cd /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec && node --import ./scripts/ts-resolve.mjs --test src/lib/anchors.test.mjs`
  Expected: FAIL, "Cannot find module … anchors.ts".

- [ ] **Step 4: Implement `src/lib/anchors.ts`**

  ```ts
  import type { Anchor, AnchorPriority, UnplacedAnchor } from "./types";
  import { resolveNamedPlaceCoords } from "./poiDetails";
  import { searchPlaces } from "./placeSearch";

  /**
   * The traveler's own places — one normaliser every path goes through.
   *
   * Exists because the wizard's POI picker wrote `selectedPois`/`customPois` into `userAnswers` for
   * months and nothing downstream read them: the one field where a traveler says "we must go here"
   * had no effect on the plan. `anchors` is the new shape; the legacy fields are still folded in
   * because the iOS wizard sends only those.
   */

  export const MAX_ANCHORS = 40;
  /** Fuzzy lookups are one Overpass request per name — see placeSearch.ts on rate limits. */
  const MAX_FUZZY_LOOKUPS = 8;

  /** Case-, accent- and punctuation-blind identity for a place name. */
  export function anchorKey(name: string): string {
    return name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      // Unicode letters and digits, not [a-z0-9]: "浅草寺" or "Łazienki" must not normalise to "".
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }

  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

  /** Trust boundary: `answers` is an unvalidated request body. Malformed entries are dropped. */
  export function normalizeAnchors(answers: unknown): Anchor[] {
    const a = (answers ?? {}) as Record<string, unknown>;
    const out: Anchor[] = [];
    if (Array.isArray(a.anchors)) {
      for (const raw of a.anchors as Record<string, unknown>[]) {
        const name = text(raw?.name);
        if (!name) continue;
        const priority: AnchorPriority = raw.priority === "must" ? "must" : "want";
        const source =
          raw.source === "import" || raw.source === "picked" || raw.source === "typed"
            ? raw.source
            : undefined;
        out.push({ name, lat: num(raw.lat), lng: num(raw.lng), priority, source });
      }
    }
    if (Array.isArray(a.selectedPois)) {
      for (const raw of a.selectedPois as Record<string, unknown>[]) {
        const name = text(raw?.name);
        if (name) out.push({ name, lat: num(raw.lat), lng: num(raw.lon), priority: "want", source: "picked" });
      }
    }
    if (Array.isArray(a.customPois)) {
      for (const raw of a.customPois) {
        const name = text(raw);
        if (name) out.push({ name, lat: null, lng: null, priority: "want", source: "typed" });
      }
    }
    const byKey = new Map<string, Anchor>();
    for (const anchor of out) {
      const key = anchorKey(anchor.name);
      if (!key) continue;
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, anchor);
        continue;
      }
      byKey.set(key, {
        ...prev,
        priority: prev.priority === "must" || anchor.priority === "must" ? "must" : "want",
        lat: prev.lat ?? anchor.lat,
        lng: prev.lng ?? anchor.lng,
      });
    }
    return Array.from(byKey.values()).slice(0, MAX_ANCHORS);
  }

  export interface GeocodeDeps {
    resolve: (names: string[], near: { lat: number; lon: number }) => Promise<Record<string, { lat: number; lon: number }>>;
    search: (name: string, near: { lat: number; lon: number }) => Promise<{ lat: number; lng: number } | null>;
  }

  const defaultDeps: GeocodeDeps = {
    resolve: (names, near) => resolveNamedPlaceCoords(names, near),
    search: async (name, near) => {
      const res = await searchPlaces({ lat: near.lat, lng: near.lon, query: name, radiusM: 30000 });
      const hit = res.places[0];
      return hit ? { lat: hit.lat, lng: hit.lng } : null;
    },
  };

  /** Fills missing coordinates: one batched OSM query, then a few fuzzy lookups. Never throws;
   *  anything still unplaced keeps null coordinates and reaches the model by name. */
  export async function geocodeAnchors(
    anchors: Anchor[],
    near: { lat: number; lon: number },
    deps: GeocodeDeps = defaultDeps
  ): Promise<Anchor[]> {
    const missing = anchors.filter((a) => a.lat === null || a.lng === null).map((a) => a.name);
    if (missing.length === 0) return anchors;
    let batch: Record<string, { lat: number; lon: number }> = {};
    try {
      batch = await deps.resolve(missing, near);
    } catch (err) {
      console.error("[anchors] batch geocode failed", err);
    }
    const found = new Map<string, { lat: number; lng: number }>();
    for (const name of missing) {
      const hit = batch[name.trim()];
      if (hit) found.set(name, { lat: hit.lat, lng: hit.lon });
    }
    for (const name of missing.filter((n) => !found.has(n)).slice(0, MAX_FUZZY_LOOKUPS)) {
      try {
        const hit = await deps.search(name, near);
        if (hit) found.set(name, hit);
      } catch (err) {
        console.error("[anchors] fuzzy geocode failed", err);
      }
    }
    return anchors.map((a) => {
      const hit = found.get(a.name);
      return hit ? { ...a, lat: hit.lat, lng: hit.lng } : a;
    });
  }

  /** The model's `unplaced` array, validated. Anything malformed is dropped. */
  export function readUnplaced(value: unknown): UnplacedAnchor[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((v) => {
      const name = text((v as Record<string, unknown>)?.name);
      const reason = text((v as Record<string, unknown>)?.reason);
      return name && reason ? [{ name, reason }] : [];
    });
  }
  ```

- [ ] **Step 5: Run the tests and confirm they pass**

  Run: `cd /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec && node --import ./scripts/ts-resolve.mjs --test src/lib/anchors.test.mjs`
  Expected: PASS, 8 tests.

- [ ] **Step 6: Typecheck and commit**

  ```bash
  cd /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec && npx tsc --noEmit -p tsconfig.json
  git -C /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec add src/lib/types.ts src/lib/anchors.ts src/lib/anchors.test.mjs
  git -C /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec commit -m "Give the traveler's own places one shape the server can trust"
  ```

---

### Task 3: Anchors reach the prompt and come back on the plan

**Files:**
- Modify: `src/lib/itineraryPrompt.ts` (`SHAPE_HINT`, new `formatAnchors`/`ANCHOR_INSTRUCTION`, `buildGeneratePrompt`,
  `buildRefinePrompt`)
- Modify: `src/lib/generationRunner.ts` (normalise, geocode, pass through, parse `unplaced`, attach to the itinerary)
- Modify: `.claude/skills/itinerary-planner/SKILL.md` (new §15)
- Test: `src/lib/itineraryPrompt.test.mjs` (append)

**Interfaces:**
- Consumes: `normalizeAnchors`, `geocodeAnchors`, `readUnplaced`, `Anchor` (Task 2).
- Produces:
  - `formatAnchors(anchors: Anchor[] | undefined): string` (exported);
  - an optional `anchors?: Anchor[]` param on both `buildGeneratePrompt` and `buildRefinePrompt`;
  - a returned `itinerary` that carries `anchors` and `unplaced`.

- [ ] **Step 1: Write the failing tests**

  Append to `src/lib/itineraryPrompt.test.mjs`. Also add `formatAnchors` and `buildRefinePrompt` to the file's
  existing import from `./itineraryPrompt.ts`.

  ```js
  test("formatAnchors is empty when there are no anchors", () => {
    assert.equal(formatAnchors(undefined), "");
    assert.equal(formatAnchors([]), "");
  });

  test("formatAnchors lists priority, name and coordinates, and states the rule", () => {
    const out = formatAnchors([
      { name: "teamLab Planets", lat: 35.649, lng: 139.79, priority: "must" },
      { name: "Yanaka Ginza", lat: null, lng: null, priority: "want" },
    ]);
    assert.match(out, /MUST: teamLab Planets \(35\.649, 139\.79\)/);
    assert.match(out, /WANT: Yanaka Ginza \(location unknown\)/);
    assert.match(out, /"unplaced"/);
    assert.match(out, /Never drop a MUST place silently/);
  });

  test("generate and refine prompts carry the anchors block and ask for unplaced", () => {
    const anchors = [{ name: "teamLab Planets", lat: 35.6, lng: 139.8, priority: "must" }];
    const gen = buildGeneratePrompt({
      destination: "Tokyo", startDate: "2026-10-01", endDate: "2026-10-03", budget: 2000,
      tier: "midrange", weather: [], anchors,
    });
    const ref = buildRefinePrompt({
      destination: "Tokyo", startDate: "2026-10-01", endDate: "2026-10-03", budget: 2000,
      previousItinerary: { tier: "midrange", days: DAYS }, feedback: "slower", anchors,
    });
    for (const p of [gen, ref]) {
      assert.match(p, /MUST: teamLab Planets/);
      assert.match(p, /"unplaced":\[/);
    }
  });
  ```

- [ ] **Step 2: Run and confirm the failure**

  Run: `cd /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec && node --import ./scripts/ts-resolve.mjs --test src/lib/itineraryPrompt.test.mjs`
  Expected: FAIL, `formatAnchors` is not exported.

- [ ] **Step 3: Implement the prompt pieces**

  In `src/lib/itineraryPrompt.ts`:
  - Add `Anchor` to the `import type { … } from "./types"` line. It must be a type-only import.
  - Replace the `SHAPE_HINT` line with:

  ```ts
  const SHAPE_HINT = `{"days":[${DAY_SHAPE}],"unplaced":[{"name":"one of the traveler's MUST places","reason":"one concrete line"}]}`;
  ```

  Add, right after `FOOD_STOP_INSTRUCTION`:

  ```ts
  /** The traveler's own places. The rule lives here, not in SKILL.md, because this legacy path never
   *  loads the skill — every rule it follows is a constant in this file. SKILL.md §15 carries the
   *  same rule for the edit loop, which does load it. Keep the two in step. */
  const ANCHOR_INSTRUCTION = `Schedule every MUST place as a stop, on a day and at a time it is open, unless that is impossible — closed on every day the trip is near it, too far to reach and return within a day, or more MUST places than the days can hold. Fit WANT places where they suit a day's route; skipping one is fine. Use the traveler's name for the place in the stop's "name" so it can be recognised. For every MUST place you could not schedule, add an entry to the top-level "unplaced" array with a one-line, concrete reason (e.g. "Closed Tuesdays, the only day the plan is nearby"). Never drop a MUST place silently. Use "unplaced": [] when everything fits.`;

  export function formatAnchors(anchors: Anchor[] | undefined): string {
    if (!anchors || anchors.length === 0) return "";
    const lines = anchors.map((a) => {
      const where = a.lat !== null && a.lng !== null ? `(${a.lat}, ${a.lng})` : "(location unknown)";
      return `- ${a.priority === "must" ? "MUST" : "WANT"}: ${a.name} ${where}`;
    });
    return `\nThe traveler's own places — they chose these before asking for a plan:\n${lines.join("\n")}\n${ANCHOR_INSTRUCTION}\n`;
  }
  ```

  In **both** `buildGeneratePrompt` and `buildRefinePrompt`:
  - add `anchors?: Anchor[];` to the params type;
  - append `${formatAnchors(params.anchors)}` directly after `${formatContextBlock(params.contextInsight)}` in the
    template string.

- [ ] **Step 4: Run the prompt tests and confirm they pass**

  Run: `cd /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec && node --import ./scripts/ts-resolve.mjs --test src/lib/itineraryPrompt.test.mjs`
  Expected: PASS. This includes the existing shape-drift tests, since `DAY_SHAPE` is unchanged.

- [ ] **Step 5: Wire the anchors through `runGeneration`**

  In `src/lib/generationRunner.ts`:
  1. Add `import { geocodeAnchors, normalizeAnchors, readUnplaced } from "./anchors";`, and `Anchor` to the
     existing type import from `./types`.
  2. After the `if (userAnswers) { try { … } }` block (the one that sets `resolvedFlags`), add:

     ```ts
     // Refine keeps the places the plan was generated around; a refine body carries no answers of
     // its own worth trusting over them. Generate normalises whatever the wizard sent.
     let anchors: Anchor[] = isRefine
       ? previousItinerary?.anchors ?? []
       : normalizeAnchors(userAnswers);
     ```

  3. In the generate branch, right after `onStage({ stage: "geocode", status: geoPoint ? "done" : "skipped" });`,
     add:

     ```ts
     // Import already geocoded what it could; this only fills typed and legacy entries. Skipped
     // with no city point, and never fatal — an unplaced anchor still reaches the model by name.
     if (geoPoint && anchors.length > 0) anchors = await geocodeAnchors(anchors, geoPoint);
     ```

  4. Add `anchors,` to **both** `contextPayload = { … }` objects (refine and generate). They are passed straight
     into the builders, so this is the whole wiring.
  5. Replace the parse lines:

     ```ts
     const { days } = parseJsonResponse<{ days: Itinerary["days"] }>(raw);
     const itinerary: Itinerary = {
       tier: effectiveTier,
       days: normalizeDays(days),
     };
     ```

     with:

     ```ts
     const { days, unplaced } = parseJsonResponse<{ days: Itinerary["days"]; unplaced?: unknown }>(raw);
     const itinerary: Itinerary = {
       tier: effectiveTier,
       days: normalizeDays(days),
       // Echoed back so the receipt survives save/reload/critique — critique only reassigns `days`.
       ...(anchors.length > 0 ? { anchors, unplaced: readUnplaced(unplaced) } : {}),
     };
     ```

- [ ] **Step 6: Add SKILL.md §15**

  Append to `.claude/skills/itinerary-planner/SKILL.md`:

  ```markdown
  ## §15. The traveler's own places

  A plan may carry `anchors`: places the traveler chose before asking for a plan, each `must` or `want`.

  - Schedule every `must` unless it is impossible: closed on every day the plan is nearby, too far to
    reach and return within a day, or more `must` places than the days can hold. List each one you could
    not schedule in `unplaced` with a one-line, concrete reason.
  - Fit `want` places where they suit a day's route; skipping one needs no explanation.
  - When editing, never remove a `must` stop unless the traveler asked for that place to go. If an edit
    forces it out, say so in the reply and add it to `unplaced`.
  - Use the traveler's name for the place as the stop name, so it can be matched back.

  The generate prompt in `src/lib/itineraryPrompt.ts` (`ANCHOR_INSTRUCTION`) carries the same rule for the
  legacy path, which does not load this skill. Keep the two in step.
  ```

- [ ] **Step 7: Verify end to end against a dev server**

  Start the server in the worktree with the `preview_start` tool (add a `.claude/launch.json` entry for
  `npm run dev` if one doesn't exist yet). Then run:

  ```bash
  curl -sN -X POST 'http://localhost:3000/api/itinerary' -H 'content-type: application/json' -d '{
    "destination":"Kyoto, Japan","startDate":"2026-10-06","endDate":"2026-10-07","budget":800,"tier":"midrange",
    "userAnswers":{"budget":800,"energy":"moderate","crowds":"mixed","priorities":[],"topPriorities":[],
      "selectedPois":[],"customPois":["Nishiki Market"],
      "anchors":[{"name":"Kinkaku-ji","lat":null,"lng":null,"priority":"must"},
                 {"name":"Tokyo Skytree","lat":null,"lng":null,"priority":"must"}]}}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(JSON.stringify({anchors:j.itinerary.anchors,unplaced:j.itinerary.unplaced},null,1))})'
  ```

  If the JSON route's response key differs from `itinerary`, adjust the reader to match `route.ts`.
  Expected: `anchors` lists 3 entries, with Kinkaku-ji carrying real coordinates. `unplaced` names Tokyo Skytree
  (it is in another city) with a reason. Some stop's name contains "Kinkaku-ji".

- [ ] **Step 8: Run the full suite, typecheck and lint, then commit**

  ```bash
  cd /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec && npm test && npx tsc --noEmit -p tsconfig.json && npm run lint
  git -C /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec add src/lib/itineraryPrompt.ts src/lib/itineraryPrompt.test.mjs src/lib/generationRunner.ts .claude/skills/itinerary-planner/SKILL.md
  git -C /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec commit -m "Make the places a traveler names actually shape their plan"
  ```

---

### Task 4: Coverage check and the receipt

**Files:**
- Modify: `src/lib/guardrails.ts` (add rule `"anchors"`, `anchorCoverage`, `evaluateAnchors`; include them in
  `evaluateItinerary`)
- Create: `src/components/AnchorReceipt.tsx`
- Modify: `src/components/ItineraryCard.tsx` (render the receipt; new optional prop `onFitAnchor`)
- Modify: `src/app/HomeView.tsx` (pass `onFitAnchor` → `refine(...)`)
- Test: `src/lib/guardrails.test.mjs` (append)

**Interfaces:**
- Consumes: `Itinerary.anchors` / `unplaced`, `anchorKey` (Tasks 2–3).
- Produces:
  - `anchorCoverage(itinerary: Itinerary): AnchorCoverage | null`
  - `interface AnchorCoverage { total: number; placed: { name: string; dayIndex: number }[]; unplaced: UnplacedAnchor[]; missing: string[] }`
  - `evaluateAnchors(itinerary: Itinerary): Guardrail[]`
  - `<AnchorReceipt itinerary onFitAnchor? />`

- [ ] **Step 1: Write the failing tests**

  Append to `src/lib/guardrails.test.mjs`, and extend its import to
  `{ anchorCoverage, evaluateAnchors, evaluateBudget, evaluateDay }`:

  ```js
  const stop = (name, lat = 0, lng = 0) => ({
    name, lat, lng, cost: 0, note: "", time: "9:00 AM", durationLabel: "1 hour", category: "other",
  });
  const planWith = (stopsByDay, anchors, unplaced = []) => ({
    tier: "midrange",
    days: stopsByDay.map((stops, i) => ({ date: `2026-10-0${i + 1}`, weather: "", stops })),
    anchors,
    unplaced,
  });

  test("anchorCoverage is null for a plan with no anchors", () => {
    assert.equal(anchorCoverage({ tier: "midrange", days: [] }), null);
  });

  test("a must counts as placed by a wrapping stop name, on the right day", () => {
    const cov = anchorCoverage(planWith(
      [[stop("Breakfast nearby")], [stop("Morning at teamLab Planets")]],
      [{ name: "teamLab Planets", lat: null, lng: null, priority: "must" }]
    ));
    assert.deepEqual(cov.placed, [{ name: "teamLab Planets", dayIndex: 1 }]);
    assert.deepEqual(cov.missing, []);
  });

  test("a must counts as placed within 150m even under another name", () => {
    const cov = anchorCoverage(planWith(
      [[stop("Senso-ji Temple", 35.7148, 139.7967)]],
      [{ name: "浅草寺", lat: 35.7149, lng: 139.7966, priority: "must" }]
    ));
    assert.equal(cov.placed.length, 1);
  });

  test("an explained must is unplaced; an unexplained one is missing and warned", () => {
    const plan = planWith(
      [[stop("Somewhere else", 10, 10)]],
      [
        { name: "Kawagoe", lat: 35.9, lng: 139.5, priority: "must" },
        { name: "Ghibli Museum", lat: 35.69, lng: 139.57, priority: "must" },
        { name: "Yanaka Ginza", lat: null, lng: null, priority: "want" },
      ],
      [{ name: "Kawagoe", reason: "70 min each way" }]
    );
    const cov = anchorCoverage(plan);
    assert.equal(cov.total, 2);
    assert.deepEqual(cov.unplaced, [{ name: "Kawagoe", reason: "70 min each way" }]);
    assert.deepEqual(cov.missing, ["Ghibli Museum"]);
    const warnings = evaluateAnchors(plan);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].rule, "anchors");
    assert.match(warnings[0].message, /Ghibli Museum/);
  });
  ```

- [ ] **Step 2: Run and confirm the failure**

  Run: `cd /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec && node --import ./scripts/ts-resolve.mjs --test src/lib/guardrails.test.mjs`
  Expected: FAIL, `anchorCoverage` is not exported.

- [ ] **Step 3: Implement in `src/lib/guardrails.ts`**

  - Change the union to `export type GuardrailRule = "travel" | "overlap" | "pace" | "budget" | "anchors";`.
  - Add `UnplacedAnchor` to the type import from `./types`, and add `import { anchorKey } from "./anchors";`.
  - Append:

  ```ts
  /** How close a stop must be to an anchor's coordinates to count as that place, whatever it's called. */
  const ANCHOR_MATCH_METRES = 150;

  function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const p = Math.PI / 180;
    const h =
      Math.sin(((b.lat - a.lat) * p) / 2) ** 2 +
      Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(((b.lng - a.lng) * p) / 2) ** 2;
    return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
  }

  export interface AnchorCoverage {
    /** `must` anchors only — a skipped `want` needs no explanation. */
    total: number;
    placed: { name: string; dayIndex: number }[];
    unplaced: UnplacedAnchor[];
    /** Neither scheduled nor explained: the model dropped it silently. */
    missing: string[];
  }

  /**
   * Which of the traveler's `must` places made it into the plan. Checked here, in code, because the
   * receipt is a promise to the traveler — it must never take the model's word for it.
   */
  export function anchorCoverage(itinerary: Itinerary): AnchorCoverage | null {
    const musts = (itinerary.anchors ?? []).filter((a) => a.priority === "must");
    if (musts.length === 0) return null;
    const explained = new Map((itinerary.unplaced ?? []).map((u) => [anchorKey(u.name), u]));
    const cov: AnchorCoverage = { total: musts.length, placed: [], unplaced: [], missing: [] };
    for (const anchor of musts) {
      const key = anchorKey(anchor.name);
      const dayIndex = itinerary.days.findIndex((day) =>
        day.stops.some(
          (s) =>
            (key && anchorKey(s.name).includes(key)) ||
            (anchor.lat !== null &&
              anchor.lng !== null &&
              metresBetween(s, { lat: anchor.lat, lng: anchor.lng }) <= ANCHOR_MATCH_METRES)
        )
      );
      if (dayIndex !== -1) cov.placed.push({ name: anchor.name, dayIndex });
      else if (explained.has(key)) cov.unplaced.push(explained.get(key)!);
      else cov.missing.push(anchor.name);
    }
    return cov;
  }

  export function evaluateAnchors(itinerary: Itinerary): Guardrail[] {
    return (anchorCoverage(itinerary)?.missing ?? []).map((name) => ({
      rule: "anchors" as const,
      message: `${name} isn't in the plan, and the planner didn't say why.`,
      dayIndex: null,
    }));
  }
  ```

  In `evaluateItinerary`, change the return to `return [...perDay, ...budget, ...evaluateAnchors(itinerary)];`.

- [ ] **Step 4: Run the tests and confirm they pass**

  Run: `cd /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec && node --import ./scripts/ts-resolve.mjs --test src/lib/guardrails.test.mjs`
  Expected: PASS.

- [ ] **Step 5: Build the receipt component**

  Create `src/components/AnchorReceipt.tsx`:

  ```tsx
  "use client";

  import { anchorCoverage } from "@/lib/guardrails";
  import type { Itinerary } from "@/lib/types";

  /**
   * "11 of your 12 places are in the plan" — the promise the import step made, kept in writing.
   * Computed from the plan itself (anchorCoverage), never from what the model claimed.
   */
  export default function AnchorReceipt({
    itinerary,
    onFitAnchor,
  }: {
    itinerary: Itinerary;
    /** Absent where the plan can't be regenerated (saved-trip views): the button is then hidden. */
    onFitAnchor?: (name: string) => void;
  }) {
    const cov = anchorCoverage(itinerary);
    if (!cov) return null;
    const notIn = [
      ...cov.unplaced,
      ...cov.missing.map((name) => ({ name, reason: "Left out without a reason." })),
    ];
    return (
      <section aria-label="Your places" className="mb-3 rounded-xl bg-[var(--surface-deep)]/60 px-3 py-2 text-sm">
        <p className="font-medium">
          {cov.placed.length} of your {cov.total} must-see {cov.total === 1 ? "place is" : "places are"} in the plan.
        </p>
        {notIn.length > 0 && (
          <ul className="mt-1 space-y-1 text-muted">
            {notIn.map((u) => (
              <li key={u.name} className="flex items-baseline justify-between gap-3">
                <span>
                  <span className="text-[var(--text)]">{u.name}</span>: {u.reason}
                </span>
                {onFitAnchor && (
                  <button type="button" className="shrink-0 text-[var(--jade)] underline-offset-2 hover:underline" onClick={() => onFitAnchor(u.name)}>
                    Fit it anyway
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }
  ```

  Before writing it, check that the CSS variables used above (`--surface-deep`, `--text`, `--jade`) exist:
  `grep -n "\-\-surface-deep\|\-\-jade\|\-\-text:" src/app/globals.css`. Replace any that don't exist with the
  nearest ones used by `BudgetBar.tsx`.

- [ ] **Step 6: Mount it in `ItineraryCard` and wire it up in `HomeView`**

  In `src/components/ItineraryCard.tsx`:
  - Add `import AnchorReceipt from "./AnchorReceipt";`.
  - Add `onFitAnchor?: (name: string) => void;` to the props type and to the destructure at
    `export default function ItineraryCard({`.
  - Render `<AnchorReceipt itinerary={itinerary} onFitAnchor={onFitAnchor} />` directly above the per-day summary
    line (`{day.summary && <p className="mb-3 text-sm text-muted">…`). The card shows one day at a time, so this
    puts the trip-level receipt at the top of whichever day is open.

  In `src/app/HomeView.tsx`, on the `<ItineraryCard` at the generation result, add:

  ```tsx
  onFitAnchor={(name) =>
    refine(`Please fit ${name} into the plan. It matters to us; drop or move something else to make room.`)
  }
  ```

- [ ] **Step 7: Verify in the browser**

  With the dev server running, run a generation from the wizard that has one impossible must (use the Task 3 curl
  pair, typed into "Add a spot", and star it once Task 11 lands; until then use the curl response). Load the plan
  and use `read_page` to confirm the text "of your 2 must-see places are in the plan" and a "Fit it anyway"
  button. Take a screenshot.

- [ ] **Step 8: Suite, typecheck, lint and commit**

  ```bash
  cd /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec && npm test && npx tsc --noEmit -p tsconfig.json && npm run lint
  git -C /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec add src/lib/guardrails.ts src/lib/guardrails.test.mjs src/components/AnchorReceipt.tsx src/components/ItineraryCard.tsx src/app/HomeView.tsx
  git -C /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec commit -m "Show the traveler which of their places made it into the plan"
  ```

---

### Task 5: The `extract` and `sketch` call types

**Files:**
- Modify: `src/lib/llmConfig.ts` (union, `apiModelFor`, `maxTokensFor`)
- Modify: `src/app/api/llm-mode/route.ts` (`CALL_TYPES`)
- Test: `src/lib/llmConfig.test.mjs` (append)

**Interfaces:**
- Produces: `ClaudeCallType` gains `"extract" | "sketch"`. Both route to `cheapModel()`, with `maxTokensFor` of
  4,000 and 6,000 respectively.

- [ ] **Step 1: Write the failing test** (append to `src/lib/llmConfig.test.mjs`)

  ```js
  describe("import and sketch call types", () => {
    it("route to the cheap tier with bounded output", () => {
      for (const type of ["extract", "sketch"]) {
        assert.equal(apiModelFor(type), cheapModel());
      }
      assert.equal(maxTokensFor("extract"), 4_000);
      assert.equal(maxTokensFor("sketch"), 6_000);
    });
  });
  ```

- [ ] **Step 2: Run it and confirm it fails**

  Run: `cd /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec && node --import ./scripts/ts-resolve.mjs --test src/lib/llmConfig.test.mjs`
  Expected: FAIL. `apiModelFor("extract")` returns `undefined`.

- [ ] **Step 3: Implement**

  In `src/lib/llmConfig.ts`, add these to the `ClaudeCallType` union after `"story"`:

  ```ts
    /** Chaos-in import: names every place in a pile of screenshots, links and notes. */
    | "extract"
    /** The ~20s day sketch — themes, areas and anchor assignment — shown before the full plan. */
    | "sketch"
  ```

  In `apiModelFor`, add `case "extract": case "sketch":` to the `cheapModel()` group.
  In `maxTokensFor`, add:

  ```ts
      // A list of place names, one short object each.
      case "extract":
        return 4_000;
      // One short object per day, at most 14 days.
      case "sketch":
        return 6_000;
  ```

  In `src/app/api/llm-mode/route.ts`, insert `"extract",` at the start of `CALL_TYPES` (before `"context"`), and
  `"sketch",` immediately before `"generate"`.

- [ ] **Step 4: Run the tests and typecheck**

  Run: `cd /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec && node --import ./scripts/ts-resolve.mjs --test src/lib/llmConfig.test.mjs && npx tsc --noEmit -p tsconfig.json`
  Expected: PASS, and tsc is clean. The exhaustive switches would fail tsc if a case were missing.

- [ ] **Step 5: Commit**

  ```bash
  git -C /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec add src/lib/llmConfig.ts src/lib/llmConfig.test.mjs src/app/api/llm-mode/route.ts
  git -C /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec commit -m "Add cheap-tier call types for reading a pile and sketching the days"
  ```

---

### Task 6: `runClaude` accepts images

**Files:**
- Modify: `src/lib/claude.ts`
- Test: `src/lib/claude.test.mjs` (append)

**Interfaces:**
- Produces:
  - `interface ImageInput { mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string }` (`data` is
    base64);
  - `meta.images?: ImageInput[]` on `runClaude`;
  - `imageTraceMarker(images): string`;
  - `cliStdinMessage(prompt, images): string`;
  - `userContent(prompt, images)`;
  - `CLI_SUPPORTS_IMAGES: boolean`.

- [ ] **Step 1: Write the failing tests** (append to `src/lib/claude.test.mjs` and extend its import from `./claude.ts`)

  ```js
  import { cliStdinMessage, imageTraceMarker, userContent } from "./claude.ts";

  const IMG = { mediaType: "image/jpeg", data: "A".repeat(4096) };

  test("image trace marker records count and size, never the bytes", () => {
    const marker = imageTraceMarker([IMG, IMG]);
    assert.equal(marker, "\n\n[image 1 · 3KB] [image 2 · 3KB]");
    assert.ok(!marker.includes("AAAA"));
  });

  test("userContent is the bare string without images, blocks with them", () => {
    assert.equal(userContent("hi", undefined), "hi");
    const blocks = userContent("hi", [IMG]);
    assert.deepEqual(blocks.map((b) => b.type), ["image", "text"]);
    assert.equal(blocks[0].source.media_type, "image/jpeg");
  });

  test("cliStdinMessage is one SDK user message line", () => {
    const line = cliStdinMessage("hi", [IMG]);
    assert.ok(line.endsWith("\n"));
    const msg = JSON.parse(line);
    assert.equal(msg.type, "user");
    assert.equal(msg.message.role, "user");
    assert.equal(msg.message.content.length, 2);
  });
  ```

  The size shown is the decoded byte count, `Math.round(data.length * 3 / 4 / 1024)`, and 4,096 base64 characters
  decode to 3KB.

- [ ] **Step 2: Run and confirm the failure**

  Run: `cd /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec && node --import ./scripts/ts-resolve.mjs --test src/lib/claude.test.mjs`
  Expected: FAIL, the named exports are missing.

- [ ] **Step 3: Implement the helpers** (in `src/lib/claude.ts`, above `runClaudeViaCli`)

  ```ts
  /** A screenshot, base64-encoded, for the chaos-in import. Never persisted anywhere. */
  export interface ImageInput {
    mediaType: "image/jpeg" | "image/png" | "image/webp";
    data: string;
  }

  /**
   * Set from the 2026-09-25 spike (see the chaos-in spec): whether `claude -p --input-format
   * stream-json` accepts an image block with `--tools ""`. When false, an image call on the CLI
   * transport throws a clear error rather than silently dropping the pictures.
   */
  export const CLI_SUPPORTS_IMAGES = true;

  /** What `llm_traces.prompt` records in place of image bytes — the SQLite file is shared, and
   *  every traveller's camera roll must not end up in it. */
  export function imageTraceMarker(images: ImageInput[]): string {
    const parts = images.map(
      (img, i) => `[image ${i + 1} · ${Math.round((img.data.length * 3) / 4 / 1024)}KB]`
    );
    return `\n\n${parts.join(" ")}`;
  }

  export function userContent(
    prompt: string,
    images: ImageInput[] | undefined
  ): string | Anthropic.Messages.ContentBlockParam[] {
    if (!images?.length) return prompt;
    return [
      ...images.map((img) => ({
        type: "image" as const,
        source: { type: "base64" as const, media_type: img.mediaType, data: img.data },
      })),
      { type: "text" as const, text: prompt },
    ];
  }

  /** One SDK user message on one line, for `--input-format stream-json` over stdin. */
  export function cliStdinMessage(prompt: string, images: ImageInput[]): string {
    return `${JSON.stringify({ type: "user", message: { role: "user", content: userContent(prompt, images) } })}\n`;
  }
  ```

  If the Task 1 spike **failed**, set `CLI_SUPPORTS_IMAGES = false`.

- [ ] **Step 4: Thread `images` through both transports**

  - Add `images?: ImageInput[];` to the `meta` type of `runClaudeViaCli`, `runClaudeViaApi` **and** `runClaude`.
  - In **both** transports, change the trace insert to:

    ```ts
    const traceId = insertTrace({
      type,
      prompt: meta?.images?.length ? prompt + imageTraceMarker(meta.images) : prompt,
      model,
      runId: meta?.runId,
    });
    ```

  **In `runClaudeViaCli`:**
  1. Directly after the `insertTrace` line, add:

     ```ts
     const images = meta?.images?.length ? meta.images : null;
     if (images && !CLI_SUPPORTS_IMAGES) {
       const message = "screenshot reading needs LLM_TRANSPORT=api — this CLI cannot take image input";
       updateTrace(traceId, { status: "error", durationMs: 0, errorMessage: message });
       reject(new Error(message));
       return;
     }
     ```

  2. Change `const streaming = Boolean(meta?.onText);` to:

     ```ts
     // Image input requires stream-json in *and* out; the existing result-line handling covers it.
     const streaming = Boolean(meta?.onText) || Boolean(images);
     ```

  3. In the `spawn` args, replace the two elements `"-p", prompt,` with
     `...(images ? ["-p", "--input-format", "stream-json"] : ["-p", prompt]),`.
  4. Change the spawn options to `{ env, stdio: [images ? "pipe" : "ignore", "pipe", "pipe"] }`.
  5. Directly after the `spawn(...)` call, add `if (images) child.stdin?.end(cliStdinMessage(prompt, images));`.

  **In `runClaudeViaApi`:** change `{ role: "user", content: prompt },` inside `const messages = [...]` to
  `{ role: "user", content: userContent(prompt, meta?.images) },`. Leave the `newTurns` entry as the text
  `prompt`: sessions must never store image bytes, and `extract` never persists a session anyway.

- [ ] **Step 5: Run the tests, typecheck, then do a live check on CLI**

  Run: `cd /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec && node --import ./scripts/ts-resolve.mjs --test src/lib/claude.test.mjs && npx tsc --noEmit -p tsconfig.json`
  Expected: PASS.

  The live check goes through Task 10's route. It is deferred there rather than duplicated here.

- [ ] **Step 6: Commit**

  ```bash
  git -C /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec add src/lib/claude.ts src/lib/claude.test.mjs
  git -C /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec commit -m "Let a model call look at a screenshot without storing it"
  ```

---

### Task 7: Classifying items and parsing Google Maps links

**Files:**
- Create: `src/lib/importSources.ts` (pure part)
- Test: `src/lib/importSources.test.mjs`

**Interfaces:**
- Produces:
  - `type ImportItem = { kind: "image"; mediaType: ImageInput["mediaType"]; data: string } | { kind: "url"; url: string } | { kind: "text"; text: string }`
  - `type SourceKind = "image" | "tiktok" | "youtube" | "gmaps" | "instagram" | "url" | "text"`
  - `classifyItem(item: ImportItem): SourceKind`
  - `parseGoogleMapsUrl(url: string): { name: string; lat: number; lng: number } | null`
  - `isPublicAddress(ip: string): boolean`

- [ ] **Step 1: Write the failing tests**

  Create `src/lib/importSources.test.mjs`:

  ```js
  /* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/importSources.test.mjs */
  import assert from "node:assert/strict";
  import test from "node:test";
  import { classifyItem, isPublicAddress, parseGoogleMapsUrl } from "./importSources.ts";

  test("classifyItem recognises each source", () => {
    const url = (u) => classifyItem({ kind: "url", url: u });
    assert.equal(url("https://www.tiktok.com/@a/video/123"), "tiktok");
    assert.equal(url("https://vm.tiktok.com/ZMabc/"), "tiktok");
    assert.equal(url("https://youtu.be/abc"), "youtube");
    assert.equal(url("https://www.youtube.com/shorts/abc"), "youtube");
    assert.equal(url("https://www.instagram.com/reel/abc/"), "instagram");
    assert.equal(url("https://maps.app.goo.gl/xyz"), "gmaps");
    assert.equal(url("https://www.google.com/maps/place/X/@1,2,15z"), "gmaps");
    assert.equal(url("https://example.com/blog"), "url");
    assert.equal(url("not a url"), "text");
    assert.equal(classifyItem({ kind: "text", text: "go to Nishiki" }), "text");
    assert.equal(classifyItem({ kind: "image", mediaType: "image/png", data: "" }), "image");
  });

  test("parseGoogleMapsUrl prefers the place pin over the viewport centre", () => {
    const u =
      "https://www.google.com/maps/place/teamLab+Planets+TOKYO/@35.6491,139.7898,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d35.64903!4d139.78993";
    assert.deepEqual(parseGoogleMapsUrl(u), { name: "teamLab Planets TOKYO", lat: 35.64903, lng: 139.78993 });
  });

  test("parseGoogleMapsUrl decodes names and falls back to the @ centre", () => {
    const u = "https://www.google.com/maps/place/Caf%C3%A9+de+Flore/@48.854,2.3326,17z";
    assert.deepEqual(parseGoogleMapsUrl(u), { name: "Café de Flore", lat: 48.854, lng: 2.3326 });
  });

  test("parseGoogleMapsUrl returns null for links it cannot read", () => {
    assert.equal(parseGoogleMapsUrl("https://maps.app.goo.gl/xyz"), null);
    assert.equal(parseGoogleMapsUrl("https://www.google.com/maps/@35,139,12z"), null);
    assert.equal(parseGoogleMapsUrl("garbage"), null);
  });

  test("isPublicAddress refuses private, loopback, link-local and mapped addresses", () => {
    for (const ip of ["10.0.0.1", "172.16.5.4", "192.168.1.1", "127.0.0.1", "169.254.169.254", "0.0.0.0",
                      "100.64.0.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "nonsense"]) {
      assert.equal(isPublicAddress(ip), false, ip);
    }
    for (const ip of ["8.8.8.8", "172.32.0.1", "2606:4700:4700::1111"]) {
      assert.equal(isPublicAddress(ip), true, ip);
    }
  });
  ```

- [ ] **Step 2: Run and confirm the failure**

  Run: `cd /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec && node --import ./scripts/ts-resolve.mjs --test src/lib/importSources.test.mjs`
  Expected: FAIL, module not found.

- [ ] **Step 3: Implement the pure part** (create `src/lib/importSources.ts`)

  ```ts
  import { isIP } from "node:net";
  import type { ImageInput } from "./claude";

  /**
   * The chaos-in import's input side: what a dropped item is, and — for links — what it says.
   * Instagram is recognised only so it can be refused with a useful message: its oEmbed needs a
   * Meta app token, so a screenshot is the realistic way in.
   */

  export type ImportItem =
    | { kind: "image"; mediaType: ImageInput["mediaType"]; data: string }
    | { kind: "url"; url: string }
    | { kind: "text"; text: string };

  export type SourceKind = "image" | "tiktok" | "youtube" | "gmaps" | "instagram" | "url" | "text";

  export function classifyItem(item: ImportItem): SourceKind {
    if (item.kind === "image") return "image";
    if (item.kind === "text") return "text";
    let host: string;
    let path: string;
    try {
      const u = new URL(item.url);
      host = u.hostname.replace(/^www\./, "");
      path = u.pathname;
    } catch {
      return "text";
    }
    if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
    if (host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com")) return "youtube";
    if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
    if (host === "maps.app.goo.gl" || host === "goo.gl" || (host.startsWith("google.") && path.startsWith("/maps")) || host === "maps.google.com") {
      return "gmaps";
    }
    return "url";
  }

  /** `/maps/place/<name>/@<lat>,<lng>` — with `!3d<lat>!4d<lng>` (the pin itself) preferred over the
   *  `@` viewport centre when both are present. Short links must be resolved by the caller first. */
  export function parseGoogleMapsUrl(url: string): { name: string; lat: number; lng: number } | null {
    const place = url.match(/\/maps\/place\/([^/]+)\//);
    if (!place) return null;
    const pin = url.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    const centre = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    const coords = pin ?? centre;
    if (!coords) return null;
    let name: string;
    try {
      name = decodeURIComponent(place[1].replace(/\+/g, " ")).trim();
    } catch {
      return null;
    }
    return name ? { name, lat: Number(coords[1]), lng: Number(coords[2]) } : null;
  }

  /** SSRF guard: only addresses on the public internet may be fetched on a traveller's behalf. */
  export function isPublicAddress(ip: string): boolean {
    const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1]);
    const version = isIP(ip);
    if (version === 4) {
      const [a, b] = ip.split(".").map(Number);
      return !(
        a === 0 || a === 10 || a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        a >= 224
      );
    }
    if (version === 6) {
      const v = ip.toLowerCase();
      return !(v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || /^fe[89ab]/.test(v));
    }
    return false;
  }
  ```

- [ ] **Step 4: Run the tests and confirm they pass**

  Run: `cd /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec && node --import ./scripts/ts-resolve.mjs --test src/lib/importSources.test.mjs`
  Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

  ```bash
  git -C /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec add src/lib/importSources.ts src/lib/importSources.test.mjs
  git -C /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec commit -m "Tell a TikTok from a Maps pin from a friend's note"
  ```

---

### Task 8: Reading links safely

**Files:**
- Modify: `src/lib/importSources.ts` (add `guardedFetch`, `readLink`, `resolveFinalUrl`)
- Test: `src/lib/importSources.test.mjs` (append)

**Interfaces:**
- Consumes: `isPublicAddress`, `classifyItem` (Task 7).
- Produces:
  - `interface LinkDeps { fetch: typeof fetch; lookup: (host: string) => Promise<string> }`
  - `readLink(url: string, deps?: LinkDeps): Promise<{ title: string; text: string } | null>`
  - `resolveFinalUrl(url: string, deps?: LinkDeps): Promise<string | null>`

- [ ] **Step 1: Write the failing tests** (append to the test file, and extend its import with
  `readLink, resolveFinalUrl`)

  ```js
  /** A fake network: `routes` maps a URL to a Response or a function returning one; `ips` maps a host to an address. */
  const fakeNet = (routes, ips = {}) => ({
    lookup: async (host) => ips[host] ?? "93.184.216.34",
    fetch: async (input) => {
      const url = String(input);
      const r = routes[url];
      if (!r) throw new Error(`unexpected fetch ${url}`);
      return typeof r === "function" ? r() : r.clone();
    },
  });
  const redirect = (to) => new Response(null, { status: 302, headers: { location: to } });

  test("readLink refuses http and private hosts", async () => {
    assert.equal(await readLink("http://example.com/", fakeNet({})), null);
    assert.equal(await readLink("https://internal.example/", fakeNet({}, { "internal.example": "10.0.0.5" })), null);
  });

  test("readLink refuses a redirect into the private network", async () => {
    const net = fakeNet(
      { "https://bit.ly/x": redirect("https://metadata.local/latest") },
      { "metadata.local": "169.254.169.254" }
    );
    assert.equal(await readLink("https://bit.ly/x", net), null);
  });

  test("readLink stops after 3 redirects", async () => {
    const net = fakeNet({
      "https://a.test/0": redirect("https://a.test/1"),
      "https://a.test/1": redirect("https://a.test/2"),
      "https://a.test/2": redirect("https://a.test/3"),
      "https://a.test/3": redirect("https://a.test/4"),
    });
    assert.equal(await readLink("https://a.test/0", net), null);
  });

  test("readLink reads a TikTok caption through oEmbed", async () => {
    const video = "https://www.tiktok.com/@a/video/1";
    const net = fakeNet({
      [`https://www.tiktok.com/oembed?url=${encodeURIComponent(video)}`]: new Response(
        JSON.stringify({ title: "Best ramen in Shibuya: Ichiran & Afuri" }),
        { headers: { "content-type": "application/json" } }
      ),
    });
    assert.deepEqual(await readLink(video, net), { title: "Best ramen in Shibuya: Ichiran & Afuri", text: "" });
  });

  test("readLink reads an ordinary page's title and og tags", async () => {
    const html = `<html><head><title>10 Kyoto cafés</title><meta property="og:description" content="Weekenders, % Arabica"></head></html>`;
    const net = fakeNet({ "https://blog.test/kyoto": new Response(html, { headers: { "content-type": "text/html" } }) });
    assert.deepEqual(await readLink("https://blog.test/kyoto", net), { title: "10 Kyoto cafés", text: "Weekenders, % Arabica" });
  });

  test("resolveFinalUrl follows a Maps short link to the place URL", async () => {
    const long = "https://www.google.com/maps/place/X/@1,2,15z";
    const net = fakeNet({ "https://maps.app.goo.gl/abc": redirect(long), [long]: new Response("ok") });
    assert.equal(await resolveFinalUrl("https://maps.app.goo.gl/abc", net), long);
  });
  ```

- [ ] **Step 2: Run and confirm the failure**

  Run: `cd /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec && node --import ./scripts/ts-resolve.mjs --test src/lib/importSources.test.mjs`
  Expected: FAIL, `readLink` is not exported.

- [ ] **Step 3: Implement** (append to `src/lib/importSources.ts`, and add `import { lookup as dnsLookup } from "node:dns/promises";`
  at the top)

  ```ts
  const LINK_TIMEOUT_MS = 8_000;
  const MAX_REDIRECTS = 3;
  const MAX_BODY_BYTES = 512 * 1024;

  export interface LinkDeps {
    fetch: typeof fetch;
    lookup: (host: string) => Promise<string>;
  }

  const defaultLinkDeps: LinkDeps = {
    fetch: (...args) => fetch(...args),
    lookup: async (host) => (await dnsLookup(host)).address,
  };

  /**
   * https only, public addresses only, every redirect hop re-checked, bounded time.
   * ponytail: checks the address, then lets fetch resolve again — a DNS-rebinding host could answer
   * differently the second time. Pin the socket to the checked address if this ever serves more
   * than a demo beta.
   */
  async function guardedFetch(url: string, deps: LinkDeps): Promise<{ res: Response; url: string } | null> {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let u: URL;
      try {
        u = new URL(current);
      } catch {
        return null;
      }
      if (u.protocol !== "https:") return null;
      try {
        const host = u.hostname.replace(/^\[|\]$/g, "");
        const address = isIP(host) ? host : await deps.lookup(host);
        if (!isPublicAddress(address)) return null;
        const res = await deps.fetch(u.toString(), {
          redirect: "manual",
          signal: AbortSignal.timeout(LINK_TIMEOUT_MS),
          headers: { "user-agent": "TripMate/1.0 (+place import)" },
        });
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get("location");
          if (!location) return null;
          current = new URL(location, u).toString();
          continue;
        }
        return res.ok ? { res, url: current } : null;
      } catch {
        return null;
      }
    }
    return null;
  }

  async function readCapped(res: Response): Promise<string> {
    const reader = res.body?.getReader();
    if (!reader) return "";
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < MAX_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
    await reader.cancel().catch(() => {});
    return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_BODY_BYTES));
  }

  const decodeEntities = (s: string) =>
    s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

  function metaContent(html: string, prop: string): string {
    const m =
      html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i")) ??
      html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, "i"));
    return m ? decodeEntities(m[1]) : "";
  }

  /** What a link says about itself: an oEmbed caption for TikTok/YouTube, title + og tags otherwise.
   *  `null` means the link could not be read — never "it said nothing". */
  export async function readLink(url: string, deps: LinkDeps = defaultLinkDeps): Promise<{ title: string; text: string } | null> {
    const kind = classifyItem({ kind: "url", url });
    if (kind === "tiktok" || kind === "youtube") {
      const endpoint =
        kind === "tiktok"
          ? `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`
          : `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`;
      const got = await guardedFetch(endpoint, deps);
      if (!got) return null;
      try {
        const json = JSON.parse(await readCapped(got.res)) as { title?: unknown };
        return typeof json.title === "string" ? { title: json.title, text: "" } : null;
      } catch {
        return null;
      }
    }
    const got = await guardedFetch(url, deps);
    if (!got) return null;
    const html = await readCapped(got.res);
    const title = metaContent(html, "og:title") || decodeEntities(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "");
    const text = metaContent(html, "og:description") || metaContent(html, "description");
    return title || text ? { title, text } : null;
  }

  /** Where a link ends up after redirects — for Maps short links, whose target URL carries the place. */
  export async function resolveFinalUrl(url: string, deps: LinkDeps = defaultLinkDeps): Promise<string | null> {
    const got = await guardedFetch(url, deps);
    if (!got) return null;
    await got.res.body?.cancel().catch(() => {});
    return got.url;
  }
  ```

  The YouTube oEmbed endpoint is on `www.youtube.com`, which `classifyItem` puts in the "youtube" class, so the
  endpoint URL itself is never re-classified.

- [ ] **Step 4: Run the tests and confirm they pass**

  Run: `cd /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec && node --import ./scripts/ts-resolve.mjs --test src/lib/importSources.test.mjs`
  Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

  ```bash
  git -C /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec add src/lib/importSources.ts src/lib/importSources.test.mjs
  git -C /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec commit -m "Read what a pasted link says without letting it reach inside the network"
  ```

---

### Task 9: The extraction prompt and parser

**Files:**
- Create: `src/lib/importExtract.ts`
- Test: `src/lib/importExtract.test.mjs`

**Interfaces:**
- Consumes: `SourceKind` (Task 7), `anchorKey` (Task 2), `parseJsonResponse` from `./claude`.
- Produces:
  - `interface ExtractSource { index: number; kind: SourceKind; text: string }`
  - `interface ExtractedPlace { name: string; cityHint: string | null; sourceIndex: number }`
  - `buildExtractPrompt(sources: ExtractSource[], imageIndices: number[], destination: string | null): string`
  - `parseExtraction(raw: string): { destinationGuess: string | null; places: ExtractedPlace[] } | null`

- [ ] **Step 1: Write the failing tests**

  Create `src/lib/importExtract.test.mjs`:

  ```js
  /* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/importExtract.test.mjs */
  import assert from "node:assert/strict";
  import test from "node:test";
  import { buildExtractPrompt, parseExtraction } from "./importExtract.ts";

  test("the prompt labels every item and says which images are which", () => {
    const p = buildExtractPrompt(
      [{ index: 1, kind: "tiktok", text: "Best ramen: Ichiran" }, { index: 2, kind: "text", text: "Nishiki!" }],
      [0, 3],
      "Kyoto"
    );
    assert.match(p, /Item 1 \(tiktok\): Best ramen: Ichiran/);
    assert.match(p, /Item 2 \(text\): Nishiki!/);
    assert.match(p, /attached images are, in order, items 0, 3/);
    assert.match(p, /Kyoto/);
    assert.match(p, /never guess/i);
  });

  test("parseExtraction keeps high-confidence places, dedupes by key, drops junk", () => {
    const raw = "```json\n" + JSON.stringify({
      destinationGuess: "Tokyo",
      places: [
        { name: "teamLab Planets", cityHint: "Tokyo", sourceIndex: 0, confidence: "high" },
        { name: "TeamLab planets", cityHint: "Tokyo", sourceIndex: 2, confidence: "high" },
        { name: "Some café maybe", cityHint: null, sourceIndex: 1, confidence: "low" },
        { name: "", sourceIndex: 1, confidence: "high" },
        { name: "No index", confidence: "high" },
      ],
    }) + "\n```";
    assert.deepEqual(parseExtraction(raw), {
      destinationGuess: "Tokyo",
      places: [{ name: "teamLab Planets", cityHint: "Tokyo", sourceIndex: 0 }],
    });
  });

  test("parseExtraction returns null on malformed output, never throws", () => {
    assert.equal(parseExtraction("I found some places!"), null);
    assert.equal(parseExtraction(JSON.stringify({ places: "nope" })), null);
  });
  ```

- [ ] **Step 2: Run and confirm the failure**

  Run: `cd /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec && node --import ./scripts/ts-resolve.mjs --test src/lib/importExtract.test.mjs`
  Expected: FAIL, module not found.

- [ ] **Step 3: Implement** (create `src/lib/importExtract.ts`)

  ```ts
  import { parseJsonResponse } from "./claude";
  import { anchorKey } from "./anchors";
  import type { SourceKind } from "./importSources";

  export interface ExtractSource {
    index: number;
    kind: SourceKind;
    text: string;
  }

  export interface ExtractedPlace {
    name: string;
    cityHint: string | null;
    sourceIndex: number;
  }

  /** One call over the whole pile. Honesty beats recall here: a wrong place on the map teaches the
   *  traveler the import can't be trusted, while a missed one they simply add by hand. */
  export function buildExtractPrompt(sources: ExtractSource[], imageIndices: number[], destination: string | null): string {
    const listed = sources.map((s) => `Item ${s.index} (${s.kind}): ${s.text.slice(0, 2000)}`).join("\n");
    const images = imageIndices.length
      ? `The attached images are, in order, items ${imageIndices.join(", ")}. They are usually screenshots of social posts, maps or messages.\n`
      : "";
    return `A traveler saved these while dreaming about a trip${destination ? ` to ${destination}` : ""}. List every specific, real place they could visit: venues, sights, neighbourhoods, markets, restaurants.

${images}${listed}

Rules:
- Only places actually named in the text, or clearly readable or unmistakably pictured in an image. Never guess a venue from mood, food or scenery alone.
- Use the place's own name as it would appear on a map, without "the best…" framing.
- "sourceIndex" is the item number the place came from.
- "confidence": "high" when the name is explicit, "low" otherwise.
- "destinationGuess": the city or region most of the places are in, as "City, Country", or null.

Respond with ONLY valid JSON, no code fences, in exactly this shape:
{"destinationGuess":"City, Country","places":[{"name":"place name","cityHint":"city or null","sourceIndex":0,"confidence":"high"}]}`;
  }

  export function parseExtraction(raw: string): { destinationGuess: string | null; places: ExtractedPlace[] } | null {
    let parsed: { destinationGuess?: unknown; places?: unknown };
    try {
      parsed = parseJsonResponse(raw);
    } catch {
      return null;
    }
    if (!parsed || !Array.isArray(parsed.places)) return null;
    const seen = new Set<string>();
    const places: ExtractedPlace[] = [];
    for (const p of parsed.places as Record<string, unknown>[]) {
      const name = typeof p?.name === "string" ? p.name.trim() : "";
      const key = anchorKey(name);
      if (!key || p.confidence !== "high" || typeof p.sourceIndex !== "number" || seen.has(key)) continue;
      seen.add(key);
      places.push({
        name,
        cityHint: typeof p.cityHint === "string" && p.cityHint.trim() ? p.cityHint.trim() : null,
        sourceIndex: p.sourceIndex,
      });
    }
    const guess = typeof parsed.destinationGuess === "string" && parsed.destinationGuess.trim() ? parsed.destinationGuess.trim() : null;
    return { destinationGuess: guess, places };
  }
  ```

- [ ] **Step 4: Run the tests and confirm they pass**

  Run: `cd /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec && node --import ./scripts/ts-resolve.mjs --test src/lib/importExtract.test.mjs`
  Expected: PASS. If loading `claude.ts` fails because of a value-imported type, apply CLAUDE.md's fix: move that
  type into an `import type` block.

- [ ] **Step 5: Commit**

  ```bash
  git -C /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec add src/lib/importExtract.ts src/lib/importExtract.test.mjs
  git -C /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec commit -m "Ask for only the places a pile actually names"
  ```

---

### Task 10: `POST /api/import`

**Files:**
- Create: `src/app/api/import/route.ts`
- Modify: `docs/backend.md` (Features row)

**Interfaces:**
- Consumes: `classifyItem`, `parseGoogleMapsUrl`, `readLink`, `resolveFinalUrl`, `ImportItem` (Tasks 7–8);
  `buildExtractPrompt`, `parseExtraction` (Task 9); `runClaude`, `ImageInput` (Task 6); `cheapModel`;
  `normalizeAnchors`, `geocodeAnchors` (Task 2); `geocodeDestinationCached`; `isThrottled`; `isOverDailyCap`.
- Produces: `POST /api/import` with body `{ items: ImportItem[], destination?: string }`. The response is
  `{ destinationGuess: string | null, places: Anchor[], unread: { index: number; reason: string }[] }`, or 400,
  413, 429 or 503.

- [ ] **Step 1: Implement the route**

  ```ts
  import { NextRequest, NextResponse } from "next/server";
  import { runClaude, type ImageInput } from "@/lib/claude";
  import { cheapModel } from "@/lib/llmConfig";
  import { classifyItem, parseGoogleMapsUrl, readLink, resolveFinalUrl, type ImportItem } from "@/lib/importSources";
  import { buildExtractPrompt, parseExtraction, type ExtractSource } from "@/lib/importExtract";
  import { geocodeAnchors, normalizeAnchors } from "@/lib/anchors";
  import { geocodeDestinationCached } from "@/lib/serverFetchCached";
  import { isThrottled } from "@/lib/ipThrottle";
  import { isOverDailyCap } from "@/lib/spendCap";
  import type { Anchor } from "@/lib/types";

  /**
   * Chaos in: a pile of screenshots, links and notes → the places in it, geocoded.
   *
   * Nothing here blocks the trip. Every item that can't be read is returned in `unread` with the
   * sentence the wizard shows, and the plan can be generated with whatever did resolve. Images are
   * never written anywhere — the trace keeps a size marker (see imageTraceMarker in claude.ts).
   */

  const MAX_IMAGES = 20;
  const MAX_OTHER = 20;
  const MAX_BODY_BYTES = 25 * 1024 * 1024;
  const EXTRACT_TIMEOUT_MS = 60_000;
  const MEDIA = new Set(["image/jpeg", "image/png", "image/webp"]);

  export async function POST(req: NextRequest) {
    if (isThrottled(req)) {
      return NextResponse.json({ error: "Too many requests — slow down and try again shortly." }, { status: 429 });
    }
    if (isOverDailyCap()) {
      return NextResponse.json({ error: "Demo budget for today has been used up — try again tomorrow." }, { status: 503 });
    }
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "That's a lot at once — try fewer screenshots." }, { status: 413 });
    }
    let body: { items?: unknown; destination?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    const destination = typeof body.destination === "string" && body.destination.trim() ? body.destination.trim() : null;
    const items = (Array.isArray(body.items) ? body.items : []).filter(
      (i): i is ImportItem =>
        (i?.kind === "image" && MEDIA.has(i.mediaType) && typeof i.data === "string" && i.data.length > 0) ||
        (i?.kind === "url" && typeof i.url === "string") ||
        (i?.kind === "text" && typeof i.text === "string" && i.text.trim().length > 0)
    );
    if (items.filter((i) => i.kind === "image").length > MAX_IMAGES || items.filter((i) => i.kind !== "image").length > MAX_OTHER) {
      return NextResponse.json({ error: `Up to ${MAX_IMAGES} screenshots and ${MAX_OTHER} links or notes at a time.` }, { status: 413 });
    }

    const unread: { index: number; reason: string }[] = [];
    const direct: Anchor[] = [];
    const sources: ExtractSource[] = [];
    const images: ImageInput[] = [];
    const imageIndices: number[] = [];

    await Promise.all(
      items.map(async (item, index) => {
        const kind = classifyItem(item);
        if (item.kind === "image") {
          images.push({ mediaType: item.mediaType, data: item.data });
          imageIndices.push(index);
          return;
        }
        if (item.kind === "text" || kind === "text") {
          sources.push({ index, kind: "text", text: item.kind === "text" ? item.text : item.url });
          return;
        }
        if (kind === "instagram") {
          unread.push({ index, reason: "Instagram links need a screenshot" });
          return;
        }
        if (kind === "gmaps") {
          const place = parseGoogleMapsUrl(item.url) ?? parseGoogleMapsUrl((await resolveFinalUrl(item.url)) ?? "");
          if (place) direct.push({ name: place.name, lat: place.lat, lng: place.lng, priority: "want", source: "import" });
          else unread.push({ index, reason: "Couldn't open this link" });
          return;
        }
        const link = await readLink(item.url);
        if (link) sources.push({ index, kind, text: [link.title, link.text].filter(Boolean).join("\n") });
        else unread.push({ index, reason: "Couldn't open this link" });
      })
    );
    // Images are pushed before any await, so they are already in item order; links finish in any
    // order and are sorted so the prompt reads top to bottom.
    sources.sort((a, b) => a.index - b.index);

    let destinationGuess: string | null = null;
    const extracted: Anchor[] = [];
    if (sources.length > 0 || images.length > 0) {
      try {
        const { result } = await runClaude(
          buildExtractPrompt(sources, imageIndices, destination),
          "extract",
          EXTRACT_TIMEOUT_MS,
          { model: cheapModel(), images }
        );
        const parsed = parseExtraction(result);
        destinationGuess = parsed?.destinationGuess ?? null;
        for (const p of parsed?.places ?? []) {
          extracted.push({ name: p.name, lat: null, lng: null, priority: "want", source: "import" });
        }
        const found = new Set((parsed?.places ?? []).map((p) => p.sourceIndex));
        for (const idx of imageIndices) {
          if (!found.has(idx)) unread.push({ index: idx, reason: "Couldn't read this screenshot" });
        }
      } catch (err) {
        console.error("[import] extract failed", err);
        for (const idx of imageIndices) unread.push({ index: idx, reason: "Couldn't read this screenshot" });
        for (const s of sources) unread.push({ index: s.index, reason: "Couldn't read this" });
      }
    }

    let places = normalizeAnchors({ anchors: [...direct, ...extracted] });
    const city = destination ?? destinationGuess;
    if (city && places.some((p) => p.lat === null)) {
      const geo = await geocodeDestinationCached(city).catch(() => null);
      if (geo) places = await geocodeAnchors(places, { lat: geo.lat, lon: geo.lon });
    }
    unread.sort((a, b) => a.index - b.index);
    return NextResponse.json({ destinationGuess, places, unread });
  }
  ```

- [ ] **Step 2: Check it against a running dev server**

  Start the dev server (`preview_start`). Then run:

  ```bash
  cd /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec && IMG=$(base64 -i "$IMG_PATH" | tr -d '\n') && \
  printf '{"destination":"","items":[{"kind":"image","mediaType":"image/jpeg","data":"%s"},{"kind":"url","url":"https://www.instagram.com/reel/abc/"},{"kind":"url","url":"https://www.google.com/maps/place/Kinkaku-ji/@35.0394,135.7292,17z"},{"kind":"url","url":"https://127.0.0.1/admin"},{"kind":"text","text":"Maya says: Nishiki Market for lunch, then Fushimi Inari at sunset"}]}' "$IMG" > /private/tmp/import.json && \
  curl -s -X POST http://localhost:3000/api/import -H 'content-type: application/json' --data @/private/tmp/import.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(JSON.parse(s),null,1)))'
  ```

  `$IMG_PATH` is the Task 1 image. Expected:
  - `places` includes Kinkaku-ji (with coordinates), Nishiki Market, Fushimi Inari and the place in the image.
  - `unread` has index 1 "Instagram links need a screenshot" and index 3 "Couldn't open this link".
  - `destinationGuess` is set.

  Then check the trace for image redaction:

  ```bash
  cd /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec && node -e 'const D=require("libsql");const db=new D("tripmate.db");const r=db.prepare("select prompt from llm_traces where type=? order by rowid desc limit 1").get("extract");console.log(r.prompt.slice(-80), r.prompt.length)'
  ```

  Expected: the prompt ends in `[image 1 · …KB]`, and its length is a few KB, not hundreds.

- [ ] **Step 3: Add the tracker row**

  Add a row to the Features table in `docs/backend.md`, matching the columns of the rows around it:
  `/api/import`: screenshots, links and notes → geocoded places (one cheap `extract` call, SSRF-guarded link reading,
  images never stored). Since 2026-09-25, Developer Claude.

- [ ] **Step 4: Suite, typecheck, lint and commit**

  ```bash
  cd /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec && npm test && npx tsc --noEmit -p tsconfig.json && npm run lint
  git -C /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec add src/app/api/import/route.ts docs/backend.md
  git -C /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec commit -m "Turn a pile of screenshots and links into places"
  ```

---

### Task 11: The drop zone, the tray and the pins

**Files:**
- Create: `src/components/ImportDropZone.tsx`
- Modify: `src/app/HomeView.tsx` (anchors state, draft persistence, `currentAnswers`, the basics step, map pins,
  destination inference)
- Modify: `docs/frontend.md` (Features row)

**Interfaces:**
- Consumes: `POST /api/import` (Task 10), `Anchor` (Task 2), `showTripRoute` and `setRouteConnectorsHidden` from
  `useMapCamera()`.
- Produces: `<ImportDropZone destination anchors onAnchorsChange onDestinationGuess />`, and `anchors` sent in
  `userAnswers`.

- [ ] **Step 1: Build the component**

  Create `src/components/ImportDropZone.tsx`:

  ```tsx
  "use client";

  import { useState } from "react";
  import type { Anchor } from "@/lib/types";

  /** Long edge the model reads at full fidelity; anything larger only costs upload time. */
  const LONG_EDGE_PX = 1568;

  type Pending =
    | { kind: "image"; mediaType: "image/jpeg"; data: string; preview: string }
    | { kind: "url"; url: string }
    | { kind: "text"; text: string };

  async function downscale(file: File): Promise<Pending> {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, LONG_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const preview = canvas.toDataURL("image/jpeg", 0.85);
    return { kind: "image", mediaType: "image/jpeg", data: preview.split(",")[1], preview };
  }

  /** One pasted blob of text → a link per URL line, and the rest as one note. */
  function splitText(text: string): Pending[] {
    const lines = text.split(/\s*\n\s*/).map((l) => l.trim()).filter(Boolean);
    const urls = lines.filter((l) => /^https?:\/\/\S+$/.test(l));
    const rest = lines.filter((l) => !urls.includes(l)).join("\n");
    return [...urls.map((url) => ({ kind: "url" as const, url })), ...(rest ? [{ kind: "text" as const, text: rest }] : [])];
  }

  export default function ImportDropZone({
    destination,
    anchors,
    onAnchorsChange,
    onDestinationGuess,
  }: {
    destination: string;
    anchors: Anchor[];
    onAnchorsChange: (anchors: Anchor[]) => void;
    onDestinationGuess: (guess: string) => void;
  }) {
    const [pending, setPending] = useState<Pending[]>([]);
    const [unread, setUnread] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [dragging, setDragging] = useState(false);

    async function take(files: File[], text: string) {
      const images = await Promise.all(files.filter((f) => f.type.startsWith("image/")).map(downscale));
      setPending((prev) => [...prev, ...images, ...(text.trim() ? splitText(text) : [])]);
    }

    async function findPlaces() {
      if (pending.length === 0) return;
      setBusy(true);
      setUnread([]);
      try {
        const res = await fetch("/api/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            destination,
            items: pending.map((p) => (p.kind === "image" ? { kind: "image", mediaType: p.mediaType, data: p.data } : p)),
          }),
        });
        const json = (await res.json()) as {
          error?: string;
          destinationGuess?: string | null;
          places?: Anchor[];
          unread?: { index: number; reason: string }[];
        };
        if (!res.ok) {
          setUnread([json.error ?? "Couldn't read these right now."]);
          return;
        }
        const known = new Set(anchors.map((a) => a.name.toLowerCase()));
        onAnchorsChange([...anchors, ...(json.places ?? []).filter((p) => !known.has(p.name.toLowerCase()))]);
        if (json.destinationGuess && !destination.trim()) onDestinationGuess(json.destinationGuess);
        setUnread((json.unread ?? []).map((u) => u.reason));
        setPending([]);
      } catch {
        setUnread(["Couldn't read these right now."]);
      } finally {
        setBusy(false);
      }
    }

    const toggleMust = (name: string) =>
      onAnchorsChange(anchors.map((a) => (a.name === name ? { ...a, priority: a.priority === "must" ? "want" : "must" } : a)));
    const remove = (name: string) => onAnchorsChange(anchors.filter((a) => a.name !== name));

    return (
      <div className="mt-4">
        <label
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void take(Array.from(e.dataTransfer.files), e.dataTransfer.getData("text/plain"));
          }}
          onPaste={(e) => void take(Array.from(e.clipboardData.files), e.clipboardData.getData("text/plain"))}
          tabIndex={0}
          className={`block cursor-pointer rounded-xl border border-dashed px-4 py-3 text-sm text-muted ${dragging ? "border-[var(--jade)]" : "border-white/20"}`}
        >
          Drop what you&apos;ve saved: screenshots, links, notes.
          <input
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={(e) => void take(Array.from(e.target.files ?? []), "")}
          />
        </label>

        {pending.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {pending.map((p, i) =>
              p.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element -- a local data URL, not an optimisable asset
                <img key={i} src={p.preview} alt="" className="h-12 w-12 rounded-md object-cover" />
              ) : (
                <span key={i} className="max-w-48 truncate rounded-md bg-white/10 px-2 py-1 text-xs">
                  {p.kind === "url" ? p.url : p.text}
                </span>
              )
            )}
            <button type="button" disabled={busy} onClick={() => void findPlaces()} className="rounded-full bg-[var(--jade)] px-3 py-1 text-sm text-black disabled:opacity-60">
              {busy ? "Reading…" : "Find the places"}
            </button>
          </div>
        )}

        {unread.length > 0 && (
          <ul className="mt-2 text-xs text-muted" aria-live="polite">
            {unread.map((u, i) => <li key={i}>{u}</li>)}
          </ul>
        )}

        {anchors.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Your places">
            {anchors.map((a) => (
              <li key={a.name} className="flex items-center gap-1 rounded-full bg-white/10 py-1 pl-2 pr-1 text-sm">
                <button type="button" aria-pressed={a.priority === "must"} aria-label={`Must-see: ${a.name}`} onClick={() => toggleMust(a.name)}>
                  {a.priority === "must" ? "★" : "☆"}
                </button>
                <span>{a.name}</span>
                {a.lat === null && <span className="text-xs text-muted">· couldn&apos;t place it, type it or skip</span>}
                <button type="button" aria-label={`Remove ${a.name}`} onClick={() => remove(a.name)} className="px-1 text-muted">×</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  ```

  Check the CSS variables exactly as in Task 4 Step 5, and match the chip styling to `PoiCandidatePicker.tsx`
  instead of the placeholder classes above wherever that file already has a chip class.

- [ ] **Step 2: Wire it into `HomeView`**

  In `src/app/HomeView.tsx`:
  1. Add `import ImportDropZone from "@/components/ImportDropZone";` and add `Anchor` to the `@/lib/types` import.
  2. Next to `const [customPois, setCustomPois] = useState<string[]>([]);`, add
     `const [anchors, setAnchors] = useState<Anchor[]>([]);`.
  3. Draft persistence:
     - next to `setCustomPois(restore("customPois", [] as string[]));`, add
       `setAnchors(restore("anchors", [] as Anchor[]));`;
     - add `anchors` to both lists that already name `customPois` (the saved object and its dependency array,
       around lines 720/731).
  4. In `currentAnswers()`, add `anchors,` after `customPois,`.
  5. Change `const { resetToHome } = useMapCamera();` to
     `const { resetToHome, showTripRoute, setRouteConnectorsHidden } = useMapCamera();`.
  6. Add an effect that shows the imported places as pins while there is no plan on screen. Place it **after** the
     line that declares `shownItinerary` (around line 814), because the effect reads it.

     ```tsx
     // The pile, on the map, before any plan exists: pins only, no route between them — they are
     // not an order yet. Hands the map back the moment a plan (draft or final) takes over.
     useEffect(() => {
       if (shownItinerary) return;
       const pins = anchors.flatMap((a) => (a.lat !== null && a.lng !== null ? [{ lat: a.lat, lng: a.lng, name: a.name, day: 0 }] : []));
       if (pins.length === 0) return;
       setRouteConnectorsHidden(true);
       showTripRoute([pins], null, true, false);
       return () => setRouteConnectorsHidden(false);
     }, [anchors, shownItinerary, showTripRoute, setRouteConnectorsHidden]);
     ```

  7. In the basics `<Screen name="Basics" …>`, directly after the destination/dates/budget console, render:

     ```tsx
     <ImportDropZone
       destination={destination}
       anchors={anchors}
       onAnchorsChange={setAnchors}
       onDestinationGuess={setDestination}
     />
     ```

- [ ] **Step 3: Verify in the browser**

  1. Start or reload the dev server, open `/`, and go to the wizard's basics step.
  2. Use `javascript_tool` to dispatch a paste of text into the drop zone: a DataTransfer carrying
     `"https://www.google.com/maps/place/Kinkaku-ji/@35.0394,135.7292,17z\nNishiki Market and Fushimi Inari"`.
     A pasted image can't be synthesised reliably, so also run the file-input path with a `File` built from a
     fetched `/` image.
  3. Click "Find the places".
  4. Confirm:
     - `read_page` shows three chips;
     - the destination field was filled when it was blank;
     - starring toggles `aria-pressed`;
     - `read_console_messages` shows no errors;
     - pins are visible (take a screenshot).
  5. Go to review and generate. Confirm the request body's `userAnswers.anchors` with `read_network_requests`, and
     that the Task 4 receipt appears.

- [ ] **Step 4: Tracker row, suite, typecheck, lint, commit**

  Add a row to the Features table in `docs/frontend.md`: "Drop what you've saved": the drop/paste zone on the basics
  step, pins for imported places, star = must, destination inferred. Since 2026-09-25, Developer Claude.

  ```bash
  cd /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec && npm test && npx tsc --noEmit -p tsconfig.json && npm run lint
  git -C /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec add src/components/ImportDropZone.tsx src/app/HomeView.tsx docs/frontend.md
  git -C /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec commit -m "Let the planner drop their saved places straight onto the map"
  ```

---

### Task 12: The sketch

**Files:**
- Create: `src/lib/sketch.ts`
- Test: `src/lib/sketch.test.mjs`
- Modify:
  - `src/lib/types.ts` (`DayPlan.theme?`)
  - `src/lib/itineraryPrompt.ts` (`DAY_SHAPE` gains `theme`; `buildGeneratePrompt` gains `sketch`)
  - `src/lib/itinerary.ts` (`carryOverDaySummaries` also carries `theme`)
  - `src/lib/generationRunner.ts` (run the sketch, `LiveSink.onSketch`)
  - `src/app/api/itinerary/route.ts` (the `sketch` event)
  - `src/app/HomeView.tsx` (`runStreamed` branch)
  - `src/components/ItineraryCard.tsx` (render the theme)
  - `docs/frontend.md` (Features row)

**Interfaces:**
- Consumes: `Anchor` (Task 2), the `"sketch"` call type (Task 5), `formatAnchors` (Task 3).
- Produces:
  - `interface SketchDay { date: string; theme: string; area: string; anchors: string[] }`
  - `buildSketchPrompt(p: { destination: string; dates: string[]; anchors: Anchor[]; priorities: string[]; weather: DayWeather[] }): string`
  - `parseSketch(raw: string, dates: string[]): SketchDay[] | null`
  - `formatSketchForGenerate(days: SketchDay[] | null): string`
  - `LiveSink.onSketch?(days: SketchDay[]): void`
  - SSE event `sketch` with data `{ days: SketchDay[] }`

- [ ] **Step 1: Write the failing tests**

  Create `src/lib/sketch.test.mjs`:

  ```js
  /* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/sketch.test.mjs */
  import assert from "node:assert/strict";
  import test from "node:test";
  import { buildSketchPrompt, formatSketchForGenerate, parseSketch } from "./sketch.ts";
  import { carryOverDaySummaries } from "./itinerary.ts";

  const DATES = ["2026-10-06", "2026-10-07"];

  test("the sketch prompt names the days, the musts and the ask", () => {
    const p = buildSketchPrompt({
      destination: "Tokyo", dates: DATES, priorities: ["Food"], weather: [],
      anchors: [{ name: "teamLab Planets", lat: 35.6, lng: 139.8, priority: "must" }],
    });
    assert.match(p, /2026-10-06/);
    assert.match(p, /MUST: teamLab Planets/);
    assert.match(p, /"theme"/);
  });

  test("parseSketch keeps one entry per requested date, in order", () => {
    const raw = JSON.stringify({ days: [
      { date: "2026-10-07", theme: "Bay and art", area: "Odaiba", anchors: ["teamLab Planets"] },
      { date: "2026-10-06", theme: "Old Tokyo, slowly", area: "Asakusa", anchors: [] },
      { date: "2026-12-01", theme: "Off-trip", area: "x", anchors: [] },
    ] });
    assert.deepEqual(parseSketch(raw, DATES).map((d) => d.theme), ["Old Tokyo, slowly", "Bay and art"]);
  });

  test("parseSketch returns null when it can't be used", () => {
    assert.equal(parseSketch("nope", DATES), null);
    assert.equal(parseSketch(JSON.stringify({ days: [] }), DATES), null);
  });

  test("formatSketchForGenerate is empty with no sketch and names each day otherwise", () => {
    assert.equal(formatSketchForGenerate(null), "");
    const out = formatSketchForGenerate([{ date: "2026-10-06", theme: "Old Tokyo, slowly", area: "Asakusa", anchors: ["Senso-ji"] }]);
    assert.match(out, /2026-10-06: "Old Tokyo, slowly" — Asakusa — Senso-ji/);
    assert.match(out, /keep this shape/i);
  });

  test("critique's revised days inherit the theme", () => {
    const revised = [{ date: "2026-10-06", weather: "", stops: [] }];
    carryOverDaySummaries(revised, [{ date: "2026-10-06", weather: "", stops: [], theme: "Old Tokyo, slowly" }]);
    assert.equal(revised[0].theme, "Old Tokyo, slowly");
  });
  ```

- [ ] **Step 2: Run and confirm the failure**

  Run: `cd /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec && node --import ./scripts/ts-resolve.mjs --test src/lib/sketch.test.mjs`
  Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/lib/sketch.ts`**

  ```ts
  import { parseJsonResponse } from "./claude";
  import { formatAnchors } from "./itineraryPrompt";
  import type { Anchor } from "./types";
  import type { DayWeather } from "./weather";

  /**
   * The ~20s sketch: a theme and an area per day, and which of the traveler's places go where.
   *
   * Not a throwaway preview — it is handed to the generate prompt as the shape to keep, so what the
   * traveler sees at second twenty is what they get at minute six. A sketch the plan contradicted
   * would cost the trust this exists to build.
   */

  export interface SketchDay {
    date: string;
    theme: string;
    area: string;
    anchors: string[];
  }

  export function buildSketchPrompt(p: {
    destination: string;
    dates: string[];
    anchors: Anchor[];
    priorities: string[];
    weather: DayWeather[];
  }): string {
    const weather = p.weather.map((w) => `${w.date}: ${JSON.stringify(w)}`).join("\n");
    return `Sketch a ${p.dates.length}-day trip to ${p.destination} — only the shape, not the stops.
  Days: ${p.dates.join(", ")}
  ${p.priorities.length ? `What matters to them: ${p.priorities.join(", ")}\n` : ""}${weather ? `Weather:\n${weather}\n` : ""}${formatAnchors(p.anchors)}
  For each day give: a "theme" of 2-5 evocative words (e.g. "Old Tokyo, slowly"), the one "area" the day centres on, and the traveler's places ("anchors", exact names from the list) that belong on that day. Group places that are near each other; put outdoor places on the better-weather days.

  Respond with ONLY valid JSON, no code fences:
  {"days":[{"date":"YYYY-MM-DD","theme":"2-5 words","area":"neighbourhood or town","anchors":["exact name"]}]}`;
  }

  export function parseSketch(raw: string, dates: string[]): SketchDay[] | null {
    let parsed: { days?: unknown };
    try {
      parsed = parseJsonResponse(raw);
    } catch {
      return null;
    }
    if (!Array.isArray(parsed?.days)) return null;
    const byDate = new Map<string, SketchDay>();
    for (const d of parsed.days as Record<string, unknown>[]) {
      if (typeof d?.date !== "string" || typeof d.theme !== "string" || !d.theme.trim()) continue;
      byDate.set(d.date, {
        date: d.date,
        theme: d.theme.trim(),
        area: typeof d.area === "string" ? d.area.trim() : "",
        anchors: Array.isArray(d.anchors) ? d.anchors.filter((a): a is string => typeof a === "string") : [],
      });
    }
    const days = dates.flatMap((date) => byDate.get(date) ?? []);
    return days.length > 0 ? days : null;
  }

  export function formatSketchForGenerate(days: SketchDay[] | null): string {
    if (!days?.length) return "";
    const lines = days.map((d) => `- ${d.date}: "${d.theme}" — ${d.area}${d.anchors.length ? ` — ${d.anchors.join(", ")}` : ""}`);
    return `\nThe traveler has already seen this sketch of the days. Keep this shape — each day's theme (copy it into that day's "theme" field), area and places — unless it conflicts with opening hours, weather or the rules above:\n${lines.join("\n")}\n`;
  }
  ```

  Check the `DayWeather` field names in `src/lib/weather.ts`. If `JSON.stringify(w)` is noisy, use the fields
  `formatWeather` in `itineraryPrompt.ts` already prints. Better still, export `formatWeather` and reuse it.

- [ ] **Step 4: Add `theme` to the type, the shape and the critique carry-over**

  - In `src/lib/types.ts`, on `DayPlan`, add below `summary?`:

    ```ts
      /** Model-written 2-5 word identity for the day ("Old Tokyo, slowly"), from the sketch. Distinct
       *  from `title`, which only the traveler writes. */
      theme?: string;
    ```

  - In `src/lib/itineraryPrompt.ts`:
    - In `DAY_SHAPE`, insert `"theme":"2-5 word identity for the day",` after `"weather":…,`.
    - Add `sketch?: string;` to `buildGeneratePrompt`'s params, and put `${params.sketch ?? ""}` right after
      `${formatAnchors(params.anchors)}`.
    - Add `"theme"` to `DAY_FIELDS` in `itineraryPrompt.test.mjs`, so the shape-drift test covers it.
  - In `src/lib/itinerary.ts`, change `carryOverDaySummaries` to carry both fields:

    ```ts
    export function carryOverDaySummaries(revised: DayPlan[], previous: DayPlan[]): void {
      const byDate = new Map<string, DayPlan>();
      for (const day of previous) if (day?.date) byDate.set(day.date, day);
      if (byDate.size === 0) return;
      for (const day of revised) {
        const prev = day && byDate.get(day.date);
        if (!prev) continue;
        // A blank field is not worth carrying and would only overwrite `undefined` with noise.
        if (!day.summary?.trim() && prev.summary?.trim()) day.summary = prev.summary;
        if (!day.theme?.trim() && prev.theme?.trim()) day.theme = prev.theme;
      }
    }
    ```

- [ ] **Step 5: Run the tests and confirm they pass**

  Run: `cd /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec && node --import ./scripts/ts-resolve.mjs --test src/lib/sketch.test.mjs src/lib/itineraryPrompt.test.mjs src/lib/itinerary.test.mjs`
  Expected: PASS.

- [ ] **Step 6: Run the sketch inside `runGeneration`**

  In `src/lib/generationRunner.ts`:
  1. Add the imports `import { buildSketchPrompt, formatSketchForGenerate, parseSketch, type SketchDay } from "./sketch";`
     and `import { cheapModel } from "./llmConfig";` (skip the second if it's already imported), plus the date-list
     helper the file already uses for `tripDays`. If none exists, derive the dates with
     `Array.from({ length: dayCount }, (_, i) => new Date(Date.parse(startDate) + i * 86_400_000).toISOString().slice(0, 10))`.
     That is UTC on purpose (see CLAUDE.md's gotcha about date-only strings).
  2. Add `onSketch?(days: SketchDay[]): void;` to `LiveSink`, with a doc comment: "The day sketch, ~20s in. Optional
     so the JSON caller and older sinks need nothing."
  3. In the generate branch, **right after** the new `geocodeAnchors` line from Task 3 and **before**
     `contextInsight = await contextInsightPromise;`, start the sketch so it overlaps the context call:

     ```ts
     const SKETCH_TIMEOUT_MS = 30_000;
     const dates = /* the dates list from step 1 */;
     // Overlaps the context call already in flight, so it costs the traveller almost no wall clock.
     // Never on the failure path: a sketch that errors or times out simply isn't shown.
     const sketchPromise: Promise<SketchDay[] | null> = runClaude(
       buildSketchPrompt({
         destination,
         dates,
         anchors,
         priorities: (userAnswers as UserAnswers | undefined)?.topPriorities ?? [],
         weather,
       }),
       "sketch",
       SKETCH_TIMEOUT_MS,
       { runId, model: cheapModel() }
     )
       .then(({ result }) => parseSketch(result, dates))
       .catch((err) => {
         console.error("[itinerary] sketch failed", err);
         return null;
       });
     ```

  4. Right after `onStage({ stage: "context", status: "done" });` in the generate branch, add:

     ```ts
     const sketch = await sketchPromise;
     if (sketch) live?.onSketch?.(sketch);
     ```

  5. Add `sketch: formatSketchForGenerate(sketch),` to the generate branch's `contextPayload` object.
  6. After `normalizeDays(days)` builds the itinerary, back-fill any theme the model dropped:

     ```ts
     if (sketch) {
       const themeByDate = new Map(sketch.map((d) => [d.date, d.theme]));
       for (const day of itinerary.days) if (!day.theme?.trim()) day.theme = themeByDate.get(day.date);
     }
     ```

     Declare `let sketch: SketchDay[] | null = null;` next to `let geoPoint` so it is in scope here, and assign it
     in step 4 rather than declaring it there.

- [ ] **Step 7: Stream it and show it**

  - In `src/app/api/itinerary/route.ts`, add to the `live` object:
    `onSketch: (days: SketchDay[]) => safeEnqueue("sketch", { days }),`
    with `import type { SketchDay } from "@/lib/sketch";`.
  - In `src/app/HomeView.tsx`'s `runStreamed`, add a branch before `else if (event === "plan")`:

    ```tsx
    } else if (event === "sketch") {
      // The day sketch: themes and places per day, seconds in. Seeds empty days so the headers
      // have something to say while the stops are still being written; stops fill them in place.
      const { days } = JSON.parse(data) as { days: SketchDay[] };
      setDraftItinerary((prev) => {
        const next = [...(prev?.days ?? [])];
        days.forEach((d, i) => {
          while (next.length <= i) next.push({ date: "", weather: "", stops: [] });
          next[i] = {
            ...next[i],
            date: next[i].date || d.date,
            theme: d.theme,
            summary: next[i].summary || [d.area, ...d.anchors].filter(Boolean).join(" · "),
          };
        });
        return { tier: (prev?.tier ?? tier) as Itinerary["tier"], days: next };
      });
    ```

    Add `import type { SketchDay } from "@/lib/sketch";`. The provisional `summary` is replaced by the real one
    when the plan arrives, because the `plan` event replaces the draft wholesale.
  - In `src/components/ItineraryCard.tsx`, directly above `{day.summary && <p …>}`, add:

    ```tsx
    {day.theme && <p className="mb-1 font-serif text-lg leading-snug">{day.theme}</p>}
    ```

    Match the serif class to the one the card's destination heading already uses.

- [ ] **Step 8: Verify against the dev server**

  1. Generate a 3-day trip from the wizard with two imported places, one of them starred.
  2. While it runs, call `read_network_requests` on `/api/itinerary?stream=1`, or `curl -sN` the same body from
     Task 3 with `?stream=1`. Confirm a `sketch` event arrives before the first `stop` event, and note the seconds
     from request start. Expected: well under the generate time, ideally about 20s.
  3. Confirm with `read_page` that each day header shows its theme during the reveal and keeps it after `plan`.
  4. Confirm the final plan's day themes match the sketch's.
  5. Check that iOS stays safe:
     `grep -n "case .unknown\|unknown" ios/TripMateKit/Sources/TripMateKit/*SSE*.swift` should show unknown events
     are ignored.

- [ ] **Step 9: Tracker row, suite, typecheck, lint, commit**

  Add a row to `docs/frontend.md`: day sketch (cheap `sketch` call running alongside context, SSE `sketch` event, day
  themes kept through generate and critique). Since 2026-09-25, Developer Claude.

  ```bash
  cd /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec && npm test && npx tsc --noEmit -p tsconfig.json && npm run lint
  git -C /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec add src/lib/sketch.ts src/lib/sketch.test.mjs src/lib/types.ts src/lib/itineraryPrompt.ts src/lib/itineraryPrompt.test.mjs src/lib/itinerary.ts src/lib/generationRunner.ts src/app/api/itinerary/route.ts src/app/HomeView.tsx src/components/ItineraryCard.tsx docs/frontend.md
  git -C /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec commit -m "Sketch the days in seconds and hold the plan to that sketch"
  ```

---

### Task 13: Whole-branch verification

- [ ] **Step 1: Run the full gate**

  Run: `cd /Users/zaidshaikh/GitHub/tripmate-chaos-in-spec && npm test && npx tsc --noEmit -p tsconfig.json && npm run lint && npm run build`
  Expected: all green. `npm run build` includes `verify-build.mjs`, which parses every chunk.

- [ ] **Step 2: Run the end-to-end pass in the browser**

  From `/`:
  1. Paste a Maps link and a note, and add one screenshot through the file input.
  2. Star one place and pick a city.
  3. Generate.

  Confirm:
  - the pins appeared;
  - the sketch themes appeared before the stops;
  - the receipt counts the stars correctly;
  - "Fit it anyway" starts a refine;
  - after the refine, the receipt is still there (Review focus #5).

  Take a screenshot of the final plan with its receipt.

- [ ] **Step 3: Check the transport**

  Flip to the API transport with `POST /api/llm-mode {"mode":"api"}`, but only if `ANTHROPIC_API_KEY` is set, and
  repeat the Task 10 curl. Expected: the same response shape. Flip back with `{"mode":"cli"}`.

- [ ] **Step 4: Report**

  Summarise:
  - what shipped;
  - the spike result;
  - the measured sketch latency;
  - any deviation from this plan, with the reason.
