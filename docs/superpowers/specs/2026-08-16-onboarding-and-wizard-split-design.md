# Onboarding and the durable/per-trip wizard split — design

**Date:** 2026-08-16
**Status:** Approved, not yet implemented
**Depends on:** the traveler profile (`2026-08-16-traveler-profile-design.md`, shipped) —
this reshapes what that feature stores and who owns editing it.

## Problem

Planning a trip takes seven screens before anything is generated. Five of those
screens ask questions whose answers do not change between trips:

| Screen | Fields | Changes per trip? |
|---|---|---|
| basics | destination, dates, budget | yes |
| purpose | occasion | yes |
| group | who's going, explorer style | who's going: yes · style: no |
| profile | energy | no |
| crowds | crowd tolerance, tier + budget | crowds: no · tier: no · budget: yes |
| priorities | interests, starred interests | no |
| pois | specific places to include | yes |

The traveler profile already persists the durable answers and pre-fills them on a
later visit, so a returning traveler is pressing Next through screens the app
already has answers for.

Two smaller problems come with it:

- **Durable traits the wizard cannot sensibly ask.** Dietary needs change food
  stops on every day of every trip, but they are not a per-trip question, so
  there is nowhere to put them.
- **The durable values have no owner.** The wizard is currently their only edit
  surface. Anything the wizard stops asking becomes uneditable.

## Goals

1. Four per-trip screens instead of seven, for a traveler who has a profile.
2. Durable traits — including new ones — have a real home and a real editor.
3. A per-trip override that does not silently rewrite the traveler's defaults.

## Non-goals

- **Accessibility as a distinct trait.** It overlaps `energy`, which already
  derives `walkLegCap`, `minimizeStairs`, `restBreaks`, and
  `preferTransitOverLongWalks` in `src/lib/userAnswers.ts`. Real mobility needs
  are genuinely distinct from low energy and deserve their own design; bolting
  them on here would produce two prompt blocks giving overlapping, possibly
  contradictory mobility instructions. Deferred deliberately, not forgotten.
- **Home city and travel history.** The app books no travel, so home city only
  colors framing; travel history is a lot of UI for a soft signal. Neither earns
  a screen yet.
- **Authentication.** Still deferred — see `FUTURE-INTEGRATION.md`. The
  `owner_id` column already carries the insurance.
- **Shortening the *first* trip.** On a first run there is no profile, so there
  is nothing to skip. The saving lands on trips 2+, by design.

## The split

**Per-trip — the wizard asks these every time:**

| Screen | Fields |
|---|---|
| basics | destination, dates, budget |
| purpose | occasion |
| group | who's going |
| pois | specific places to include |

**Durable — owned by the profile:** explorer style, energy, crowd tolerance,
priorities, starred priorities, tier, dietary needs.

Two placements deserve their reasoning recorded, because both look wrong at a
glance:

- **`group` stays per-trip** even though the profile stores it. Who is travelling
  genuinely changes — solo this time, family next — and getting it wrong plans a
  family itinerary for someone travelling alone. The profile still supplies the
  default; the screen still asks.
- **`tier` becomes durable and leaves the wizard**, despite being coupled to
  budget. `TierPicker` renders three large image cards and would swamp the basics
  screen. The existing budget→tier auto-recommend still runs for anyone with no
  saved tier, so a first-time traveler is unaffected.

## Architecture

### 1. Three surfaces

**The wizard** (`src/app/page.tsx`) renders the four per-trip screens, plus one
collapsed **"Adjust for this trip"** expander on the basics screen. Expanding it
reveals explorer style, energy, crowds, tier, and priorities, pre-filled from the
profile, using the same picker components the profile page uses. Changes apply to
this generation only and are never written back.

**`/profile`** (`src/app/profile/page.tsx`, new) lists the durable traits with the
same pickers, and saves through the existing `PUT /api/profile`. This is where the
durable values are actually owned.

`group` appears here too, under a heading that names what it is — *who you
usually travel with* — even though it is not one of the traits hidden from the
wizard. It is stored in the profile, it seeds the wizard's group screen, and a
traveler who wants to change that default needs somewhere to do it now that the
wizard no longer writes back. It is the one field that is both remembered and
asked every time, and the page should say so rather than leave a traveler
wondering why changing it here did not stop the wizard asking.

**The onboarding prompt** is not a separate flow with its own screens. It is a
dismissible card on the result screen, shown once, after the traveler has seen a
real itinerary and therefore knows whether the app is worth configuring. It is
pre-filled with the answers they just gave and adds the one question the wizard
never asks (dietary needs). Saving is one click; dismissing costs nothing and
leaves today's behavior intact.

