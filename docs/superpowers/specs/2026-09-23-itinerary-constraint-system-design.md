# Making the itinerary constraint system hierarchical and mechanically verifiable

**Date:** 2026-09-23
**Author:** Zaid (direction), Claude (drafting)
**Status:** Approved design, not yet implemented

## Context

An external review of `.claude/skills/itinerary-planner/SKILL.md` graded the planning rules at
"75-85% of the constraints a serious itinerary generator wants" and listed fifteen targeted
additions plus a deterministic post-generation validator. Read against the repository rather than
against the skill file alone, three things about that verdict change.

**The validator architecture it recommends is mostly built.** The reviewer saw one markdown file.
The repo already runs `guardrails.ts` (travel feasibility, time overlap, pace, budget) on every
drag and edit, `placeConflicts.ts` (closed-on-date, crowd timing, step-free, book-ahead, pinned
admission costs) server-side during generation, real OSRM door-to-door minutes feeding the
guardrail arithmetic at `generationRunner.ts:565`, `placeStops()` correcting the model's invented
coordinates against OSM, and an LLM critique pass handed all of those findings as fact. The
"two-pass generation architecture" diagram in the verdict is approximately shipped. What is missing
from it is narrow: duplicate detection, must-include and exclusion checks, a departure boundary,
and per-person budget arithmetic.

**`SKILL.md` is not on the path travellers use.** It is loaded by `/api/trip-edit` and by
`generateItinerary()` (the staged pipeline and the benchmark). The plan a visitor actually sees
comes from `/api/itinerary`, whose rules live in `itineraryPrompt.ts`, `travelerProfilePrompt.ts`
and `lodgingPrompt.ts`. Both changes the reviewer called P0 exist in two or three places each:

- "85-100% of the budget" — `lodgingPrompt.ts:35`, `SKILL.md` §5, the critique checklist at
  `itineraryPrompt.ts:351`, and `BUDGET_TARGET_FLOOR` in `bench/scorers/context.ts:219`.
- "90 minutes before departure" — `travelerProfilePrompt.ts:118` and `SKILL.md` §4c-bis.

Editing only the skill would change nothing a traveller sees.

**A third of the list is not a prompt change.** Must-include and exclusion lists, transport
availability, budget basis, and fixed commitments beyond lodging/arrival/departure are data the
wizard does not collect. `## Fixed commitments` in `tripContext.ts:94` carries exactly three
fields. Rules written about data that never arrives are dead prose.

**Intended outcome:** the remaining constraints made explicitly hierarchical and, where they are
decidable from data, mechanically checked — with a measured before/after rather than an assertion
that it improved.

## Why this is four phases and not one change

| Phase | What | Where it lands |
|---|---|---|
| **A** | Eleven prompt rules that need no new traveller input | `SKILL.md`, `lodgingPrompt.ts`, `travelerProfilePrompt.ts`, `itineraryPrompt.ts`, `editPrompt.ts` |
| **B** | Four deterministic checks | `guardrails.ts`, fed to critique by `generationRunner.ts` |
| **C** | Three new traveller inputs | `types.ts`, both wizards, `tripContext.ts`, `travelerProfilePrompt.ts` |
| **D** | The A/B measurement | `scripts/skill-ab.mjs`, four new scorers, one new fixture |

They share one spec because they share the measurement harness, and they are strictly ordered by
it: **Phase D's baseline capture runs before Phase A's first edit.**

## The measurement, and why it comes first

An A/B of prompt text has one failure mode that matters: grading your own homework. Four defences,
all structural.

**The baseline is captured before any change exists.** `scripts/skill-ab.mjs --arm baseline.json`
runs against today's code and stores, per fixture, only the raw output:

```json
{ "fixtureId": "...", "itineraryMd": "...", "runId": "...", "wallMs": 0, "costUsd": 0 }
```

No scores. There is no "v1 code path" kept alive to rot, because arm 1 genuinely ran on the old
prompts.

**Both arms are scored by one copy of the scorer code, at compare time.**
`skill-ab.mjs --compare baseline.json candidate.json` re-scores each stored output with the
harness's own entry points — `scoreItinerary(fixture, markdown, operational)` for a staged arm,
`scoreParsed(fixture, itineraryToParsed(json), ...)` for a legacy one, since that path returns JSON
rather than markdown. A scorer written during Phase D therefore grades both arms identically. This
mirrors what `updateBenchResultScores` already does for stored bench rows.

