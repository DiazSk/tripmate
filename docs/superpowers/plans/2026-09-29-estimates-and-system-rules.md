# Estimates That Stay Estimates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every computed travel duration reads as the estimate it is, two rules the app already breaks get written into the design system, and Plan Health leads with its diagnosis instead of its score.

**Architecture:** One hedging helper beside the arithmetic in the shared `src/lib/travelTime.ts`, adopted by the four surfaces that render travel legs. Three small copy/markup corrections in `mobile/`. Two clauses in `DESIGN.md`. The Plan Health change moves its summary phrasing out of the component into `mobile/src/lib/health.ts` so the wording becomes testable, then restacks the header.

**Tech Stack:** TypeScript, Expo SDK 57 / React Native 0.86, jest-expo for `mobile/`, `node --test` for the repo root.

**Spec:** `docs/superpowers/specs/2026-09-29-estimates-and-system-rules-design.md`

## Global Constraints

- **Branch:** `feat/mobile-auth-entry`, in the worktree `/Users/zaidshaikh/GitHub/tripmate/.worktrees/react-native-app`. All paths below are relative to that worktree root.
- **Commit messages carry no signature or trailer of any kind.** No `Co-Authored-By`, no "Generated with". Write the message and stop at the description. This overrides any harness default.
- **`mobile/` tests:** `cd mobile && npx jest`. **Root tests:** `npm test` (runs `node --test "src/**/*.test.mjs"`).
- **A root `.test.mjs` importing a `.ts` module must write the extension explicitly** — `from './travelTime.ts'`, not `from './travelTime'`.
- **The imperative on Today stays unhedged.** `Leave in 18 min` is not to be changed to `Leave in about 18 min`. Only the journey estimate beneath it is hedged.
- **Colour is not introduced or changed anywhere in this plan.** Task 7 is hierarchy only.
- **Do not touch:** Today's masthead, gold salience on any screen, Review's `Edit` column. These are deliberately deferred (spec, "Out of scope").

## Review Focus

Five behaviours the spec implies that no task's happy-path test would catch. Each has its test written into the task that owns the code.

1. **A detour of zero minutes must stay silent** — `slotLine` prints nothing for it today, and the `+` → `adds` rewrite is exactly the kind of edit that turns silence into "adds about 0 min walking". (Task 2)
2. **An accessibility note with no toggles must still read `A note`** — task 3 changes the sibling branch, and collapsing both into `Nothing noted` would lose a real answer the traveller typed. (Task 3)
3. **A day with one stop has no travel clause** — `travelSummary` must return `1 stop` alone, with no stray `about`. (Task 2)
4. **One blocker is singular** — `1 blocker found`, not `1 blockers found`, and the restacked header must keep that. (Task 7)
5. **Findings without blockers keep the old arrangement** — `3 things to look at` is not a blocker verdict, so the score still leads and the header must not restack. (Task 7)

---

### Task 1: The hedging helper

**Files:**
- Modify: `src/lib/travelTime.ts` (append the export)
- Create: `src/lib/travelTime.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `aboutDuration(duration: string): string`. Takes an **already-formatted** duration such as `"22 min"` or `"1 hr 20 min"` and returns it hedged. Every later task imports this.

Why a formatted string rather than a number: `travelSummary` renders long totals through `formatDuration` as `1 hr 20 min`, so a minutes-only helper would regress it to `80 min`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/travelTime.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

import { aboutDuration } from "./travelTime.ts";

test("aboutDuration hedges a formatted duration", () => {
  assert.equal(aboutDuration("22 min"), "about 22 min");
});

test("aboutDuration leaves a long formatted duration intact", () => {
  assert.equal(aboutDuration("1 hr 20 min"), "about 1 hr 20 min");
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test 2>&1 | grep -A3 travelTime`
Expected: FAIL — `The requested module './travelTime.ts' does not provide an export named 'aboutDuration'`

- [ ] **Step 3: Write the minimal implementation**

