# Onboarding and Wizard Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the plan wizard from seven screens to four by moving the durable answers into a profile the traveler owns, and add dietary needs — the one durable trait the wizard could never sensibly ask.

**Architecture:** The wizard keeps only the four genuinely per-trip screens (basics, purpose, group, pois). Explorer style, energy, crowds, tier and priorities move behind a single expander on the basics screen, fronted by a one-line summary of the values in effect, and are owned by a new `/profile` page. Dietary needs are added to the stored profile and fed into the prompt beside the existing food-stop instruction. The automatic post-generate profile write-back is removed so a per-trip override can never become a permanent default.

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript, `better-sqlite3`, `node:test` (no framework).

**Spec:** [`docs/superpowers/specs/2026-08-16-onboarding-and-wizard-split-design.md`](../specs/2026-08-16-onboarding-and-wizard-split-design.md)

## Global Constraints

- **Node ≥ 22 is mandatory.** `better-sqlite3`'s native binding kills the dev server on Node 20 the moment a DB route is hit.
- **Add no new dependencies.**
- **Build order is a correctness constraint, not a preference.** `/profile` and the `dietary` field must ship *before* the wizard drops its durable screens. Removing those screens removes the only editor those values have; doing it first creates a state where a traveler holds a value they cannot change. Tasks are ordered accordingly and each leaves the app working.
- **One expander, not five.** It reveals explorer style, energy, crowds, tier and priorities together in one scrollable block. **No pagination inside it** — no steps, no Next, no sub-navigation. It is the only expander in the wizard, and any future durable field goes inside this same block. This is what guarantees the worst case (4 advance clicks) stays below today's 6; a nested mini-wizard or one-expander-per-field would push it back above and reinvent the problem this design exists to remove.
- **The collapsed state is a summary of values in effect, not a bare link.** A hidden control reads as the app having forgotten the traveler's preferences.
- **The wizard never writes to the profile.** Only `/profile` and the onboarding card write. This is what makes the per-trip expander safe.
- **A `.test.mjs` can only import a `.ts` module whose own imports are all `import type`** (or which has no imports). Node erases those and resolves nothing at runtime; a value import fails with `ERR_MODULE_NOT_FOUND`. `dietaryPrompt.ts` and `profileSummary.ts` are written to satisfy this.
- **DB rows are `snake_case`, API and type surfaces are `camelCase`.**
- **Fail-soft is the house convention.** External and optional data degrades; it does not throw.
- **Commit messages carry no Claude/AI attribution trailers.** Repository owner's explicit instruction.
- **`AGENTS.md` is rewritten by `next dev`.** If it shows as modified, commit it with the work.
- **Verification is never typecheck alone.** `npm test`, `npx tsc --noEmit -p tsconfig.json`, `npm run lint`, and a real `curl` or browser check. Baseline before this plan: 36 tests, 2 pre-existing lint errors (`src/app/layout.tsx:71`, `src/components/Navbar.tsx:63`) which predate this work and must not grow.

---

### Task 1: Add `dietary` to the profile model

**Files:**
- Modify: `src/lib/travelerProfile.ts`
- Test: `src/lib/travelerProfile.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `DietaryNeeds` interface (`{ tags: string[]; note: string }`) and `dietary: DietaryNeeds` on `TravelerProfile`. Tasks 2, 3, 5 and 7 use these.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/travelerProfile.test.mjs`, inside the existing file (keep the existing `valid` fixture and tests untouched — add `dietary` to the fixture and add the four new tests):

First, update the existing fixture at the top of the file to include the new field:

```js
const valid = {
  group: "family_with_kids",
  explorerStyle: "relaxed",
  energy: "low",
  crowds: "avoid",
  tier: "budget",
  priorities: ["Food", "Shopping"],
  topPriorities: ["Food"],
  dietary: { tags: ["Vegetarian"], note: "no shellfish" },
};
```

Then append:

```js
test("a profile saved before dietary existed still parses, defaulting to empty", () => {
  const { dietary, ...withoutDietary } = valid;
  void dietary;
  const parsed = parseProfile(withoutDietary);
  assert.ok(parsed, "a pre-dietary profile must still parse, not be rejected");
  assert.deepEqual(parsed.dietary, { tags: [], note: "" });
});

test("dietary round-trips both tags and note", () => {
  const parsed = parseProfile(valid);
  assert.deepEqual(parsed.dietary, { tags: ["Vegetarian"], note: "no shellfish" });
});

test("a dietary with a missing note defaults the note, not the whole profile", () => {
  const parsed = parseProfile({ ...valid, dietary: { tags: ["Vegan"] } });
  assert.deepEqual(parsed.dietary, { tags: ["Vegan"], note: "" });
});

test("rejects a malformed dietary rather than silently dropping it", () => {
  assert.equal(parseProfile({ ...valid, dietary: { tags: "Vegetarian", note: "" } }), null);
  assert.equal(parseProfile({ ...valid, dietary: { tags: [1, 2], note: "" } }), null);
  assert.equal(parseProfile({ ...valid, dietary: [] }), null);
  assert.equal(parseProfile({ ...valid, dietary: { tags: [], note: 42 } }), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test src/lib/travelerProfile.test.mjs`
Expected: FAIL — the existing `parseProfile` returns a profile with no `dietary` key, so `assert.deepEqual(parsed.dietary, ...)` fails on `undefined`, and the malformed cases return a profile instead of `null`.

- [ ] **Step 3: Add the type and the parser**

In `src/lib/travelerProfile.ts`, add above `TravelerProfile`:

```ts
/** Dietary restrictions that hold across every trip. `tags` are the fixed chips the
 *  traveler picked; `note` is whatever the chips don't cover. Both empty is normal and
 *  means "no restrictions" — it is not a missing value. */
export interface DietaryNeeds {
  tags: string[];
  note: string;
}
```

Add the field to `TravelerProfile`, after `topPriorities`:

```ts
  dietary: DietaryNeeds;
```

Add this parser above `parseProfile`:

```ts
/**
 * Returns the default for an absent `dietary` rather than rejecting the profile: rows
 * written before this field existed are valid profiles, and failing them would silently
 * wipe a traveler's saved preferences the first time they loaded the page. A *malformed*
 * dietary is still rejected — that's a contract failure, not an old row.
 */
function parseDietary(value: unknown): DietaryNeeds | null {
  if (value === undefined || value === null) return { tags: [], note: "" };
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const d = value as Record<string, unknown>;

  const tags =
    d.tags === undefined
      ? []
      : Array.isArray(d.tags) && d.tags.every((t) => typeof t === "string")
        ? (d.tags as string[])
        : null;
  const note = d.note === undefined ? "" : typeof d.note === "string" ? d.note : null;
  if (tags === null || note === null) return null;
  return { tags, note };
}
```

In `parseProfile`, add the call above the guard block:

```ts
  const dietary = parseDietary(v.dietary);
```

add `dietary === null ||` to the guard's condition, and add `dietary,` to the returned object literal.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test src/lib/travelerProfile.test.mjs`
Expected: PASS, 9 tests (5 existing + 4 new).

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: 40 tests pass; no type errors; still exactly 2 pre-existing lint errors.

Note: `tsc` will flag any place constructing a `TravelerProfile` literal without `dietary`. If it flags `src/app/page.tsx`'s write-back object, add `dietary` to it for now — Task 6 deletes that block entirely.

- [ ] **Step 6: Commit**

```bash
git add src/lib/travelerProfile.ts src/lib/travelerProfile.test.mjs
git commit -m "Add dietary needs to the traveler profile

Dietary restrictions change food stops on every day of every trip but
are not a per-trip question, so there was nowhere to put them.

An absent dietary parses to the empty default rather than failing the
profile: rows written before this field existed are valid, and
rejecting them would silently wipe a traveler's saved preferences the
first time they loaded the page. A malformed dietary is still
rejected -- that is a contract failure, not an old row."
```

---

### Task 2: `formatDietary`

**Files:**
- Create: `src/lib/dietaryPrompt.ts`
- Test: `src/lib/dietaryPrompt.test.mjs` (create)

**Interfaces:**
- Consumes: `DietaryNeeds` from Task 1 (type only).
- Produces: `formatDietary(dietary: DietaryNeeds | null): string` — returns `""` when there is nothing to say. Task 3 imports it.

- [ ] **Step 1: Write the failing test**

Create `src/lib/dietaryPrompt.test.mjs`:

```js
/* Run: node --test src/lib/dietaryPrompt.test.mjs
 *
 * "Says nothing when there is nothing to say" is the load-bearing case: a traveler with no
 * restrictions must produce a byte-identical prompt to the one this app sent before dietary
 * needs existed. The rest pins that a restriction actually reaches the model, since a
 * silently-dropped allergy is the worst failure this feature can have. */
import assert from "node:assert/strict";
import test from "node:test";
import { formatDietary } from "./dietaryPrompt.ts";

test("returns an empty string when there is nothing to say", () => {
  assert.equal(formatDietary(null), "");
  assert.equal(formatDietary({ tags: [], note: "" }), "");
  assert.equal(formatDietary({ tags: [], note: "   " }), "");
});

test("renders tags alone", () => {
  const out = formatDietary({ tags: ["Vegetarian", "Nut allergy"], note: "" });
  assert.match(out, /Vegetarian, Nut allergy/);
  assert.match(out, /Dietary needs:/);
});

test("renders a note alone", () => {
  const out = formatDietary({ tags: [], note: "no shellfish" });
  assert.match(out, /no shellfish/);
});

test("renders tags and note together", () => {
  const out = formatDietary({ tags: ["Vegan"], note: "no raw onion" });
  assert.match(out, /Vegan/);
  assert.match(out, /no raw onion/);
});

test("tells the model to act on it, not just note it", () => {
  const out = formatDietary({ tags: ["Vegan"], note: "" });
  assert.match(out, /every food stop/i);
});

test("trims surrounding whitespace from the note", () => {
  const out = formatDietary({ tags: [], note: "  no shellfish  " });
  assert.doesNotMatch(out, / {2}no shellfish/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/lib/dietaryPrompt.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` — `./dietaryPrompt.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/lib/dietaryPrompt.ts`. **Every import must be `import type`** so the module stays loadable from a `.test.mjs`:

```ts
import type { DietaryNeeds } from "./travelerProfile";

/**
 * The traveler's dietary restrictions, rendered as a prompt block. Its own module rather
 * than a helper inside `itineraryPrompt.ts` for the same reason `travelerProfilePrompt.ts`
 * is: that file imports `TIERS` as a value, which makes it unloadable from a `.test.mjs`
 * under Node's type-stripping. A silently-dropped allergy is the worst failure this
 * feature can have, so it gets to be tested.
 *
 * Returns "" when there is nothing to say, so a traveler with no restrictions produces a
 * byte-identical prompt to the one this app sent before dietary needs existed.
 */
export function formatDietary(dietary: DietaryNeeds | null): string {
  if (!dietary) return "";

  const note = dietary.note.trim();
  const parts: string[] = [];
  if (dietary.tags.length > 0) parts.push(dietary.tags.join(", "));
  if (note) parts.push(note);
  if (parts.length === 0) return "";

  return `\nDietary needs: ${parts.join("; ")}. Every food stop must have something that genuinely fits — name what to order or which counter to use in that stop's "note", and never route the day through somewhere they would have nothing to eat. This constrains which food stops are chosen; it is not a remark to append to them.\n`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/lib/dietaryPrompt.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test && npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: 46 tests pass; no type errors; 2 pre-existing lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/dietaryPrompt.ts src/lib/dietaryPrompt.test.mjs
git commit -m "Add formatDietary, the traveler's restrictions as a prompt block

Own module for the same reason travelerProfilePrompt.ts is one:
itineraryPrompt.ts imports TIERS as a value and so cannot be loaded
from a .test.mjs. A silently-dropped allergy is the worst failure this
feature can have, so it gets to be tested.