**The composite is frozen.** `COMPOSITE_WEIGHTS` is not touched. New scorers are reported in a
separate table, unweighted. If the composite drops, that is a real regression with nowhere to hide.

**A blinded judge is the tiebreak.** `judgeFixture(fixture, candidates)` already strips model and
vendor identity, seed-shuffles presentation order per fixture, and scores all candidates for a trip
in one call. Passing two arms instead of two models needs no change to it. Its own docstring's
caveat stands and will be repeated in the results: a Claude model scoring Claude output is a soft
preference signal, not ground truth.

### Arms

Default arm drives `generateItinerary()` — the staged pipeline, one LLM call, `SKILL.md` plus
`trip-context.md` plus the fixed ask, no critique and no guardrail repair. Every delta is
attributable to prompt text rather than to a downstream pass.

`AB_PATH=legacy` drives `POST /api/itinerary` over HTTP, reusing the request body builder in
`scripts/critique-ab.mjs`, for one fixture per arm. This is a direction check on the path travellers
actually use, not a second full measurement — the legacy path includes critique, so its deltas are
noisier and n=1.

Going over HTTP for the legacy arm is not a style choice: `generationRunner.ts` pulls
`CritiqueResult` into a value import block, so the module cannot be instantiated from a `.mjs`
script at all. `scripts/perf-bench.mjs` and `scripts/critique-ab.mjs` both route around it the same
way.

### Fixtures, and what the A/B cannot see

The seven built-in fixtures stay unchanged and carry the A/B. They predate Phase C's fields, so both
arms see them empty — which makes the comparison clean for Phases A and B and **structurally unable
to measure Phase C**. A new eighth fixture carrying `mustInclude`, `avoid` and a `constraintsNote`
is added and measured single-arm against the new scorers: the question there is "does the field do
anything", not "is v2 better than v1", and the results must say so.

Cost per arm: 7 generations at roughly 90s, plus 7 judge calls at compare time. Free on the default
CLI transport.

## Phase A — eleven rules

| Rule | `SKILL.md` | Legacy path |
|---|---|---|
| Constraint precedence | new §0 | `itineraryPrompt.ts` prompt header |
| Budget is a ceiling | §5 rewritten | `lodgingPrompt.ts:35`, critique checklist `:351` |
| Transfer time vs. airport processing | §4c-bis | `travelerProfilePrompt.ts:118` |
| Fixed commitments, generalised | §4e extended | `travelerProfilePrompt.ts` |
| Duplicate prevention | new §14e | critique checklist |
| Minimal-change editing | §12 sub-rule | `editPrompt.ts` |
| Whole-trip audit | new §15 | critique checklist |
| Availability is not existence | §14c generalised | — |
| Uncertainty propagation | §13 extended | — |
| Local-time semantics | §10 extended | — |
| Intentional free time | §9 ↔ §14b reconciled | — |

### §0 Constraint precedence

Eight ranks, stated once near the top of the skill and referenced rather than restated by the
sections below: fixed commitments and immutable facts; safety and accessibility; physical and
temporal feasibility; explicit traveller requirements and exclusions; traveller profile; primary
interests; secondary interests and vibe; variety and optimisation. A lower rank never silently
overrides a higher one, and two unsatisfiable hard constraints preserve the higher and surface the
conflict.

The sections that already state a local precedence — §3d (dietary outranks priority), §9e
(accessibility outranks energy, pace and priority), §9a (a starred priority outranks a tie-breaker)
— keep their wording. They are instances of §0, not competitors to it, and deleting them to avoid
duplication would move a hard constraint further from the rule it governs.

### §5 Budget, rewritten

The stated budget becomes a ceiling. A strong plan does not need to spend it. Prefer value and fit;
leave roughly 10-15% for unplanned transport, tips, taxes and price variation where practical; let
the tier (§6) set the register. Premium upgrades only when the traveller asked to use the full
budget or to make it luxurious. Never add an experience primarily because money remains.