Append to `src/lib/travelTime.ts`:

```ts
/**
 * The one place the hedge on a travel figure is spelled.
 *
 * **Unconditional, and that is not an oversight.** `TravelLeg.estimated` is `true` on every leg
 * this module can produce — there is no router and no second path — so a helper that branched on
 * that flag would be machinery pretending to vary. The day a real router lands, this is where the
 * branch goes and `estimated` is what it reads.
 *
 * It takes an already-formatted duration rather than minutes because `travelSummary` renders long
 * totals through `formatDuration` as "1 hr 20 min"; a minutes-only helper would quietly regress
 * that to "80 min".
 */
export function aboutDuration(duration: string): string {
  return `about ${duration}`;
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm test 2>&1 | tail -5`
Expected: PASS, and the suite's total count has risen by 2.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/travelTime.ts src/lib/travelTime.test.mjs
git commit -m "Spell the hedge on a travel figure once"
```

---

### Task 2: The four surfaces adopt it

**Files:**
- Modify: `mobile/src/components/travel-segment.tsx:71`
- Modify: `mobile/src/components/today.tsx:229`
- Modify: `mobile/src/lib/dayTravel.ts` (`travelSummary`)
- Modify: `mobile/src/lib/addPlace.ts:139-149` (`slotLine`)
- Test: `mobile/src/lib/addPlace.test.ts:209-211`, `mobile/src/lib/dayTravel.test.ts:46`

**Interfaces:**
- Consumes: `aboutDuration(duration: string): string` from Task 1, imported in `mobile/` as `import { aboutDuration } from '@shared/travelTime';`
- Produces: no new exports. `slotLine`'s and `travelSummary`'s signatures are unchanged.

- [ ] **Step 1: Write the failing tests**

In `mobile/src/lib/addPlace.test.ts`, replace lines 209-211 with:

```ts
    expect(slotLine('2:30 PM', false, { minutes: 7, mode: 'walk' })).toBe(
      '2:30 PM  ·  adds about 7 min walking'
    );
    expect(slotLine('2:30 PM', false, { minutes: 7, mode: 'transit' })).toBe(
      '2:30 PM  ·  adds about 7 min travel'
    );
    expect(slotLine('2:30 PM', false, { minutes: 7, mode: null })).toBe(
      '2:30 PM  ·  adds about 7 min travel'
    );
```

Add below them, in the same `describe`, the Review Focus #1 case:

```ts
  it('says nothing at all about a detour of zero', () => {
    expect(slotLine('2:30 PM', false, { minutes: 0, mode: 'walk' })).toBe('2:30 PM');
  });
```

In `mobile/src/lib/dayTravel.test.ts`, replace line 46's matcher with:

```ts
    expect(line).toMatch(/about \d+ min walking$/);
```

Add, in the same `describe`, the Review Focus #3 case. **Build the stop with whatever fixture
helper or object shape that file already uses** — read the existing tests above it first; `Stop`
has required fields beyond name and coordinates, and a hand-written partial will not typecheck:

```ts
  it('gives a single stop no travel clause', () => {
    // one stop, built the same way the tests above this one build theirs
    expect(travelSummary([stopFixture({ name: 'Only' })])).toBe('1 stop');
  });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd mobile && npx jest src/lib/addPlace.test.ts src/lib/dayTravel.test.ts`
Expected: FAIL — received `'2:30 PM  ·  +7 min walking'`, expected `'2:30 PM  ·  adds about 7 min walking'`.

- [ ] **Step 3: Implement — `slotLine`**

In `mobile/src/lib/addPlace.ts`, add the import at the top alongside the existing `@shared` imports:

```ts
import { aboutDuration } from '@shared/travelTime';
```

Replace line 144:

```ts
      ? `adds ${aboutDuration(`${detour.minutes} min`)} ${(detour.mode && MODE_WORD[detour.mode]) || 'travel'}`