Returns an empty string when there is nothing to say, so a traveler
with no restrictions produces a byte-identical prompt to before."
```

---

### Task 3: Thread dietary into the prompts and the request

**Files:**
- Modify: `src/lib/itineraryPrompt.ts`
- Modify: `src/lib/generationRunner.ts`
- Modify: `src/app/api/itinerary/route.ts`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `formatDietary` (Task 2), `DietaryNeeds` (Task 1).
- Produces: an optional `dietary?: DietaryNeeds | null` on `buildGeneratePrompt`, `buildRefinePrompt`, `buildCritiquePrompt`, and on `GenerationParams`. The request body gains a `dietary` field.

- [ ] **Step 1: Add the parameter to the three prompt builders**

In `src/lib/itineraryPrompt.ts`, add to the imports:

```ts
import { formatDietary } from "./dietaryPrompt";
import type { DietaryNeeds } from "./travelerProfile";
```

Add `dietary?: DietaryNeeds | null;` to the params type of `buildGeneratePrompt`, `buildRefinePrompt`, and `buildCritiquePrompt`.

In `buildGeneratePrompt` and `buildRefinePrompt`, the templates already interpolate `${formatTravelerProfile(params.resolvedFlags ?? null)}`. Insert the dietary block immediately after it in both:

```
${formatTravelerProfile(params.resolvedFlags ?? null)}${formatDietary(params.dietary ?? null)}
```

In `buildCritiquePrompt`, do the same — append `${formatDietary(params.dietary ?? null)}` directly after the existing `${formatTravelerProfile(params.resolvedFlags ?? null)}` interpolation, and extend the numbered review list with a sixth criterion by appending this to the end of the existing `Review it for:` sentence, before its closing period:

```
, (6) whether every food stop actually fits the traveler's dietary needs above, if any were given — a stop they could not eat at is a defect even if the rest of the day is good
```

- [ ] **Step 2: Thread it through the runner**

In `src/lib/generationRunner.ts`, add to the imports:

```ts
import type { DietaryNeeds } from "./travelerProfile";
```

Add to the `GenerationParams` interface:

```ts
  dietary?: DietaryNeeds | null;
```

Destructure `dietary` alongside the other params at the top of `runGeneration`, and add `dietary,` to the object literals passed to `buildRefinePrompt`, `buildGeneratePrompt`, and `buildCritiquePrompt`.

- [ ] **Step 3: Accept it in the route**

In `src/app/api/itinerary/route.ts`, add `dietary` to the destructuring of `body`, and add `dietary,` to the `params` object literal built for `runGeneration`.

- [ ] **Step 4: Send it from the client**

In `src/app/page.tsx`, add a state declaration next to the other profile-seeded state:

```ts
  // Durable, and unlike the others it has no wizard screen — /profile is where it's set.
  // Held here only so generate()/refine() can send it.
  const [dietary, setDietary] = useState<DietaryNeeds>({ tags: [], note: "" });
```

Add the import:

```ts
import type { DietaryNeeds } from "@/lib/travelerProfile";
```

In the profile-seeding `useEffect`, add `setDietary(profile.dietary);` alongside the other setters.

In both `generate()` and `refine()`, add `dietary,` to the object passed to `runStreamed`.

- [ ] **Step 5: Typecheck, lint, test**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint && npm test`
Expected: no errors; 46 tests pass (no new tests — this is parameter threading).

- [ ] **Step 6: Verify live against a running server**

Start the dev server (`npm run dev`). Save a profile with a dietary need:

```bash
curl -s -X PUT http://localhost:3000/api/profile \
  -H 'Content-Type: application/json' \
  -d '{"profile":{"group":"solo","explorerStyle":"mixed","energy":"moderate","crowds":"mixed","tier":"midrange","priorities":["Food"],"topPriorities":["Food"],"dietary":{"tags":["Vegetarian"],"note":"no shellfish"}}}'
```

Expected: `{"ok":true}`. Then generate with that dietary sent explicitly, and capture the `runId`:

```bash
curl -s -X POST http://localhost:3000/api/itinerary \
  -H 'Content-Type: application/json' \
  -d '{"destination":"Kyoto, Japan","startDate":"2026-09-19","endDate":"2026-09-21","budget":1200,"tier":"midrange","preferences":{"tags":["Food"],"vibe":null},"dietary":{"tags":["Vegetarian"],"note":"no shellfish"}}' \
  | head -c 200
```

Fetch `GET http://localhost:3000/api/llm-traces/runs/<runId>`, find the step with `type: "generate"`, and confirm its `prompt` contains a `Dietary needs: Vegetarian; no shellfish.` line. Then repeat the generate **without** the `dietary` field and confirm that prompt contains no `Dietary needs:` line at all.

- [ ] **Step 7: Commit**

```bash
git add src/lib/itineraryPrompt.ts src/lib/generationRunner.ts src/app/api/itinerary/route.ts src/app/page.tsx
git commit -m "Feed dietary needs into the generate, refine and critique prompts

Threaded as an optional parameter the same way resolvedFlags was, so a
request without it produces a byte-identical prompt to before.

Critique gains a sixth criterion: a food stop the traveler cannot eat
at is a defect even when the rest of the day is good, and critique is
the pass that already catches this class of problem before anyone
sees it."
```

---

### Task 4: `summarizeDurable`

The collapsed expander shows the values actually in effect. That summary is pure string work over five values, so it lives in its own testable module rather than inline in an already-large page.

**Files:**
- Create: `src/lib/profileSummary.ts`
- Test: `src/lib/profileSummary.test.mjs` (create)

**Interfaces:**
- Consumes: `ExplorerStyle`, `EnergyLevel`, `CrowdPreference` from `src/lib/types.ts`; `TierId` from `src/lib/tiers.ts` (types only).
- Produces: `summarizeDurable(values: DurableSummaryInput): string`. Task 6 imports it.

- [ ] **Step 1: Write the failing test**

Create `src/lib/profileSummary.test.mjs`:

```js
/* Run: node --test src/lib/profileSummary.test.mjs
 *
 * This line is the only thing telling a traveler which remembered preferences are being
 * applied to the trip they're about to generate. If it drifts from the real values, the
 * expander stops being an explanation and becomes a second source of truth. */
import assert from "node:assert/strict";
import test from "node:test";
import { summarizeDurable } from "./profileSummary.ts";

const base = {
  explorerStyle: "relaxed",
  energy: "low",
  crowds: "avoid",
  tier: "midrange",
  topPriorities: ["Food", "Culture & History"],
};

test("names every value in effect, separated by middots", () => {
  const out = summarizeDurable(base);
  assert.equal(out, "Relaxed pace · Low energy · Avoids crowds · Mid-range · Food, Culture & History");
});

test("each enum renders its own short label, not the picker's long one", () => {
  assert.match(summarizeDurable({ ...base, energy: "high" }), /High energy/);
  assert.match(summarizeDurable({ ...base, crowds: "love" }), /Likes crowds/);
  assert.match(summarizeDurable({ ...base, explorerStyle: "packed" }), /Packed pace/);
  assert.match(summarizeDurable({ ...base, tier: "luxury" }), /Luxury/);
});

test("says so plainly when nothing is starred, rather than trailing an empty segment", () => {
  const out = summarizeDurable({ ...base, topPriorities: [] });
  assert.match(out, /No starred interests/);
  assert.doesNotMatch(out, /· *$/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/lib/profileSummary.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` — `./profileSummary.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/lib/profileSummary.ts`. **Type-only imports** so it stays testable:

```ts
import type { CrowdPreference, EnergyLevel, ExplorerStyle } from "./types";
import type { TierId } from "./tiers";

export interface DurableSummaryInput {
  explorerStyle: ExplorerStyle;
  energy: EnergyLevel;
  crowds: CrowdPreference;
  tier: TierId;
  topPriorities: string[];
}

/**
 * Deliberately its own short labels rather than the pickers' — this is a different register.
 * "High — walk all day" is a good radio-button label and a bad summary segment, and the
 * pickers' constants are value exports anyway, which would make this module unloadable from
 * a .test.mjs.
 */
const STYLE_LABEL: Record<ExplorerStyle, string> = {
  packed: "Packed pace",
  relaxed: "Relaxed pace",
  offbeat: "Offbeat",
  mixed: "Mixed pace",
};

const ENERGY_LABEL: Record<EnergyLevel, string> = {
  high: "High energy",
  moderate: "Moderate energy",
  low: "Low energy",
};

const CROWDS_LABEL: Record<CrowdPreference, string> = {
  love: "Likes crowds",
  mixed: "Crowds either way",
  avoid: "Avoids crowds",
};

const TIER_LABEL: Record<TierId, string> = {
  budget: "Budget",
  midrange: "Mid-range",
  luxury: "Luxury",
};

/**
 * One line naming the remembered preferences being applied to this trip. It exists so the
 * expander is the explanation of something visible rather than a hidden control — a
 * traveler who cannot see these values has no way to tell the app remembered them.
 */
export function summarizeDurable(values: DurableSummaryInput): string {
  const priorities =
    values.topPriorities.length > 0
      ? values.topPriorities.join(", ")
      : "No starred interests";

  return [
    STYLE_LABEL[values.explorerStyle],
    ENERGY_LABEL[values.energy],
    CROWDS_LABEL[values.crowds],
    TIER_LABEL[values.tier],
    priorities,
  ].join(" · ");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/lib/profileSummary.test.mjs`
Expected: PASS, 3 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test && npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: 49 tests pass; no type errors; 2 pre-existing lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/profileSummary.ts src/lib/profileSummary.test.mjs
git commit -m "Add summarizeDurable for the wizard's remembered-preferences line

One line naming the preferences being applied to this trip, so the
expander is the explanation of something visible rather than a hidden
control -- a traveler who cannot see these values has no way to tell
the app remembered them.

Its own short labels rather than the pickers': 'High -- walk all day'
is a good radio label and a bad summary segment, and the pickers'
constants are value exports, which would make this module unloadable
from a .test.mjs."
```

---

### Task 5: The `/profile` page

**Files:**
- Create: `src/components/DietaryPicker.tsx`
- Create: `src/app/profile/page.tsx`
- Modify: `src/components/ExplorerStylePicker.tsx` (export its options constant)
- Modify: `src/components/Navbar.tsx` (add the link)

**Interfaces:**
- Consumes: `TravelerProfile`, `DietaryNeeds` (Task 1); `GET`/`PUT /api/profile`.
- Produces: `DIETARY_TAGS` exported from `DietaryPicker.tsx`; the `/profile` route. Task 7 reuses `DietaryPicker`.

- [ ] **Step 1: Export the explorer-style options**

`src/components/ExplorerStylePicker.tsx` declares `const EXPLORER_STYLES` privately. Change that line to `export const EXPLORER_STYLES` so `/profile` can render the same options without redeclaring them. Nothing else in that file changes.

- [ ] **Step 2: Create the dietary picker**

Create `src/components/DietaryPicker.tsx`, following `InterestPicker`'s chip idiom:

```tsx
"use client";

import type { DietaryNeeds } from "@/lib/travelerProfile";

/** Fixed chips covering the restrictions that actually change which food stops fit. The
 *  free-text note is for everything else — the list is deliberately short rather than an
 *  attempt to enumerate every diet. */
export const DIETARY_TAGS = [
  "Vegetarian",
  "Vegan",
  "Pescatarian",
  "Halal",
  "Kosher",
  "Gluten-free",
  "Dairy-free",
  "Nut allergy",
] as const;