This section gets **shorter**. The "add premium extras appropriate to the tier (private guides,
exclusive experiences, shopping, spa, upgraded transport)" instruction is deleted rather than
qualified — it is the mechanism the reviewer identified as manufacturing bad recommendations.

`budgetInstruction()` in `lodgingPrompt.ts` is the single shared string for both legacy prompts and
is rewritten to match, so the two paths cannot drift.

### §4c-bis transfer and processing buffers

Two buffers, named separately, because collapsing them is the defect:

1. travel time from the last location to the airport, plus
2. an airport-arrival buffer before scheduled departure — roughly 2 hours domestic, 3 hours
   international, as defaults rather than claims about a specific airport, overridden by anything
   the trip context supplies.

Trains keep a much smaller default. The arrival side is unchanged: about 90 minutes after landing
for immigration, bags and the transfer in.

### Editing stability (§12 sub-rule and `editPrompt.ts`)

Change the smallest set of stops that satisfies the request; preserve fixed commitments and stops
the traveller did not mention; revalidate travel time immediately before and after the edited stop;
adjust downstream times only where feasibility requires it; never rewrite an unrelated day, change
lodging, or restyle an accepted recommendation. Where a cascade is forced, make the minimum one and
say which items moved.

`editPrompt.ts` currently carries in-flight work rewriting the ops and index rules — `applyPatch`
now resolves every `stopIndex` against the plan as shown, and the prompt was updated to match. The
minimal-change rule is added on top of that wording, not in place of it, and the new instruction
"if a request asks for several changes at once, do ALL of them in this one turn" is left intact:
doing every requested change and changing nothing else are the same principle from two directions.

### Size

The reviewer's warning that 482 lines is near the point of diminishing returns is taken. §5 shrinks,
§14c folds into the availability rule, and §9's "a day that ends at 1pm is two thirds missing" is
**rewritten** to say that a relaxed day must still account for its hours while accounted-for time
may be deliberate resort, beach, pool or wandering time — rather than left standing with a
contradicting rule added elsewhere. Target: under 560 lines.

## Phase B — four checks as optional guardrail rules

`guardrails.ts` already takes `options.budget` and no-ops without it. The same shape extends:

```ts
evaluateItinerary(itinerary, {
  budget, modes, realMinutes,
  logistics?, mustInclude?, avoid?, partySize?,   // new, every one optional
})
```

New `GuardrailRule` members: `"duplicate" | "commitment" | "required" | "party-budget"`.

- **duplicate** — the same stop on more than one day, matched on `normalizeStopName` (already
  exported by `placeConflicts.ts`) or on coordinates within ~150m. Lodging is exempt; so is a stop
  whose repeat the traveller asked for. Needs no options, so the four existing UI callers gain it
  without changing a line.
- **commitment** — booked lodging used every night at cost 0; nothing scheduled before
  `arrivalTime + 90min`; nothing ending after `departureTime − 120min − transfer`. 120 is the
  checkable floor, not a claim the flight is domestic: `departurePoint` is free text and cannot tell
  us, and a plan obeying the 3-hour rule passes a 2-hour check.
- **required** — every `mustInclude` term present exactly once; no `avoid` term present. Null, not
  zero, when the traveller stated neither.
- **party-budget** — per-person stop costs multiplied to party cost before the total is compared,
  and anything already paid (booked lodging) excluded rather than charged twice.

`generationRunner.ts` passes all four and appends their messages to the existing `travelFindings`
channel, which already carries deterministic findings into the critique prompt as fact. No new
plumbing between the validator and the repair pass — that seam exists.

`guardrails.ts` stays pure, synchronous and importable from the client graph. Every new option is
absent from every current caller, so today's behaviour is byte-identical apart from duplicate
detection.

## Phase C — two chip fields and a textarea

```ts
// UserAnswers, all optional: absent means not asked, matching logistics/dietary/accessibility
mustInclude?: string[];
avoid?: string[];
/** Anything already booked, off-limits or constraining that the fields above don't cover —
 *  transport availability, reservations, budget basis. Passed verbatim; never parsed. */
constraintsNote?: string;
```

Structured for the two the validator needs — `required` cannot match against a prose blob — and free
text for the rest, because transport availability, budget basis and arbitrary commitments would cost
four new wizard sections across two apps to make machine-readable, and the model handles them as
prose.