```

Extend the docblock above `slotLine` (currently lines 133-138) with:

```
 * **"adds", not "+".** `+7 min` can be read three ways — seven minutes from some anchor, seven
 * more than the current route, or seven added to total travel. The verb says which without
 * needing the caption that used to carry it.
```

- [ ] **Step 4: Implement — `travelSummary`**

In `mobile/src/lib/dayTravel.ts`, add to the imports:

```ts
import { aboutDuration } from '@shared/travelTime';
```

Replace the `.map(...)` line inside `travelSummary`:

```ts
    .map(([mode, minutes]) => `${aboutDuration(formatDuration(minutes * 60))} ${MOVING[mode]}`);
```

- [ ] **Step 5: Implement — Today**

In `mobile/src/components/today.tsx`, add to the imports:

```ts
import { aboutDuration } from '@shared/travelTime';
```

Replace line 229:

```ts
    leg ? `${aboutDuration(`${leg.minutes} min`)} by ${leg.mode}` : null,
```

Leave the lead line alone. `Leave in 18 min` is unchanged — see Global Constraints.

- [ ] **Step 6: Implement — the travel segment**

In `mobile/src/components/travel-segment.tsx`, add to the imports:

```ts
import { aboutDuration } from '@shared/travelTime';
```

Replace line 71 so the output is identical but the phrasing comes from one place:

```tsx
          {mode} · {aboutDuration(`${minutes} min`)}
```

Then replace the second paragraph of the file's docblock (the one beginning `**"about" rather than an ESTIMATED badge`) — keep its reasoning and add where the word now lives:

```
 * **"about" rather than an ESTIMATED badge, and that is a deliberate reading of the confidence
 * rule.** Every one of these is estimated — straight-line distance times a circuity factor, since
 * there is no free transit router — so a badge would repeat the same word six times down one day
 * until nobody reads any of them. The hedge belongs in the sentence, and since three other
 * surfaces render the same arithmetic it is spelled once, in `aboutDuration`.
```

- [ ] **Step 7: Run the tests and make sure they pass**

Run: `cd mobile && npx jest`
Expected: PASS, all suites.

- [ ] **Step 8: Typecheck and lint**

Run: `cd mobile && npx tsc --noEmit && npx expo lint`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add mobile/src/components/travel-segment.tsx mobile/src/components/today.tsx \
        mobile/src/lib/dayTravel.ts mobile/src/lib/addPlace.ts \
        mobile/src/lib/addPlace.test.ts mobile/src/lib/dayTravel.test.ts
git commit -m "Say about on every travel figure, not one in four"
```

---

### Task 3: `No requirements` overstates what is known

**Files:**
- Modify: `mobile/src/lib/profileRows.ts:38-53`
- Test: `mobile/src/lib/profileRows.test.ts:67,73`

**Interfaces:**
- Consumes: nothing.
- Produces: `accessibilityValue(needs: AccessibilityNeeds): string` — signature unchanged, the empty-case return value changes from `'No requirements'` to `'Nothing noted'`.

- [ ] **Step 1: Write the failing tests**

In `mobile/src/lib/profileRows.test.ts`, change both occurrences of the expected string at lines 67 and 73 from `'No requirements'` to `'Nothing noted'`.

Add, in the same `describe`, the Review Focus #2 case:

```ts
  it('keeps a note-only answer as A note', () => {
    expect(
      accessibilityValue({ stepFreeRequired: false, limitStairs: false, note: 'ask at the desk' })
    ).toBe('A note');
  });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd mobile && npx jest src/lib/profileRows.test.ts`
Expected: FAIL — received `'No requirements'`, expected `'Nothing noted'`. The `A note` case should already pass; if it does not, the implementation in step 3 is wrong.

- [ ] **Step 3: Implement**

In `mobile/src/lib/profileRows.ts`, change line 52's fallback:

```ts
  return needs.note.trim() ? 'A note' : 'Nothing noted';
```