This ordering is deliberate. Putting onboarding *before* the first trip would move
friction to the moment a traveler has seen no value, and would not shorten
anything — there is no profile to skip screens from on a first run either way.

### 2. Automatic profile write-back is removed

`generate()` currently writes the whole durable set back after every successful
generation. This design removes that. Durable values are written only from
`/profile` and from the onboarding card — explicit saves.

This is the change that makes the per-trip expander safe: an override for one trip
must not silently become the permanent default. It also removes a bug class this
codebase has already hit twice — a seeded `tier` being clobbered by the
auto-recommend effect, and before that the profile being written from a wizard the
traveler may have been experimenting in.

The cost is that a traveler who dismisses onboarding forever never builds a
profile and keeps seeing the longer wizard. That is the correct trade: it is their
choice, and the onboarding card states the benefit plainly ("answer once, skip
three screens next time").

### 3. Data model

`TravelerProfile` in `src/lib/travelerProfile.ts` gains one field:

```ts
export interface DietaryNeeds {
  /** Fixed chips the traveler selected. Empty is normal and means "no restrictions". */
  tags: string[];
  /** Anything the chips don't cover. Empty string when unused. */
  note: string;
}
```

added as `dietary: DietaryNeeds`.

`parseProfile` validates it: `tags` must be an array of strings, `note` a string.
A missing `dietary` on an existing stored row parses to `{ tags: [], note: "" }`
rather than failing, so profiles saved before this change keep working — there is
no migration and no version field.

**A gap this does not close:** `tags` and `note` are checked for shape, not
content or length. An unbounded string still reaches storage and the prompt. This
is the same pre-existing gap `priorities` and `preferences.tags` already have,
and closing it belongs in one change across all of them rather than here.

### 4. Prompt wiring

Dietary needs are a profile value, not a derived flag, so they do not belong in
`ResolvedFlags` or `formatTravelerProfile`. A new `src/lib/dietaryPrompt.ts`
exports:

```ts
export function formatDietary(dietary: DietaryNeeds | null): string;
```

returning `""` when there is nothing to say, so a request without dietary needs
produces a byte-identical prompt to today's. Every import in that module is
`import type`, so it stays loadable by a `.test.mjs` — the same constraint that
governs `travelerProfilePrompt.ts`.

The block hangs off the existing `FOOD_STOP_INSTRUCTION` in
`src/lib/itineraryPrompt.ts`, since that is where the model is already told how to
choose food stops. It is threaded into `buildGeneratePrompt`, `buildRefinePrompt`,
and `buildCritiquePrompt` as an optional parameter, matching how `resolvedFlags`
was threaded.

The client sends `dietary` in the request body alongside `userAnswers`; the route
passes it through. The route does not read the profile from the database itself —
keeping every prompt input an explicit request field matches the existing pattern
and keeps the prompt builders pure.

### 5. Build order is a correctness constraint, not a preference

`/profile` and the `dietary` field must ship **before** the wizard drops its
durable screens. Removing those screens removes the only editor those values have;
doing it first would create a state where a traveler can hold a value they cannot
change. The implementation plan must sequence it that way, and each step should
leave the app working:

1. `dietary` on the profile model, validated and tested — nothing consumes it yet.
2. `formatDietary` and its prompt wiring — inert while no profile has dietary needs.
3. `/profile` — the editor exists; the wizard is still seven screens and still
   writes back.
4. Remove the automatic write-back — `/profile` is now the only writer.
5. Recompose the wizard to four screens plus the expander.
6. The onboarding card.

## Data flow

```
/profile page ──save──▶ PUT /api/profile ──▶ traveler_profile row
onboarding card ──save──▶ PUT /api/profile ──▶ traveler_profile row
                                                      │
                                        GET /api/profile on mount
                                                      ▼
                              wizard defaults (group) + expander pre-fill
                                        + dietary, carried as-is
                                                      │
                                     POST /api/itinerary
                                                      ▼
                          deriveFlags(userAnswers) ──▶ formatTravelerProfile()
                                        dietary ──▶ formatDietary()
                                                      ▼
                                  generate / refine / critique prompts
```

The wizard never writes to the profile. That is the whole point of the arrows
running one way.

## Failure handling

Matching the fail-soft convention: external and optional data degrades, it does
not throw.

| Failure | Behaviour |
|---|---|
| No profile row | Wizard shows all four per-trip screens with built-in defaults in the expander; onboarding card appears after the first trip |
| `GET /api/profile` fails | Same as no profile row — the wizard renders normally |
| Stored profile has no `dietary` (saved before this change) | Parses to `{ tags: [], note: "" }`; prompt unchanged |
| `PUT /api/profile` fails from `/profile` | Surfaced to the traveler — this one is an explicit save and silence would be a lie |
| `PUT /api/profile` fails from the onboarding card | Swallowed and logged. It fires right after a two-minute generation and must not turn a successful trip into an error |
| `dietary` absent from the request | `formatDietary` returns `""`; prompt byte-identical to today's |

The split on `PUT` failure is deliberate: a form whose whole purpose is saving
must report a failed save, while an opportunistic post-generation offer must not.

## Verification

Per `CLAUDE.md`, typecheck alone does not count.

1. **`npm test`** — new `src/lib/dietaryPrompt.test.mjs` and additions to
   `src/lib/travelerProfile.test.mjs`, both `node:test`, no framework:
   - `formatDietary(null)` and an empty `{ tags: [], note: "" }` both return `""`
   - tags alone, note alone, and both together each render
   - `parseProfile` accepts a profile with `dietary`
   - `parseProfile` defaults a profile saved without `dietary` to `{ tags: [], note: "" }`
   - `parseProfile` rejects a `dietary` whose `tags` is not a string array
2. **`npx tsc --noEmit -p tsconfig.json`** and **`npm run lint`** (no new errors;
   two pre-existing ones in `layout.tsx` and `Navbar.tsx` predate this work)
3. **Live route check** — save a profile with `vegetarian`, generate, and read the
   `generate` trace via `GET /api/llm-traces/runs/<runId>` to confirm the dietary
   block is present in the prompt actually sent. Then generate with no dietary
   needs and confirm the prompt has no such block.
4. **Live browser check** (controller, not a subagent — no subagent has browser
   access):
   - a traveler with a saved profile sees four screens, not seven
   - the expander opens pre-filled and its changes affect the generated trip
   - an expander change does **not** alter the stored profile — confirmed by
     re-opening `/profile` after generating
   - the onboarding card appears after a first trip and not after later ones
   - `/profile` round-trips every trait

Item 3 of the browser list is the one that matters most: it is the guarantee the
whole write-back removal exists to provide.

## Documentation to update

- `docs/frontend.md` — rows for the four-screen wizard, the expander, `/profile`,
  and the onboarding card.
- `docs/backend.md` — a row for the `dietary` field on the profile.
- `docs/llm.md` — a row for `formatDietary` reaching the three prompt builders.
- `docs/project-crux.md` — a timeline row.
- The traveler-profile spec (`2026-08-16-traveler-profile-design.md`) states that
  the wizard is the editor and that the profile is written after a successful
  generate. Both stop being true here. Add a note at its head pointing to this
  spec rather than editing its body — it is an accurate record of what shipped
  then.
- `AGENTS.md` is rewritten by `next dev`; commit it with the work.

## The expander must not be able to make things worse

An earlier draft of this spec left an open risk: if travelers routinely open the
expander because their trips vary more than the durable/per-trip guess assumes,
the wizard has not gotten shorter — it has gotten shorter *and* added a click.
"Watch it and promote whichever field gets adjusted most" is not a remedy; it
defers the problem and leaves the design resting on a guess about other people's
travel habits.

The risk is dissolved instead, by counting the actual interaction cost:

| | Advance clicks | Field decisions |
|---|---|---|
| Today | 6 | all of them |
| Expander closed | 3 | only the per-trip ones |
| Expander open | 3 + 1 to expand | all of them |

The worst case is four clicks against today's six. There is no case where this is
worse than what it replaces, so there is nothing to watch and nothing to promote
later.

That guarantee holds **only if the expander is one block revealing every durable
field at once.** If it were a nested mini-wizard, or one expander per field, the
worst case would climb back above six and the risk would return. This is a
structural requirement, not a styling preference:

- **One expander, not five.** It reveals explorer style, energy, crowds, tier and
  priorities together, in one scrollable block.
- **No pagination inside it.** No steps, no Next, no sub-navigation.
- **It is the only expander in the wizard.** Any future durable field goes inside
  this same block.

The second half of the problem is discoverability. A traveler who cannot see the
expander has no way to know the app is applying remembered preferences, and a
hidden control reads as the app having forgotten them. So the collapsed state is
not a bare "Adjust for this trip" link — it is a **one-line summary of the values
actually in effect**, with the toggle inline:

```
Relaxed pace · Low energy · Avoids crowds · Mid-range · Food, Culture & History     Adjust
```

That line costs one row when unused, states plainly what is being applied without
requiring a click, and turns the expander from a hidden control into the
explanation of a visible one.