Surfaces: `types.ts` → web wizard → `mobile/src/app/plan/preferences.tsx` and
`mobile/src/lib/planDraft.tsx` → `tripContext.ts` (a new `## Must include / Avoid` section; the note
appended verbatim under `## Fixed commitments`) → `travelerProfilePrompt.ts` for the legacy path →
`SKILL.md` for how to read them.

The skill's reading rules: a must-include is a hard trip-level requirement short of physical
impossibility and appears exactly once; an avoid item is a hard negative constraint; interests and
starred priorities are preferences and never substitute for either. The verbatim note is
traveller-stated fact and outranks anything the model would have chosen, but it is prose — nothing
downstream may treat an absence in it as a denial.

## Phase D — four scorers, composite untouched

New, unweighted, reported in their own table beside the composite:

- **duplicates** — repeat rate across the trip; `1 − rate`.
- **commitments** — the Phase B commitment checks, as a pass fraction.
- **mustInclude** — must-includes present, exclusions absent. Null when the fixture states neither,
  which is all seven built-ins.
- **budgetCeiling** — 1.0 at or under budget, `budget/total` above it. `budgetUsedFraction` stays
  reported as information and stops being scored.

Two deliberate decisions about existing code:

**`scoreAgainstBand` is fixed.** It currently penalises underspend against `BUDGET_TARGET_FLOOR =
0.85`, so a plan that correctly stops at 65% of budget scores 0.76. That is wrong against the rule
Phase A adopts. Both arms are re-scored by the same code at compare time, so this cannot bias the
comparison, and budget is not in the composite, so historical composites in
`docs/itinerary-quality.md` stay comparable.

**`usableSlot`'s `TRANSFER_BUFFER_MIN` stays at 90.** It feeds coverage, which *is* in the composite;
raising it for the departure side would shift both arms and break comparability with every prior run,
to answer a question the new `commitments` scorer answers better. The constant's docstring gains a
line saying why it no longer matches the prompt's departure default.

## Testing

`npm test` gains a `.test.mjs` beside each new pure module, matching the existing 17 files: duplicate
matching (including the chain-name near-duplicate case), the commitment checks against arrival and
departure boundaries, must-include and exclusion matching, and the rewritten budget band. Plus
`npx tsc --noEmit`, `eslint`, and exercising `/api/itinerary` and `/api/trip-generate` against a
running dev server with `curl` — a passing suite here proves less than in a normally covered repo,
and the skill and prompt changes are not covered by any test at all.

The A/B run is the acceptance gate: composite must not regress, and the four new axes must move in
the direction the rules intend.

## What this deliberately does not do

- **No destination-specific rules.** No "when in Paris", no "in Italy dinner happens at". Those
  belong in retrieved destination context, which `destinationContext.ts` already supplies. The
  separation the skill maintains — context provides facts, the skill governs reasoning about facts
  — is preserved.
- **No fact-confidence enum.** The reviewer's `fact_status: verified | model_known | unverified`
  schema is not adopted. `placeFacts.ts` already distinguishes looked-up from absent, `poiLine()`
  already marks estimates inline ("hours unknown — verify before visiting", "~90 min (est)"), and
  `placeStops()` already replaces model coordinates with OSM ones. The uncertainty-propagation rule
  in §13 carries the reviewer's actual point — a conclusion cannot be more certain than its inputs —
  without a schema the pipeline would have to populate everywhere.
- **No migration of `/api/itinerary` to the staged pipeline.** That is blocked on a markdown-to-JSON
  contract, documented in CLAUDE.md, and is not in scope. Both paths get the rule changes.
- **No reweighting of the composite.** Discussed and rejected: it would let a new-rule win mask a
  route-quality loss and break comparability with every number already recorded.

## Documentation

`docs/itinerary-quality.md` gains the A/B results table with the n and the judge caveat stated
inline. `docs/llm.md` gains rows for the new guardrail rules and the new scorers under the
Developer column convention in `docs/project-crux.md`. `guardrails.ts`'s own header docstring —
"Keep this file and SKILL.md §12 in step; if a threshold moves in one, move it in the other" — is
extended to name the four new rules and the prompt surfaces each mirrors, since the rules now live
in five files rather than two.