export default function DietaryPicker({
  value,
  onChange,
}: {
  value: DietaryNeeds;
  onChange: (next: DietaryNeeds) => void;
}) {
  const toggle = (tag: string) => {
    const tags = value.tags.includes(tag)
      ? value.tags.filter((t) => t !== tag)
      : [...value.tags, tag];
    onChange({ ...value, tags });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {DIETARY_TAGS.map((tag) => {
          const on = value.tags.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(tag)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                on
                  ? "bg-accent text-accent-foreground"
                  : "bg-white/10 text-foreground hover:bg-white/20"
              }`}
            >
              {tag}
            </button>
          );
        })}
      </div>
      <input
        type="text"
        value={value.note}
        onChange={(e) => onChange({ ...value, note: e.target.value })}
        placeholder="Anything else — e.g. no shellfish, low salt"
        className="w-full rounded-full bg-white/10 px-3.5 py-2 text-sm text-foreground placeholder:text-muted/60 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
      />
    </div>
  );
}
```

- [ ] **Step 3: Create the profile page**

Create `src/app/profile/page.tsx`. It is a client page; `AppShell` already wraps it via the root layout, matching `/trips`:

```tsx
"use client";

import { useEffect, useState } from "react";
import ChoicePicker, { CROWD_PREFERENCES, ENERGY_LEVELS } from "@/components/ChoicePicker";
import ExplorerStylePicker from "@/components/ExplorerStylePicker";
import GroupTypePicker from "@/components/GroupTypePicker";
import InterestPicker from "@/components/InterestPicker";
import TierPicker from "@/components/TierPicker";
import DietaryPicker from "@/components/DietaryPicker";
import ErrorNote from "@/components/ErrorNote";
import type { TravelerProfile } from "@/lib/travelerProfile";
import type { CrowdPreference, EnergyLevel, ExplorerStyle, GroupType } from "@/lib/types";
import type { TierId } from "@/lib/tiers";

const DEFAULTS: TravelerProfile = {
  group: "solo",
  explorerStyle: "mixed",
  energy: "moderate",
  crowds: "mixed",
  tier: "midrange",
  priorities: [],
  topPriorities: [],
  dietary: { tags: [], note: "" },
};

const MAX_STARRED = 3;

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-display text-base font-semibold text-foreground">{title}</h2>
      {hint && <p className="text-sm text-muted">{hint}</p>}
      <div className="pt-1">{children}</div>
    </section>
  );
}

/**
 * Where the durable traveler traits are actually owned. The plan wizard asks only what
 * changes per trip, so without this page explorer style, energy, crowds, tier, priorities
 * and dietary needs would be set once and never changeable.
 */
export default function ProfilePage() {
  const [profile, setProfile] = useState<TravelerProfile>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/profile")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.profile) setProfile(data.profile as TravelerProfile);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const set = <K extends keyof TravelerProfile>(key: K, value: TravelerProfile[K]) => {
    setProfile((p) => ({ ...p, [key]: value }));
    setSaved(false);
  };

  function toggleInterest(tag: string) {
    const selected = profile.priorities.includes(tag)
      ? profile.priorities.filter((t) => t !== tag)
      : [...profile.priorities, tag];
    // Unstarring follows deselection — a starred tag that is no longer selected would
    // otherwise keep driving the plan while showing as unselected.
    const starred = profile.topPriorities.filter((t) => selected.includes(t));
    setProfile((p) => ({ ...p, priorities: selected, topPriorities: starred }));
    setSaved(false);
  }

  function toggleStar(tag: string) {
    const starred = profile.topPriorities.includes(tag)
      ? profile.topPriorities.filter((t) => t !== tag)
      : profile.topPriorities.length < MAX_STARRED
        ? [...profile.topPriorities, tag]
        : profile.topPriorities;
    setProfile((p) => ({ ...p, topPriorities: starred }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't save your profile.");
      setSaved(true);
    } catch (e) {
      // Unlike the onboarding card's opportunistic save, this form's whole purpose is
      // saving — staying silent about a failure here would be a lie.
      setError(e instanceof Error ? e.message : "Couldn't save your profile.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted">Loading your profile…</p>;
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8 pb-16">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-semibold text-foreground">Your travel profile</h1>
        <p className="text-sm text-muted">
          The things that stay true between trips. We apply these to every plan so the wizard
          only has to ask what actually changes.
        </p>
      </header>

      <Section
        title="Who you usually travel with"
        hint="A default only — the planner still asks who's coming on each trip, since that changes."
      >
        <GroupTypePicker selected={profile.group} onSelect={(v: GroupType) => set("group", v)} />
      </Section>

      <Section title="Explorer style">
        <ExplorerStylePicker
          selected={profile.explorerStyle}
          onSelect={(v: ExplorerStyle) => set("explorerStyle", v)}
        />
      </Section>

      <Section title="How much walking suits you">
        <ChoicePicker
          name="energy"
          options={[...ENERGY_LEVELS]}
          selected={profile.energy}
          onSelect={(v: EnergyLevel) => set("energy", v)}
        />
      </Section>

      <Section title="Crowds">
        <ChoicePicker
          name="crowds"
          options={[...CROWD_PREFERENCES]}
          selected={profile.crowds}
          onSelect={(v: CrowdPreference) => set("crowds", v)}
        />
      </Section>

      <Section title="Spending style">
        <TierPicker
          days={null}
          budget={0}
          selected={profile.tier}
          onSelect={(v: TierId) => set("tier", v)}
        />
      </Section>

      <Section title="What matters most" hint="Star up to three — the starred ones drive the plan.">
        <InterestPicker
          selected={profile.priorities}
          starred={profile.topPriorities}
          onToggle={toggleInterest}
          onToggleStar={toggleStar}
        />
      </Section>

      <Section
        title="Dietary needs"
        hint="Applied to every food stop on every trip. Leave empty if nothing applies."
      >
        <DietaryPicker value={profile.dietary} onChange={(v) => set("dietary", v)} />
      </Section>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save profile"}
        </button>
        {saved && <span className="text-sm text-muted">Saved.</span>}
      </div>
    </div>
  );
}
```

`ErrorNote` takes its message as `children` (`src/components/ErrorNote.tsx`), which is why it is used as `<ErrorNote>{error}</ErrorNote>` above rather than with a `message` prop. Do not change that component.

- [ ] **Step 4: Add the nav link**

In `src/components/Navbar.tsx`, there are two `<Link href="/trips" ...>` entries (a desktop and a mobile/secondary one) plus a mobile menu list. Add a `Profile` link pointing at `/profile` immediately alongside each `My memories` link, reusing the exact same `className` expression that the adjacent `/trips` link uses in that spot. Do not restructure the nav.

- [ ] **Step 5: Typecheck, lint, test**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint && npm test`
Expected: no errors; 49 tests pass; still exactly 2 pre-existing lint errors.

- [ ] **Step 6: Verify live**

With the dev server running, open `http://localhost:3000/profile`:
1. The page loads showing the saved profile from Task 3's `curl` (solo / mixed / moderate / mixed / mid-range / Food starred / Vegetarian + "no shellfish").
2. Change energy to **Low**, add the **Vegan** chip, click **Save profile**. "Saved." appears.
3. Reload the page — the changes persisted.
4. Confirm via the API that the row matches:

```bash
curl -s http://localhost:3000/api/profile
```

- [ ] **Step 7: Commit**

```bash
git add src/components/DietaryPicker.tsx src/app/profile/page.tsx src/components/ExplorerStylePicker.tsx src/components/Navbar.tsx
git commit -m "Add the /profile page owning the durable traveler traits

The wizard is about to stop asking these, which would leave them set
once and never changeable -- so the editor ships before the questions
are removed, not after.

Reuses the wizard's own pickers rather than reimplementing them, and
labels the group field as a default since it is the one trait that is
both remembered here and still asked per trip.

A failed save is surfaced: unlike the opportunistic post-generation
save, this form's whole purpose is saving, so silence would be a lie."
```

---

### Task 6: Remove the automatic profile write-back

**Files:**
- Modify: `src/app/page.tsx` — the `generate()` success path

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing. After this task, `/profile` (Task 5) is the only writer until Task 8 adds the onboarding card.

- [ ] **Step 1: Delete the write-back**

In `src/app/page.tsx`'s `generate()`, remove the entire `fetch("/api/profile", { method: "PUT", ... }).catch(() => {});` block that runs after `setStep("result")`, together with its explanatory comment.

In its place, leave a comment recording why nothing writes here any more:

```ts
      // Deliberately no profile write here. The wizard's "Adjust for this trip" values are a
      // per-trip override, and writing them back would silently make one unusual trip the
      // traveler's permanent default — the bug this codebase already hit twice with `tier`.
      // /profile and the onboarding card are the only writers.
```

- [ ] **Step 2: Typecheck, lint, test**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint && npm test`
Expected: no errors; 49 tests pass.

If `tsc` now reports unused variables in `generate()` (for example `starredInterests` if it was referenced only by the deleted block), do not delete those state declarations — they are still used by the wizard's own screens. Confirm each is genuinely unused before touching it, and report rather than guess if one appears to be.

- [ ] **Step 3: Verify the behavior change live**

With the dev server running:
1. `curl -s http://localhost:3000/api/profile` — note the current stored values.
2. In the browser, run a generation through the wizard, deliberately choosing a **different** energy level than the stored one.
3. `curl -s http://localhost:3000/api/profile` again — the stored profile must be **unchanged**. Before this task it would have been overwritten by the wizard's values.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "Stop writing the profile back after every generation

The wizard is becoming a per-trip surface with an override expander,
and an override must not silently become a permanent default -- that
is the bug this codebase already hit twice with tier being clobbered.

/profile is the only writer until the onboarding card lands. The cost
is that a traveler who never visits either surface keeps the longer
wizard, which is the correct trade: it is their choice, and it is
stated plainly where the choice is offered."
```

---

### Task 7: Recompose the wizard to four screens

The largest task. The pickers are already extracted components, so this is moving JSX between screens and adding one expander — not rewriting any picker.

**Files:**
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `summarizeDurable` (Task 4).
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Shorten the step list**

In `src/app/page.tsx`, change the `PlanStep` type and `PLAN_ORDER` to the four per-trip screens:

```ts
type PlanStep = "basics" | "purpose" | "group" | "pois";
const PLAN_ORDER: PlanStep[] = ["basics", "purpose", "group", "pois"];
```

Update the comment above them, which currently explains that screens 2-6 give the Step 2a fetch time to land, to reflect the new count:

```ts
/** Only what changes per trip. Explorer style, energy, crowds, tier and priorities live on
 *  /profile and are overridable for one trip via the expander on `basics`. The two screens
 *  between `basics` and `pois` still give the Step 2a fetch time to land before `pois` —
 *  the one fetch-dependent screen — is reached. Keep `pois` last. */
```

- [ ] **Step 2: Add the expander state and imports**

Add the import:

```ts
import { summarizeDurable } from "@/lib/profileSummary";
```

Add one state declaration alongside the other wizard state:

```ts
  // The single "Adjust for this trip" block. One expander, never one per field: the whole
  // point is that the worst case (open it every trip) is still fewer interactions than the
  // seven screens this replaced, and per-field expanders would climb back past that.
  const [adjustOpen, setAdjustOpen] = useState(false);
```

- [ ] **Step 3: Add the summary line and expander to the basics screen**

In the `{planStep === "basics" && (...)}` block, after the closing `</div>` of the `field-console` element and before the block's closing `</>`, insert:

```tsx
                  {/* The collapsed state names the remembered values rather than hiding behind
                      a bare "Adjust" link — a traveler who cannot see these has no way to know
                      the app applied them, and a hidden control reads as the app having
                      forgotten. Everything durable lives in this one block: no pagination, no
                      second expander. */}
                  <div className="mt-3 rounded-2xl border border-white/10 bg-surface-deep/50 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-muted">
                        {summarizeDurable({
                          explorerStyle,
                          energy,
                          crowds,
                          tier,
                          topPriorities: starredInterests,
                        })}
                      </p>
                      <button
                        type="button"
                        aria-expanded={adjustOpen}
                        onClick={() => setAdjustOpen((v) => !v)}
                        className="shrink-0 text-xs font-medium text-accent underline-offset-4 hover:underline"
                      >
                        {adjustOpen ? "Done" : "Adjust for this trip"}
                      </button>
                    </div>

                    {adjustOpen && (
                      <div className="mt-4 space-y-5 border-t border-white/10 pt-4">
                        <p className="text-xs text-muted">
                          Changes here apply to this trip only. Your saved profile is untouched —
                          edit it on the <Link href="/profile" className="text-accent underline-offset-4 hover:underline">profile page</Link>.
                        </p>
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted">Explorer style</label>
                          <ExplorerStylePicker selected={explorerStyle} onSelect={setExplorerStyle} />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted">How much walking suits you</label>
                          <ChoicePicker name="energy" options={[...ENERGY_LEVELS]} selected={energy} onSelect={setEnergy} />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted">Crowds</label>
                          <ChoicePicker name="crowds" options={[...CROWD_PREFERENCES]} selected={crowds} onSelect={setCrowds} />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted">Style and budget</label>
                          <TierPicker days={days} budget={budget} selected={tier} onSelect={pickTier} />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted">What matters most</label>
                          <InterestPicker
                            selected={interests}
                            starred={starredInterests}
                            onToggle={toggleInterest}
                            onToggleStar={toggleInterestStar}
                          />
                        </div>
                      </div>
                    )}
                  </div>
```

Confirm `Link` is imported from `next/link` at the top of the file; add the import if it is not.

- [ ] **Step 4: Reduce the group screen and delete the three absorbed screens**

In the `{planStep === "group" && (...)}` block, remove the `Explorer style` label and its `<ExplorerStylePicker>` (now in the expander), leaving only the `Who's going` picker. Simplify the wrapper so a single picker is not wrapped in a `space-y-5` stack, and update the screen's copy since it no longer covers two questions:

```tsx
              {planStep === "group" && (
                <Screen
                  name="Group"
                  title="Who's going?"
                  subtitle="This changes trip to trip, so we ask every time."
                >
                  <GroupTypePicker selected={group} onSelect={setGroup} />
                </Screen>
              )}
```

Then delete these three blocks entirely: `{planStep === "profile" && (...)}`, `{planStep === "crowds" && (...)}`, and `{planStep === "priorities" && (...)}`. Their pickers now render inside the expander.

- [ ] **Step 5: Typecheck, lint, test**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint && npm test`
Expected: no errors; 49 tests pass. Every picker deleted from a screen is still referenced by the expander, so no import should become unused — if `tsc` reports one, something was deleted that should have moved.

- [ ] **Step 6: Verify live in the browser**

This step needs a browser. If executing via subagent-driven-development, the dispatched implementer cannot do it — it belongs to whoever drives the browser tooling.

With the dev server running and a saved profile:
1. Walk the wizard: it must show exactly four screens — basics, purpose, group, pois.
2. On basics, the summary line reads the saved values (e.g. `Relaxed pace · Low energy · Avoids crowds · Mid-range · Food`).
3. Click **Adjust for this trip** — one block opens containing all five pickers, with no Next/step controls inside it. Confirm there is exactly one expander on the screen.
4. Change energy to **High** inside the expander, generate, and read the newest `generate` trace via `GET /api/llm-traces/runs/<runId>`: the prompt's traveler-profile block must reflect **High**, proving the override reached generation.
5. `curl -s http://localhost:3000/api/profile` — the stored energy must still be the **saved** value, not High. This is the guarantee the write-back removal exists to provide.

- [ ] **Step 7: Commit**

```bash
git add src/app/page.tsx
git commit -m "Cut the plan wizard from seven screens to four

Basics, purpose, group and pois are the only questions whose answers
change between trips. Explorer style, energy, crowds, tier and
priorities move behind one expander on basics, fronted by a line
naming the values actually in effect.

One expander holding all five, never one per field: the worst case
(open it every trip) is four advance clicks against the seven screens'
six, and per-field expanders would climb back past that and reinvent
the problem this removes.

Changes made in the expander reach generation and are then forgotten --
the profile is not written from here."
```

---

### Task 8: The onboarding card

**Files:**
- Create: `src/components/OnboardingCard.tsx`
- Modify: `src/app/page.tsx` — render it on the result step

**Interfaces:**
- Consumes: the `DietaryPicker` default export (Task 5); `TravelerProfile`, `DietaryNeeds` (Task 1). `DIETARY_TAGS` is not needed here — the picker owns its own chip list.
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Create the card**

Create `src/components/OnboardingCard.tsx`:

```tsx
"use client";

import { useState } from "react";
import DietaryPicker from "@/components/DietaryPicker";
import type { DietaryNeeds, TravelerProfile } from "@/lib/travelerProfile";

/**
 * Offered once, on the result screen, after the traveler has seen a real itinerary — not in
 * front of the first trip. There is no profile to skip screens from on a first run either
 * way, so putting this first would only move friction to the moment someone has seen no
 * value yet.
 *
 * Pre-filled with the answers they just gave, plus the one question the wizard never asks.
 * Saving is one click; dismissing costs nothing and leaves the app exactly as it was.
 */
export default function OnboardingCard({
  answers,
  onSaved,
  onDismiss,
}: {
  answers: Omit<TravelerProfile, "dietary">;
  onSaved: () => void;
  onDismiss: () => void;
}) {
  const [dietary, setDietary] = useState<DietaryNeeds>({ tags: [], note: "" });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: { ...answers, dietary } }),
      });
      if (!res.ok) throw new Error("save failed");
      onSaved();
    } catch {
      // Swallowed on purpose. This fires seconds after a two-minute generation the traveler
      // is already happy with; turning that into an error banner over an optional
      // convenience would be the wrong trade. /profile reports its own failures.
      onDismiss();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="glass-itinerary space-y-4 rounded-2xl p-4">
      <div className="space-y-1">
        <h3 className="font-display text-base font-semibold text-foreground">
          Save these for next time?
        </h3>
        <p className="text-sm text-muted">
          We&apos;ll remember how you travel and ask three fewer questions on your next trip.
          You can change any of it later on your profile.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-muted">
          Any dietary needs? We&apos;ll apply them to every food stop.
        </label>
        <DietaryPicker value={dietary} onChange={setDietary} />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save my profile"}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="text-sm text-muted underline-offset-4 hover:underline"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Render it once on the result step**

In `src/app/page.tsx`, add the import:

```ts
import OnboardingCard from "@/components/OnboardingCard";
```

Add state alongside the other result-step state:

```ts
  // Shown once, after the first generation, only when there is no profile yet. `hasProfile`
  // starts null (unknown) so the card cannot flash before the profile fetch resolves.
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
```

In the existing profile-seeding `useEffect`, set it from the same response — inside the `.then`, after the existing setters:

```ts
        setHasProfile(Boolean(profile));
```

and make sure it is also set when the fetch fails or returns nothing, so the card can appear for a genuine first-time traveler. Restructure that `.then`/`.catch` so `setHasProfile(false)` runs when `data?.profile` is absent and in the `.catch`.

Then, inside the `{step === "result" && itinerary && (...)}` block, render the card above the itinerary content:

```tsx
              {hasProfile === false && !onboardingDismissed && (
                <OnboardingCard
                  answers={{
                    group,
                    explorerStyle,
                    energy,
                    crowds,
                    tier,
                    priorities: interests,
                    topPriorities: starredInterests,
                  }}
                  onSaved={() => {
                    setHasProfile(true);
                    setOnboardingDismissed(true);
                  }}
                  onDismiss={() => setOnboardingDismissed(true)}
                />
              )}
```

Place it where it reads naturally within that block — above the itinerary card, so it is seen without scrolling, and inside whatever container the result content already uses rather than floating over the map.

- [ ] **Step 3: Typecheck, lint, test**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint && npm test`
Expected: no errors; 49 tests pass.

- [ ] **Step 4: Verify live in the browser**

Needs a browser — controller's step, as in Task 7.

1. Delete the profile row so this is a genuine first run:
   ```bash
   node -e "const D=require('better-sqlite3');const db=new D('tripmate.db');db.prepare('DELETE FROM traveler_profile').run();console.log('cleared');"
   ```
2. Reload the app, run a generation. On the result screen the card appears.
3. Add a dietary chip, click **Save my profile**. The card disappears.
4. `curl -s http://localhost:3000/api/profile` — the profile now exists, with the wizard's answers and the chosen dietary needs.
5. Run a second generation — the card must **not** reappear, and the wizard must now show the summary line with the saved values.
6. Repeat from step 1, but click **Not now** — the card disappears, no profile is written, and the wizard still shows all four screens with defaults.

- [ ] **Step 5: Commit**

```bash
git add src/components/OnboardingCard.tsx src/app/page.tsx
git commit -m "Offer to save the profile after the first trip

A dismissible card on the result screen, pre-filled with the answers
the traveler just gave plus the one question the wizard never asks.
Shown only when no profile exists, and only until it is answered or
dismissed.

Deliberately not a flow in front of the first trip: there is no
profile to skip screens from on a first run either way, so putting it
first would move friction to the moment someone has seen no value yet.

A failed save is swallowed -- it fires seconds after a two-minute
generation the traveler is already happy with, and an error banner
over an optional convenience is the wrong trade."
```

---

### Task 9: Update the docs

**Files:**
- Modify: `docs/frontend.md`, `docs/backend.md`, `docs/llm.md`, `docs/project-crux.md`
- Modify: `docs/superpowers/specs/2026-08-16-traveler-profile-design.md`

**Interfaces:**
- Consumes: nothing. Produces: nothing.

- [ ] **Step 1: Read the convention**

Read `docs/project-crux.md`'s "How to maintain the tracker docs" section. New feature → new row with a `Since` date and a `Developer`. All three trackers use `| Feature | Status | Since | Developer | Notes |`; the crux timeline uses `| Date | Area | Developer | What happened |`. Developer on all new rows is `Zaid`. Confirm you are appending to each file's **Features** table, not Enhancements or Bugs.

- [ ] **Step 2: Add the rows**

`docs/frontend.md`:

```md
| Four-screen plan wizard + "Adjust for this trip" | Active | 2026-08-16 | Zaid | Basics/purpose/group/pois only; explorer style, energy, crowds, tier and priorities sit behind one expander on basics fronted by a summary of the values in effect. One expander, never one per field — that is what keeps the worst case below the seven screens it replaced |
| `/profile` page | Active | 2026-08-16 | Zaid | Owns the durable traits, reusing the wizard's own pickers. Surfaces save failures, unlike the onboarding card |
| Onboarding card on the result screen | Active | 2026-08-16 | Zaid | Offered once after the first trip, pre-filled with the answers just given plus dietary needs. Dismissing costs nothing |
```

`docs/backend.md`:

```md
| `dietary` on the traveler profile | Active | 2026-08-16 | Zaid | `{ tags, note }`. A profile stored before this field existed parses to the empty default rather than being rejected, so there is no migration |
```

`docs/llm.md`:

```md
| `formatDietary()` | Active | 2026-08-16 | Zaid | Feeds dietary restrictions into generate/refine/critique beside the existing food-stop instruction; critique gained a sixth criterion for food stops the traveler could not eat at. Own module so it stays testable |
```

`docs/project-crux.md` timeline:

| Date | Area | Developer | What happened |
|---|---|---|---|
| 2026-08-16 | Frontend, Backend, LLM | Zaid | Split the plan wizard along durable vs per-trip: four per-trip screens plus one "Adjust for this trip" expander, with the durable traits owned by a new `/profile` page and offered via a dismissible onboarding card after the first trip. Added dietary needs to the profile and the prompts. Removed the automatic post-generate profile write-back so a per-trip override can never become a permanent default |

- [ ] **Step 3: Note the superseded parts of the traveler-profile spec**

`docs/superpowers/specs/2026-08-16-traveler-profile-design.md` states that the wizard is the editor for the durable values and that the profile is written after a successful generate. Both stopped being true. Add a note directly under that spec's `**Status:**` line rather than editing its body — it is an accurate record of what shipped at the time:

```md
> **Partly superseded by [`2026-08-16-onboarding-and-wizard-split-design.md`](./2026-08-16-onboarding-and-wizard-split-design.md).**
> The durable values are now owned by `/profile`, not by the wizard, and the automatic
> post-generate write-back was removed. The durable/per-trip boundary this spec drew is
> unchanged and still governs.
```

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "Log the wizard split and onboarding in the tracker docs

Also marks the parts of the traveler-profile spec this supersedes --
the wizard is no longer the editor and the automatic write-back is
gone -- with a pointer rather than an edit, since that spec is an
accurate record of what shipped at the time."
```

---

## Done criteria

- [ ] `npm test` passes with 49 tests.
- [ ] `npx tsc --noEmit -p tsconfig.json` is clean.
- [ ] `npm run lint` introduces no new errors (2 pre-existing remain).
- [ ] A traveler with a saved profile sees **four** wizard screens.
- [ ] The basics screen shows a summary line naming the remembered values, with exactly **one** expander, and no Next/step controls inside it.
- [ ] Changing a value in the expander reaches the generated prompt (confirmed in the trace) and leaves the stored profile **unchanged** (confirmed via `GET /api/profile`).
- [ ] A dietary need saved on `/profile` appears as a `Dietary needs:` block in the generate prompt; a traveler with none produces a prompt with no such block.
- [ ] The onboarding card appears after a first trip with no profile, and not after a profile exists.
- [ ] `/profile` round-trips every trait, and reports a failed save rather than staying silent.