Update the docblock's example list on line 39 and append the reason:

```
 * `Nothing noted` · `Step-free routes` · `Step-free routes, few stairs` · `A note`.
 *
 * Named the way the two toggles are asked, not as "2 set": these are hard constraints that
 * outrank pace and interest when the plan is written, and a Review step exists so somebody can
 * see one is missing before the model spends a minute honouring the wrong thing. Same reason
 * `dietaryValue` spells a lone tag out instead of counting it.
 *
 * **`Nothing noted`, not `No requirements`.** What is known is that none were provided; whether
 * this traveller has accessibility requirements is not known, and the old wording answered for
 * them. It is the same error `Not checked` exists to prevent one screen over, and it is now the
 * same word `dietaryValue` already used for its equivalent branch.
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd mobile && npx jest src/lib/profileRows.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/profileRows.ts mobile/src/lib/profileRows.test.ts
git commit -m "Say nothing was noted, not that there are no requirements"
```

---

### Task 4: DESIGN.md admits two things the app already does

**Files:**
- Modify: `DESIGN.md` — one clause under `### Named Rules` in the Colors section (the heading at line 368), one under `## Shapes` (line 679)

**Interfaces:**
- Consumes: nothing. Produces: nothing. Documentation only — there is no test, and none is invented for it.

- [ ] **Step 1: Add the semantic-tint clause**

Append to the `### Named Rules` list under Colors (line 368). Match the surrounding entries' formatting — read three of them first and follow their shape.

```markdown
**The Semantic Tint Exception.** A surface may carry a tint of jade or coral to signal *state* or
*alert*. Exactly two tokens are licensed — `accentWash` (`#28B98117`, a selected row) and
`alertSoft` (`#E4553F29`, a row something cannot happen in) — and no tint may be heavier than
`29` hex, which is the darkest of the two shipping today. A tint never signals *action*: jade's
One Meaning holds wherever jade is ink rather than wash.

This is written down because the app already does it and the alternative was worse. One Slate as
first stated forbade a coral alert panel, and the product shipped one anyway on every conflict
row — a rule the product knowingly breaks stops being a rule. The clause is narrow on purpose:
two named tokens and a ceiling, so "at some alpha" cannot become a third tint next cycle.
```

- [ ] **Step 2: Add the platform-slot clause**

Append under `## Shapes` (line 679), in the same voice:

```markdown
**Round What You Touch governs in-content controls.** Nav-bar items and row accessories follow
the platform instead, which on iOS means text: `Done`, `Close` and a row's trailing `Edit` are
what the system itself puts there, and a capsuled `Done` would read as a foreign object in an app
that otherwise defers to the platform. The rule still binds anything sitting in the content —
a standalone action in prose takes a capsule.
```

- [ ] **Step 3: Check the rendered markdown**

Run: `grep -n "Semantic Tint Exception\|governs in-content controls" DESIGN.md`
Expected: both clauses found, each under the intended heading. Confirm by eye that list formatting matches its neighbours.

- [ ] **Step 4: Commit**

```bash
git add DESIGN.md
git commit -m "Write down the two rules the app was already breaking"
```

---

### Task 5: `Create an account` becomes a capsule

**Files:**
- Modify: `mobile/src/app/signin.tsx:320-330` (the mode-toggle `Pressable`)

**Interfaces:**
- Consumes: `PillButton` from `@/components/form` — already imported in this file by an earlier change; confirm the import line reads `import { FieldTrough, PillButton, PrimaryButton, TextField } from '@/components/form';` and add `PillButton` if absent.
- Produces: nothing.

- [ ] **Step 1: Replace the sentence with a capsule**

Replace the mode-toggle `Pressable` (the block rendering `{creating ? 'Already have an account? ' : 'New here? '}` and its nested `ThemedText`) with:

```tsx
              {/* **A capsule, because it is an action sitting in content.** It was the second
                  half of a sentence — "New here? Create an account" — and half a sentence cannot
                  be a capsule, so the sentence goes. The nav-bar exemption in DESIGN.md does not
                  reach here: this is not a bar item, it is a control in prose. */}
              <PillButton
                title={creating ? 'Sign in' : 'Create an account'}
                onPress={() => {
                  setCreating((v) => !v);
                  setError(null);
                }}
              />
```

Remove the now-unused `styles.toggle` entry **only if** no other element in the file still uses it — `grep -n "styles.toggle" mobile/src/app/signin.tsx` first.

- [ ] **Step 2: Typecheck and lint**

Run: `cd mobile && npx tsc --noEmit && npx expo lint`
Expected: no errors, and no unused-variable warning for `styles.toggle`.

- [ ] **Step 3: Verify on the simulator, and report honestly**

```bash
xcrun simctl launch 5370BE97-F1D1-419B-A373-488D8B477800 app.tripmate
xcrun simctl openurl 5370BE97-F1D1-419B-A373-488D8B477800 "tripmate://signin"
```

Screenshot and look at the two stacked capsules. **The known risk in this task:** `Create an account` and `Keep planning without an account` now share a shape, and one is a mode toggle while the other is the way out of the screen. If they read as two actions of equal weight, say so in the commit body and in the hand-off — do not declare it fixed and move on.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/app/signin.tsx
git commit -m "Give the mode toggle the shape its rule requires"
```

---

### Task 6: Render the address the app already has

**Files:**
- Modify: `mobile/src/components/day-page.tsx:350-356` (the expanded stop's block)

**Interfaces:**
- Consumes: `Stop.address?: string` — declared at `src/api/types.ts:524` and currently rendered nowhere.
- Produces: nothing.

- [ ] **Step 1: Add the row**

In `mobile/src/components/day-page.tsx`, inside `<View style={styles.expanded}>`, after the `stop.note` block (line 356) and before the located/coordinate comment block:

```tsx
            {/* **The one line a traveller shows to somebody else.** A destination name is enough
                to read and not enough to hand a taxi driver or a hotel desk, which is a thing that
                happens offline and under time pressure. `trim()` rather than a bare truthiness
                check: an empty string is a field that exists and says nothing, and an empty row
                would claim the app knows an address it does not have. */}
            {stop.address?.trim() ? (
              <ThemedText type="detail" themeColor="muted">
                {stop.address}
              </ThemedText>
            ) : null}
```

- [ ] **Step 2: Typecheck and lint**

Run: `cd mobile && npx tsc --noEmit && npx expo lint`
Expected: no errors.

- [ ] **Step 3: Verify both states on the simulator**

Most fixture stops have no `address`, so the absent case is the default — expand any stop and confirm no empty row appears. For the present case, set one, look, then put it back:

```bash
cd /Users/zaidshaikh/GitHub/tripmate/.worktrees/react-native-app
TRIP=8d31a5fd-e012-4f12-8453-9f1a1792d88e   # Lisbon
cp tripmate.db /tmp/tripmate-before-address.db   # insurance; the fixtures are pre-existing

python3 - <<'PY'
import json, sqlite3
TRIP = '8d31a5fd-e012-4f12-8453-9f1a1792d88e'
con = sqlite3.connect('tripmate.db')
raw = con.execute("select itinerary_json from trips where id=?", (TRIP,)).fetchone()[0]
itin = json.loads(raw)
itin['days'][0]['stops'][0]['address'] = 'R. de Sao Tome 23, 1100-563 Lisboa'
con.execute("update trips set itinerary_json=? where id=?", (json.dumps(itin), TRIP))
con.commit()
print('address set on', itin['days'][0]['stops'][0]['name'])
PY
```

Relaunch, open Lisbon, expand the first stop of day 1, confirm the line reads under the note. Then restore — do **not** leave the fixture modified:

```bash
python3 - <<'PY'
import json, sqlite3
TRIP = '8d31a5fd-e012-4f12-8453-9f1a1792d88e'
con = sqlite3.connect('tripmate.db')
itin = json.loads(con.execute("select itinerary_json from trips where id=?", (TRIP,)).fetchone()[0])
itin['days'][0]['stops'][0].pop('address', None)
con.execute("update trips set itinerary_json=? where id=?", (json.dumps(itin), TRIP))
con.commit()
print('restored:', 'address' not in itin['days'][0]['stops'][0])
PY
```

- [ ] **Step 4: Commit**

```bash
git add mobile/src/components/day-page.tsx
git commit -m "Show the address a stop already carries"
```

---

### Task 7: Plan Health leads with the diagnosis

**Files:**
- Modify: `mobile/src/lib/health.ts` (receives `healthSummary`, moved out of the component)
- Modify: `mobile/src/components/plan-health.tsx:34`, `:44-64`, `:134-143`
- Test: `mobile/src/lib/health.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `healthSummary(findings: number, blockers: number, ran: number, of: number): { verdict: string; coverage: string }` exported from `mobile/src/lib/health.ts`. `verdict` is the clause naming what was found (`2 blockers found`, `3 things to look at`, `Nothing flagged`); `coverage` is `4 of 7 checks run`.

The split exists so the component can join them on one line when there are no blockers and stack them when there are, without the phrasing living in two places.

- [ ] **Step 1: Write the failing tests**

Append to `mobile/src/lib/health.test.ts`:

```ts
import { healthSummary } from './health';

describe('healthSummary', () => {
  it('splits the verdict from the coverage', () => {
    expect(healthSummary(4, 2, 4, 7)).toEqual({
      verdict: '2 blockers found',
      coverage: '4 of 7 checks run',
    });
  });

  it('makes one blocker singular', () => {
    expect(healthSummary(1, 1, 4, 7).verdict).toBe('1 blocker found');
  });

  it('calls findings without blockers things to look at', () => {
    expect(healthSummary(3, 0, 7, 7).verdict).toBe('3 things to look at');
  });

  it('says nothing was flagged rather than nothing is wrong', () => {
    expect(healthSummary(0, 0, 7, 7).verdict).toBe('Nothing flagged');
  });
});
```

The second and third cases are Review Focus #4 and #5.

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd mobile && npx jest src/lib/health.test.ts`
Expected: FAIL — `healthSummary` is not exported from `./health`.

- [ ] **Step 3: Move the phrasing into `health.ts`**

Cut the `summary` const from `mobile/src/components/plan-health.tsx:134-143` together with its docblock, and paste it into `mobile/src/lib/health.ts` as an export, returning the two halves:

```ts
/**
 * What the checks turned up, and how much of the plan they covered — as two clauses, not one
 * string.
 *
 * The caller decides whether they sit on one line or stack, because that depends on severity:
 * a blocker outranks the score and leads the card, while a clean result lets the figure lead.
 * Splitting here rather than at the call site keeps one copy of the wording.
 *
 * Coverage prints even at full marks. "7 of 7 checks run" is a fact worth stating, and a line
 * that appears only on bad news teaches a reader to skip it on good news.
 */
export function healthSummary(
  findings: number,
  blockers: number,
  ran: number,
  of: number
): { verdict: string; coverage: string } {
  const coverage = `${ran} of ${of} checks run`;
  // **"found", not a bare count.** "2 blockers" reads as *there are two blockers in this plan*.
  // What is actually known is what the checks that ran turned up — and with three dimensions
  // unmeasured those are different statements. One word is the whole difference.
  if (blockers > 0) {
    return { verdict: `${blockers} blocker${blockers === 1 ? '' : 's'} found`, coverage };
  }
  if (findings > 0) {
    return { verdict: `${findings} thing${findings === 1 ? '' : 's'} to look at`, coverage };
  }
  // Not "nothing wrong": nothing was *flagged*, by the checks that could run.
  return { verdict: 'Nothing flagged', coverage };
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd mobile && npx jest src/lib/health.test.ts`
Expected: PASS, 4 new assertions.

- [ ] **Step 5: Restack the header**

In `mobile/src/components/plan-health.tsx`, add `healthSummary` to the **existing** import from `@/lib/health` — do not add a second import line; read what that file already pulls from there and extend it. Then replace line 34:

```ts
  const { verdict, coverage } = healthSummary(all.length, blockers, ran, health.dimensions.length);
```

Replace the `<View style={styles.grow}>` and `<View style={styles.figure}>` blocks (lines 44-64) with:

```tsx
        {/* **A blocker outranks the score, and the type has to say so.** The figure was the most
            immediate conclusion on a screen whose whole purpose is diagnostic: a reader could
            glance at 84, decide "good enough", and never read the two findings that make the plan
            impossible. Severity leads when there is any; otherwise the figure does, because then
            nothing outranks it. Colour is untouched — the summary already went coral when severe. */}
        <View style={styles.grow}>
          <ThemedText type="label" themeColor="muted">
            Plan health
          </ThemedText>
          {blockers > 0 ? (
            <>
              <ThemedText type="title" themeColor="alert" style={styles.summary}>
                {verdict}
              </ThemedText>
              <ThemedText type="detail" themeColor="muted">
                {coverage}
              </ThemedText>
            </>
          ) : (
            <ThemedText
              type="detail"
              themeColor={severe ? 'alert' : 'muted'}
              style={styles.summary}>
              {`${verdict} · ${coverage}`}
            </ThemedText>
          )}
        </View>
        <View style={styles.figure}>
          <ThemedText type={blockers > 0 ? 'heading' : 'title'}>{health.score}</ThemedText>
          {ran < health.dimensions.length ? (
            <ThemedText type="micro" themeColor="muted">
              across checked
            </ThemedText>
          ) : null}
        </View>
```

Update the `accessibilityLabel` on line 42 so a screen reader hears the same order a sighted reader sees:

```tsx
        accessibilityLabel={
          blockers > 0
            ? `${verdict}. ${coverage}. Plan health ${health.score} out of 100`
            : `Plan health ${health.score} out of 100, ${verdict} · ${coverage}`
        }
```

Leave the comment block above `styles.figure` (the one beginning `**The figure says what it is a figure of.**`) in place — its reasoning about the denominator still holds.

- [ ] **Step 6: Run the whole mobile suite, typecheck and lint**

Run: `cd mobile && npx jest && npx tsc --noEmit && npx expo lint`
Expected: all pass, no unused import left behind in `plan-health.tsx`.

- [ ] **Step 7: Verify both states on the simulator**

Plan Health renders only once the plan is touched or its chat turns have loaded. Open the Lisbon trip, tap `ASK` then `DONE` to load its turns — the card appears with `2 blockers found`. Confirm the verdict leads and `84` has stepped down. For the no-blocker arrangement, the Jaipur trip is the nearest fixture; if it also has blockers, confirm that branch by reading the code rather than claiming a screenshot you do not have.

- [ ] **Step 8: Commit**

```bash
git add mobile/src/lib/health.ts mobile/src/lib/health.test.ts mobile/src/components/plan-health.tsx
git commit -m "Let the blockers outrank the score"
```

---

## Closing out

- [ ] **Full verification across both suites**

```bash
cd mobile && npx jest && npx tsc --noEmit && npx expo lint
cd .. && npm test && npx tsc --noEmit -p tsconfig.json && npm run lint
```

- [ ] **Push**

```bash
git push
```

- [ ] **Note what is now stale.** Tasks 2, 5, 6 and 7 change screens already committed to the design board: `01-home-today`, `11-trip-map`, `15-trip-add-place`, `00-signin`, `13-trip-stop-detail` and `10-plan-health`. Re-shooting is follow-on work, not part of this plan. Record it in the hand-off rather than silently leaving a board that disagrees with the app.
