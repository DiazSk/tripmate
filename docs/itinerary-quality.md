# Itinerary quality — audit and remediation

A rubric audit of what the generated itinerary actually accounts for, and the work done against
it. Distinct from the other trackers: `llm.md` records *how* the model is called, this records
*whether the plan it produces is any good*, which is a different question with a different
failure mode — nothing errors, the trip is just worse than it should be.

The rubric is 29 criteria across seven groups: timing/pacing, route/transit, food/dining, venue
feasibility, personalization, budget/logistics, and accessibility/safety.

## Audit baseline — 2026-08-18

Measured against the assets as they stood, using the 23 persisted artifacts in `trip_artifacts`
and 374 rows of `llm_traces` as evidence of what actually reached output (rather than what the
skill merely instructed).

| Group | Handled | Partial | Missing |
|---|---|---|---|
| Timing & pacing | 1 | 4 | 0 |
| Route, location & transit | 0 | 2 | 3 |
| Food & dining | 1 | 2 | 2 |
| Venue constraints & feasibility | 1 | 3 | 0 |
| Personalization & vibe | 0 | 2 | 2 |
| Budget & logistics | 0 | 1 | 2 |
| Accessibility, comfort & safety | 0 | 1 | 2 |
| **Total** | **3** | **15** | **11** |

Two findings shaped everything after it:

1. **The skill on disk was not the skill that produced the samples.** No trace in the DB
   contained the then-current skill's §11 text. Every sample came from a richer, never-committed
   body (~18.5 KB) recoverable only from `llm_traces.prompt`. Rules it had and the disk copy did
   not: geographic clustering, per-leg transport, the night-to-morning lodging hand-off, luggage
   and checkout handling, booked-lodging/flight boundaries, and rest-break cadence.
2. **Coverage was strongest exactly where a real fetch exists.** Daylight, opening hours, closed
   days and weather each have a source, a degradation flag, a rule, and visible effect in output.
   Everything with no data behind it scored Partial at best — which is why several gaps could not
   be closed by writing rules.

## Work done — 2026-08-19 (Claude)

### Skill rules

| Section | What | Why |
|---|---|---|
| §3c | Cluster days by proximity; one route per day; the leg from the previous stop rides in each stop's note | Recovered from the lost body. The context digest was already built for clustering (`MAX_LEGS_LISTED` → nearest-neighbours) with no rule consuming it |
| §3d | Dietary needs as a hard constraint on stop *selection* | The pipeline was dietary-blind; see below |
| §4d | Base central to the day's cluster; start each day from last night's door; a base move is its own stop; last day plans around checkout and bags | Recovered. A sample contradicted itself across two days with no rule to catch it |
| §4c-bis | Booked lodging is the base for every night it covers; arrival/departure times bound the first and last day, with ~90 min for the transfer either side | Recovered. Landed as §4c-bis rather than §4e: the two branches wrote this rule independently and §4c-bis is the one that survived the merge. **Its "cost 0" clause did not.** §5 states the budget covers lodging + stops and must reach 85–100% of the stated total, so zeroing a booked stay would have left the model spending the whole budget on everything else — a $900 hotel inside a $2,400 budget overshoots by 37%. A booked stay counts at its real cost; `actualCost` on the lodging entry is where "already paid" belongs |
| §9a–§9d | Style as tie-breaker not stop count; energy ladder; rest break as its own entry; solo/couple logic; flags shape the plan but are never mentioned in it | Recovered. `explorer_style` had collapsed to a number, and solo/couple derived nothing |
| §9e | Accessibility is stated, not inferred; `wheelchair` values govern selection | New capability, see below |
| §13 | Degrade, don't fail: default, say so in the note, never fabricate the missing fact | Recovered |
| §14a–§14d | Vary the kind of stop; open time must look deliberate; flag what needs booking ahead; name the costs a budget forgets | New. A sample ran five straight hours of shopping and left an unexplained 4.5-hour hole |

### Data reaching the model

| Change | Why |
|---|---|
| `dietary` on `UserAnswers`, emitted as its own context section | It was collected, stored, validated and unit-tested, used by the legacy prompt, and silently dropped by the staged pipeline. `dietaryPrompt.ts` calls this the worst failure the feature can have |
| `logistics` (`arrivalTime`/`departureTime`/`stayBooked`) on `UserAnswers` | Fed §4c-bis, which had no input. **`src/lib/bench/customTrip.ts` had been assigning this exact shape to a field `UserAnswers` never declared — a latent type error at HEAD**, so the names were adopted rather than reinvented, and `BenchLogistics` is now a re-export |
| `accessibility` (`stepFreeRequired`/`limitStairs`/`note`), asked in the existing "Adjust for this trip" expander | `deriveMobilityProfile` inferred mobility from `energy` alone, so a wheelchair user reporting high energy got no accommodation. Stated needs now tighten the profile and can never loosen it |
| OSM `wheelchair` read in `fetchPoiOsmTags` and carried to `EnrichedPoi` | The tag was already in the Overpass response and being discarded, which left `minimize_stairs` a rule with no fact to act on |
| `destinationContext` (festivals/safety/shopping) routed into `trip-context.md` | Reaches the legacy prompt only. The skill's destination-context branch could never fire in the staged path. Reuses the existing cached call — no new model spend |
| `visitDuration` widened; longest match wins | `historic` matched nearly every cultural site at 20 min, and the plan scheduled exactly 20 minutes for Nijo Castle |

### The format contract

The skill specified §11; the benchmark parser required the old §6 (`**Morning**` blocks, a
`Stay near:` line). Nothing bridged them, so `format_adherence` scored near zero regardless of
model, and no cost could be read at all — which is why §5's 85-100% budget rule had gone
unmeasured. `parseItinerary.ts` now reads §11, keeping every export's shape so the scorers were
mostly unaffected. Slots are **derived from each stop's start time** rather than read from a
heading.

Two consequences worth knowing:

- `scoreBudget` prefers the model's stated costs and falls back to the estimate table, reporting
  which basis it used. It now penalises **underspend** too — §5 treats an unspent budget as a
  planning failure, and the estimate-only scorer called that a perfect 1.0.
- The daylight check's exemption was `slot === "Evening"`. With slots derived from the clock, any
  after-dark stop is Evening by definition, so the rule could never fire. It now exempts by the
  *kind* of stop (§10's actual wording) and applies by default — an unrecognised stop is checked
  rather than skipped, because for a scorer under-measuring is the worse error.

### Model

`MODEL` moved off `claude-haiku-4-5-20251001`. The benchmark's own first sweep scored Haiku 4.5 at
0.842 composite against Sonnet 4.5's 0.959 and Opus 4.5's 0.952 — the Sonnet/Opus gap is noise at 3
runs on one fixture, the Haiku gap is not. This is one call that produces the whole product, so the
tier matters more than the per-token rate.

**Corrected 2026-08-22:** this section used to say the move was to `claude-sonnet-5` and that bench
defaults were Sonnet 5 / Haiku 4.5 / Opus 5. Production is and was `claude-sonnet-4-5`
(`src/lib/claude.ts:29`) — the Sonnet 5 move was reverted (see that file's own docblock: 164s to
first token, and two timeouts at 216s on a 3-day trip) and this section was never updated. The
"Refine path" sweep below flagged the contradiction at the time without fixing it; it is fixed now
rather than left for a third reader to re-discover.

### Fixtures

Added `barcelona-access-dietary` — the only fixture stating dietary needs, a step-free
requirement, and booked logistics, with OSM `wheelchair` tags on its candidates. Its `energy` is
deliberately `high` so that a step-free requirement overriding it is what's being tested. The set
was already 6 trips covering group types, the pace range and every degraded path; the real gap was
that the one recorded sweep ran a single fixture, not that fixtures were missing.

## Refine path — first sweep (2026-08-22)

Extends the benchmark from whole-itinerary generation to the "Refine with AI" chat path (spec:
`docs/superpowers/specs/2026-08-21-refine-bench-design.md`, plan:
`docs/superpowers/plans/2026-08-21-refine-bench.md`). The question: does Haiku 4.5 degrade a
refine patch compared with Sonnet 4.5, and by how much — the same downgrade question the
generation sweep above already asked, on a narrower task.

**Scope actually run: Sonnet 4.5 vs Haiku 4.5, 7 fixtures × 3 tasks, 42/42 cells.** The original
plan included Opus 4.5 (63 cells); it was dropped mid-sweep when real per-call cost turned out far
higher than estimated and a usage-limit spike made the full 3-model matrix unaffordable in one
pass. 10 Opus rows are banked in `bench_results` (only 6 of them scored) but excluded below — Opus was never the open
question. One Haiku cell failed on a transient malformed-JSON response and succeeded on a single
retry; every other cell succeeded on its first attempt, with no throttling in `llm_traces`.

**The current production model is `claude-sonnet-4-5`** (`src/lib/claude.ts:29`). The "Model"
section above used to claim Sonnet 5; that has since been corrected in place — see the note there.
This sweep compares against the model actually running in production.

| | Sonnet 4.5 | Haiku 4.5 |
|---|---|---|
| composite avg (min) | 0.970 (0.750) | 0.940 (0.750) |
| ops emitted / **rejected** | 59 / **0** | 49 / **0** |
| restraint held (ask-day1-packed) | 7/7 | 7/7 |
| guardrailDelta avg | **−0.33** (net improved) | **+0.05** (net slightly worse) |
| cells introducing a new guardrail issue | 3/21 | 4/21 |
| delta.weatherFeasibility avg | +0.0000 | **−0.0198** |
| avg latency | 101s | 101s |
| avg cost/cell | $0.235 | $0.107 |

**Zero rejected ops for either model — the generation-path failure mode does not reproduce here.**
The 0.842-vs-0.959 gap that drove the earlier model choice was measured on whole-itinerary
generation and is attributed to index/coordinate hallucination over a much larger, unconstrained
output. Refine is a scope-locked patch against an explicit target with the current itinerary
compacted into the prompt; neither model in this sweep hallucinated a day or stop index once
across 108 combined ops. The mechanism the earlier sweep flagged appears to be specific to
open-ended generation, not this task shape.

**Restraint is not where Haiku loses ground.** Both models correctly emitted zero ops on every
`ask-day1-packed` ("is day 1 too packed?") task — the failure mode the design doc predicted a
weaker model would hit first did not appear at this sample size.

**Where they actually differ:** Sonnet's edits net *fixed* guardrail problems on average; Haiku's
net *added* slightly more than they resolved. The count of cells introducing a new problem is
close (3 vs 4 of 21), so the composite gap is small — but Haiku's fixes were smaller when it did
fix something. The one measured axis with a real gap is weather-appropriateness of the edit
(`delta.weatherFeasibility`): Haiku's retimed/added stops came out worse against the day's weather
noticeably more often than Sonnet's. At n=21 this is suggestive, not conclusive — worth a wider
sweep (more fixtures, and a task that specifically stresses weather) before treating it as settled.

**Cost, not latency, is the real lever.** Haiku is ~2.2× cheaper per call, but the two models'
average latency is identical to the second (101s vs 101s) — a model swap to Haiku would not make
"Refine with AI" feel faster. That matters because latency was the original complaint that started
this whole investigation: the fix for a slow-feeling refine chat is not this model swap. It would,
however, meaningfully cut the cost of every refine turn for a small, currently-unquantified quality
cost concentrated in weather-appropriateness rather than in correctness or restraint.

**Recommendation:** Haiku 4.5 is a plausible cost optimization for the refine path — no rejected
ops, restraint intact, a 3-point composite gap — but shipping it should wait on either a wider
sweep confirming the weatherFeasibility gap is real, or accepting that gap explicitly as a known
tradeoff. It is not, on this data, a fix for perceived slowness.

## Constraint-system rewrite — A/B against the pre-change baseline (2026-09-23, Claude)

Twenty-six commits rewrote the planner's constraint rules: a precedence order (§0), a budget that
is a ceiling rather than a quota (§5), two separate arrival and departure buffers (§4c-bis), a
no-duplicates rule (§14e), a whole-trip audit pass (§15), minimal-change editing (§12d), and three
new `UserAnswers` fields (`mustInclude`, `avoid`, `constraintsNote`) carried through both wizards,
both prompt paths and the critique. Four guardrail rules and four benchmark scorers were added to
check them. This section is the measurement, not the change.

`docs/superpowers/plans/baseline-2026-09-23.json` is raw model output from the seven frozen
fixtures, captured before a single prompt edit landed. `candidate-2026-09-23.json` is the same
seven, same staged path, run at the end — 7/7 cells, no failures, 241s mean. **Neither arm stores
a score.** `--compare` re-scores both with today's scorer code, so one copy of the scorer grades
both arms and it cannot flatter the arm it grew up beside.

### The headline, both halves of it

**The composite moved 0.8345 → 0.8642, +0.0297**, and every weighted group held or improved.
**`SKILL.md` is now 627 lines, up from 482 before this plan — 30% growth.** Those two numbers
belong in the same eyeline: the external review that started this work warned that growth past
~480 lines could make the model *less* consistent rather than more. On this evidence it did not.
That is the only evidence either way, and it is n=7.

**And the one axis the new rules most directly targeted went the wrong way.** `duplicates`
regressed 0.9283 → 0.8921, with 5 of 7 fixtures worse and only 1 better: 14 repeated stops before,
**17 after**, out of a stop count that itself fell from 164 to 154. §14e ("never send them to the
same place twice"), the §15 whole-trip read, and the new `duplicate` guardrail were all written for
exactly this, and the measured rate of repeats rose. It is unweighted, so it does not touch the
composite — that is the axis being honest rather than the axis being excused.

### The duplicates regression, read fixture by fixture

The aggregate above is true and stays as stated. Underneath it, the hand read of the 17 flagged
pairs changes what the number means.

| Fixture | Repeats, baseline → candidate | |
|---|---|---|
| rome-family-slow | 6 → 5 | improved |
| reykjavik-couple-packed | 5 → 4 | improved |
| barcelona-access-dietary | 1 → 1 | flat |
| lisbon-solo-offbeat | 1 → 1 | flat |
| kyoto-couple-mixed | 0 → 0 | flat |
| bangkok-solo-degraded | 0 → 2 | worse |
| queenstown-couple-noweather | 1 → 4 | worse |

**The two worst offenders both improved, and the entire +3 net is two fixtures that started at 0
and 1.** It is not "the cleanest both got worse": of the two fixtures with no repeats at all,
bangkok went to 2 and kyoto stayed at 0, and queenstown started at 1 — tied with barcelona and
lisbon, which both stayed there — and went to 4. So "5 of 7 fixtures worse" on the normalized axis
and "the rule backfired" are not the same claim, and only the first is supported: this is a rule
that **helped where duplication was already severe and hurt two of the five plans that were
already clean or near it.** Directional, not uniform — and two of five is not a pattern these seven
cells can settle.

**Queenstown's four repeats are all `by: "name"`, not proximity:**

```
{"dayIndex":1,"name":"Dinner in Arrowtown","priorName":"Dinner in Arrowtown","by":"name"}
{"dayIndex":2,"name":"Dinner in Arrowtown","priorName":"Dinner in Arrowtown","by":"name"}
{"dayIndex":3,"name":"Lunch in Arrowtown","priorName":"Lunch in Arrowtown","by":"name"}
{"dayIndex":3,"name":"Dinner in Arrowtown","priorName":"Dinner in Arrowtown","by":"name"}
```

Reading the plan itself, it is worse than the four flags suggest — seven Arrowtown meal stops,
every one of them `food` category on the same coordinate:

```
11:30 AM — Lunch in Arrowtown     (food, 1 hour,   $50)
06:30 PM — Dinner in Arrowtown    (food, 1.5 hours, $80)
06:30 PM — Dinner in Arrowtown    (food, 1.5 hours, $85)
06:30 PM — Dinner in Arrowtown    (food, 1.5 hours, $75)
11:30 AM — Lunch in Arrowtown     (food, 1 hour,   $50)
06:00 PM — Dinner in Arrowtown    (food, 1.5 hours, $75)
11:00 AM — Brunch in Arrowtown    (food, 1 hour,   $55)
```

**Four dinners in the same town on four consecutive evenings, three of them at the same 6:30 PM.**
These are real repeats of exactly the kind §14e forbids. They are not a coordinate artifact, not
the food/transit proximity exemption failing, and not the scorer being lossy on a bad parse — the
name match alone caught them, and the names are byte-identical.

**That kills the denominator hypothesis for the fixture driving the regression.** Queenstown went
1 → 4 in *absolute* count while its stop count rose 22 → 23; a smaller denominator cannot explain
an increase in the numerator. The hypothesis may still contribute to the aggregate rate — the other
six fixtures shed 11 stops between them, though not uniformly: lisbon dropped nine and rome seven
while kyoto gained six. But it explains nothing about queenstown, and queenstown plus bangkok are
the entire net regression.

Where it points instead: `queenstown-couple-noweather` is a **one-town trip**, and §4d anchors each
day to the previous night's base. With a single base and one nearby town carrying the restaurants,
the lodging-continuity rules and §14e pull against each other, and §14e lost four times. That is a
specific, testable interaction, not a general "the rule made things worse".

Bangkok's two are the weaker half of the regression and worth flagging as such: both are
`by: "proximity"` (`Riverside coffee break` against `Wat Arun`, `Riverside promenade and sunset`
against `ICONSIAM`) — riverside stops sharing a stretch of the Chao Phraya rather than the same
venue twice. That is the read the scorer's own docblock warns is lossiest.

### Paired table — seven fixtures, staged path

| Axis | Baseline | Candidate | Δ | Split |
|---|---|---|---|---|
| **composite** | **0.8345** | **0.8642** | **+0.0297** | 4 better, 3 worse, measurable 7/7 |
| routeEfficiency | 0.8259 | 0.8259 | +0.0000 | 4 better, 2 worse, measurable 6/7 |
| constraintAdherence | 0.6246 | 0.6841 | +0.0595 | 5 better, 2 worse, measurable 7/7 |
| weatherFeasibility | 0.8460 | 0.8806 | +0.0345 | 3 better, 1 worse, measurable 7/7 |
| mealVibeAlignment | 0.8701 | 0.9006 | +0.0305 | 5 better, 2 worse, measurable 7/7 |
| coverageGrounding | 0.9810 | 1.0000 | +0.0190 | 2 better, 0 worse, measurable 7/7 |
| duplicates *(unweighted)* | 0.9283 | **0.8921** | **−0.0362** | 1 better, 5 worse, measurable 7/7 |
| budget *(unweighted)* | 1.0000 | 1.0000 | +0.0000 | 0 better, 0 worse, measurable 7/7 |

`routeEfficiency` reads +0.0000 as a *mean*, not as a flat line — four fixtures improved and two
got worse and they cancelled. That is the shape a mean alone hides, which is why the split column
is printed beside every axis.

**`commitments` and `mustInclude` are deliberately absent from that table, and their absence is
the design.** Inside these seven fixtures `mustInclude` is measurable on **zero** and `commitments`
on **exactly one** — the seven predate the three new fields, and keeping them free of those fields
is what makes the arms comparable trips. A near-empty row rendered as a delta reads as "the rule
did nothing", which is the misreading this whole phase exists to prevent. They are measured
single-arm below. The raw output records their measurability verbatim:

```
paired fixtures: 7/7

composite               0.8345  →  0.8642   +0.0297   (4 better, 3 worse, measurable on 7/7)
  routeEfficiency       0.8259  →  0.8259   +0.0000   (4 better, 2 worse, measurable on 6/7)
  constraintAdherence   0.6246  →  0.6841   +0.0595   (5 better, 2 worse, measurable on 7/7)
  weatherFeasibility    0.8460  →  0.8806   +0.0345   (3 better, 1 worse, measurable on 7/7)
  mealVibeAlignment     0.8701  →  0.9006   +0.0305   (5 better, 2 worse, measurable on 7/7)
  coverageGrounding     0.9810  →  1.0000   +0.0190   (2 better, 0 worse, measurable on 7/7)

unweighted — new axes, not in the composite:
  duplicates            0.9283  →  0.8921   -0.0362   (1 better, 5 worse, measurable on 7/7)
                          repeats 14→17  (of 164→154 checked, summed over the 7 measurable fixture(s))
  commitments           1.0000  →  1.0000   +0.0000   (0 better, 0 worse, measurable on 1/7)
                          breaches 0→0  (of 6→4 checked, summed over the 1 measurable fixture(s))
  mustInclude           n/a — unmeasurable on 0/7 fixtures (nothing stated to check)
  budget                1.0000  →  1.0000   +0.0000   (0 better, 0 worse, measurable on 7/7)
```

### Judge tally — blinded

Two anonymous candidates per fixture, seed-shuffled by fixture id, model and vendor identity
stripped.

| Fixture | Arm A (baseline) | Arm B (candidate) |
|---|---|---|
| barcelona-access-dietary | 6.000 | **7.500** |
| kyoto-couple-mixed | 7.500 | 7.500 |
| lisbon-solo-offbeat | 6.500 | 6.500 |
| rome-family-slow | 5.500 | **7.500** |
| reykjavik-couple-packed | 5.000 | **7.500** |
| bangkok-solo-degraded | 6.500 | **8.000** |
| queenstown-couple-noweather | **7.500** | 6.000 |

**Judge prefers: arm A 1, arm B 4, ties 2.** The candidate's wins are also its larger margins
(+2.5 on reykjavik, +2.0 on rome); its one loss is −1.5. The judge never scored the candidate
below 6.0 and scored the baseline at 5.0 once, so the floor rose.

### Phase C — single-arm, `paris-requirements` only

**This is not a v1/v2 delta and must not be read as one.** `paris-requirements` is the one fixture
carrying `mustInclude`, `avoid`, `constraintsNote` and `logistics`, and it is deliberately outside
the A/B set: arm A's prompts could not consume those fields, so there is nothing to compare
against. The question here is "does stating the field change the plan", not "is v2 better".

One generation, 238.8s, composite 0.8746. By scorer:

| Scorer | Result |
|---|---|
| `mustInclude` | **4/4** — `includedCount` 2, `respectedCount` 2, nothing missing, nothing violated |
| `commitments` | **7/7 passed**, zero breaches |
| `duplicates` | **0 repeats** of 17 checked stops |
| `budget` | $1,148 of $2,600 — `budgetUsedFraction` 0.44, within budget |

By eye, against the four things the fixture was built to catch:

- **"Louvre Museum" appears exactly once as a stop** (Day 2, 9:00 AM, 3.5h, $36). Its six other
  mentions in the document are cross-references in `why`/`note` prose ("steps from Louvre",
  "complement Louvre's older masters"), not scheduled stops.
- **"Palace of Versailles" appears exactly once as a stop** (Day 3, 9:30 AM, 5h, $54). The RER C
  leg out, the lunch in Versailles town and the leg back share the name and the coordinate; the
  two transit legs are category-exempt from the proximity check by design, and the lunch is a
  distinct food stop. Neither the scorer nor a reader counts these as the palace twice.
- **Seafood is absent.** No `seafood`, `fish`, `oyster`, `moules`, `huîtres`, `fruits de mer`,
  `sushi` or similar anywhere in the document. The single `brasserie` hit is an area description
  of Saint-Germain, not a dish.
- **No day assumes a car.** No `car`, `taxi`, `rental` or `drive` anywhere. Every leg is metro,
  RER or on foot; the CDG transfer is "RER B direct from Luxembourg or Saint-Michel".

Both must-sees were also supplied *by the model* — the Louvre and Versailles are deliberately not
in the fixture's candidate list, so passing on the anchor rule alone was not available.

The departure boundary held with room: Day 4's last entry is a 1:30 PM transit to CDG for a 19:40
flight, noting "arrive airport by 16:00".

### Legacy-path sanity read — n=1, no paired baseline

Task 1 captured the staged path only, so **there is no legacy baseline and this is not a
comparison.** It is one run of `POST /api/itinerary` — the route the traveller-facing wizard
actually posts to, critique included — against `kyoto-couple-mixed`, to check the new rules did not
break the path that ships.

- **The plan comes back.** HTTP 200, 4 days, tier `luxury`, composite 0.7809 (lower than the
  staged arm's, as expected — this path includes critique and is a different, noisier prompt).
- **The budget lands under rather than at the ceiling.** $1,774 estimated against $2,600 —
  `budgetUsedFraction` **0.68**. Under the pre-change §5 the scorer would have marked that down for
  not reaching the 85-100% band; that is precisely the behaviour the ceiling rewrite was for.
- **The departure buffer question is unanswerable on this fixture.** `kyoto-couple-mixed` states
  `logistics: null`, so `scoreCommitments` returns `checked: 0` and `normalized: null` — the rule
  had nothing to bite on. What can be said is that the last day is light and ends early (two
  stops, finishing around 12:00, no lodging booked for the final night), which is at least not a
  violation. A real departure-buffer read needs a fixture that states a departure time.
- `duplicates` 0 repeats of 16 stops.

**One operational finding worth recording:** `skill-ab.mjs`'s legacy arm failed with a bare
`fetch failed`. The route was fine — it answered **200 in 312.7 seconds**. Node's `fetch` has an
undici `headersTimeout` of 300s that no `fetch` option exposes, and `benchTimeoutMs()` cannot
raise it because it is not the thing doing the timing out. The run above was made with `curl`
instead. Anyone re-running `AB_PATH=legacy` will hit this whenever the route exceeds five minutes.

### What this measurement does not establish

- **n=7 paired, one generation per arm per fixture.** That is enough to catch a collapse or a
  consistent shift, and not enough to call a small delta real. A +0.0297 composite on seven
  unreplicated pairs is a direction, not a number to quote.
- **The judge is a Claude model scoring Claude output.** That is a preference signal, never ground
  truth. A 4-1-2 tally from it is corroboration of the scorer's direction, not independent
  evidence.
- **`mustInclude` has been exercised on exactly one trip, and `commitments` on two.** Both passed
  perfectly, which is what a rule with one test looks like whether it is robust or lucky.
- **The duplicates regression is the finding most worth following up, and the hand read has
  already closed half of it.** *No longer open:* it is not a scorer artifact — queenstown's four
  flags are byte-identical names, not a proximity or parse effect — and the shrinking denominator
  does not explain it, since queenstown rose 1 → 4 in absolute count while gaining a stop. *Still
  open:* why a one-town trip repeats its evening meal area four nights running, which reads as
  §4d's lodging continuity pulling against §14e; and whether any of this replicates, since it is
  one generation per fixture. The aggregate rate may still be partly a denominator effect on the
  other six fixtures, which shed 11 stops between them.

## Legacy-path baseline — partial, 3 fixtures × 3 runs (2026-09-25, Claude)

The first measurement of the path travellers actually get (`POST /api/itinerary`, critique
included), repeated rather than run once. `scripts/skill-ab.mjs` gained `AB_RUNS`, a `node:http`
transport (the route answered in 302-574s; `fetch` dies at 300s), a hard-failure gate
(`src/lib/bench/criticalFailures.ts`) and `--report`. Raw output is in
`docs/superpowers/plans/legacy-baseline-2026-09-25.json`, re-scored at report time like every arm.

**Partial by decision.** The plan was 7 fixtures × 3. It was stopped after 9 runs because the CLI
transport, though free per call, spends the developer's Claude subscription — ~7 minutes and several
model calls per run. Rome, Reykjavík, Bangkok and Queenstown were not run; the report reads a
partial arm, so the sweep can be finished later into the same file.

- **Transport:** CLI (default). Models from `getRunSteps`: generate and critique `claude-sonnet-4-5`,
  sketch `claude-sonnet-5`. Production's API transport routes generation to `claude-opus-5`, so
  these numbers are comparable only to other CLI-transport arms.
- **Headline — critical-trip failure rate: 89% (8 of 9 runs broke at least one hard rule).**
  Composite mean 0.902, worst 0.821 (grounding outside the composite, see below).

| Fixture | Mean | Worst | Critical | Codes |
|---|---|---|---|---|
| barcelona-access-dietary | 0.876 | 0.821 | 3/3 | travel_leg (3), mobility (2), dietary (2), closed_or_hours (1) |
| kyoto-couple-mixed | 0.890 | 0.887 | 3/3 | closed_or_hours (3) |
| lisbon-solo-offbeat | 0.940 | 0.904 | 2/3 | pace (1), travel_leg (1) |

### What the repeats show that n=1 could not

- **Kyoto fails the same way every time — but read the correction below first.** All three runs
  break an anchor's hours: Nijo Castle on a Monday (runs 1 and 3), Kinkaku-ji outside 09:00-17:00
  (runs 1 and 2). The Nijo half turned out to be the fixture's invented closure, not a real one —
  see "Addendum" below.
- **Barcelona's airport transfers don't fit the schedule.** `travel_leg` fired on all three runs.
  The legs are the booked-flight transfers: "Private transfer from Barcelona-El Prat Airport to
  Museu Picasso takes about 55 min, but only 15 min is left for it." That is §4c-bis's arrival
  buffer being written into the plan and then not left room for.
- **The dietary gate caught two real misses for a vegan traveller:** "Late lunch in El Born"
  suggesting seafood, and "Wine tasting in El Born" suggesting cheese. It is a keyword proxy (see
  `scoreDietary`), so these were read by hand before being counted.
- **Lisbon is the only fixture that ever passed** — once in three runs, which is exactly the
  instability a single run hides.

### Caveats — read these before quoting any number above

- **No weather reached any of the nine runs.** The harness sent the fixture's admin region
  ("Catalonia, Spain", "Lisboa, Portugal") as the destination; Open-Meteo geocodes that to nothing,
  and a failed geocode is non-blocking by design, so the route planned with no forecast and said
  nothing. The wizard sends "City, Country", which geocodes fine — so **this is a harness bug, not a
  product one**, fixed in `legacyDestination()` after the sweep stopped. These nine runs are
  therefore harsher than production (no weather, no bikeshare) and their weather axis is unmeasured.
  A resumed sweep will not be like-for-like with them on anything weather touches.
- **N=3 on three fixtures.** Enough to separate "always" from "once" — Kyoto from Lisbon — and not
  enough to call a small composite difference real.
- **Grounding is outside the legacy composite.** It scores only claims that contradict context the
  legacy path is never given, so it reads a near-vacuous 1.0 there and would lift the composite for
  nothing. It is still printed as its own column.
- **Scorer changes landed with this sweep, so older composites moved.** Route scorers now fall back
  to a stop's own coordinates (`locateEntry`), and `pace` counts sightseeing stops only, as both
  prompts define it (it had been counting meals). Re-scored with today's code, the 2026-09-23 staged
  arms read **71% critical (5/7) for the baseline and 43% (3/7) for the candidate** — the
  constraint rewrite's effect on hard failures, which the composite alone had shown as +0.03.
- **Staged vs legacy is not like-for-like on the headline.** `travel_leg` needs typed stops and
  runs on the legacy arm only; `--compare` says so when the paths differ.

### Addendum — two weather runs, and why the hours failures are data, not rules (2026-09-26, Claude)

Two more legacy runs (`legacy-baseline-2026-09-26.json`, `AB_RUNS=1`, Kyoto and Rome), the first
with weather — `legacyDestination()` now sends "City, Country", and the route received 4 and 5
forecast days. **Both still broke an anchor's hours:** Kyoto scheduled Nijo Castle on Monday
(plus a 6-minute walk with 0 minutes left for it); Rome scheduled the Colosseum outside
09:00-16:30. So weather was not the cause. Reading the stored prompts and traces settled what is:

- **The generator is never told any anchor's hours.** `formatAnchors()` (`itineraryPrompt.ts`)
  writes each anchor as a name and coordinates, then `ANCHOR_INSTRUCTION` says "schedule every MUST
  place … at a time it is open". No hours string from either fixture appears anywhere in either
  prompt. The rule is there; the fact it needs is not. **Another prompt rule cannot fix this.**
- **The post-generation safety net finds nothing for these places.** The critique prompt for both
  runs carried no closed or conflict findings. Cause, confirmed against Overpass:
  `fetchPoiOsmTags()` matches OSM's `name` tag exactly, and outside English-speaking countries that
  tag holds the local name. `"Nijo Castle"` and `"Colosseum"` return nothing; `"二条城"` returns
  `Mo-Su 08:45-17:00`. Results are also keyed by the element's own `name`, so even a match would be
  filed under a key the caller never asks for. Every non-English-named stop on the legacy path goes
  unenriched — no closed-day conflict, no step-free check, no pinned admission cost.
- **Correction: the Kyoto closure is the fixture's, not Nijo's.** `kyoto-couple-mixed` hard-codes
  `"Tu-Su 08:45-17:00; Mo off"` for Nijo Castle — a deliberate closed-day test ("anchors with real
  hours + closed days"). OpenStreetMap says open daily. On the staged path that is a fair test: the
  fixture's hours are in `trip-context.md`. On the legacy path it tests a fact the model was never
  given and that reality contradicts, which is the weather trap again. **The "Kyoto 3/3" finding
  above measured the fixture, not the product.** The Kinkaku-ji and Colosseum windows are
  plausible real hours and still stand as misses — unverified guesses from memory, since the model
  had nothing else.

Next is `docs/superpowers/specs/2026-09-26-anchor-hours-before-generation-design.md`: look anchor
hours up **before** generation, by any OSM name tag, and write them beside each anchor — and score
the legacy arm's hours checks against the hours the route actually had, the way weather already is.

#### After: anchor hours in the prompt (2026-09-26, Claude)

Built from `docs/superpowers/specs/2026-09-26-anchor-hours-before-generation-design.md`. The legacy
route now looks each anchor's OSM hours up before generating (`src/lib/anchorHours.ts`, a 20s race
overlapping the context and sketch calls), and `formatAnchors` writes them beside the place. The OSM
lookup itself was fixed for every caller: it matches the exact local `name` and an accent- and
dash-tolerant `name:en`, and files results under the name that was asked for. Offline, against live
Overpass, all six Kyoto and Rome anchors that OSM holds hours for now resolve — including Nijo Castle
("Nijō Castle" in `name:en`) and the Pantheon (whose hours sit on a relation behind a bare node) — in
4.3s. Fushimi Inari correctly gets none; OSM carries no hours for it.

Two generations (`legacy-hours-2026-09-26.json`, `AB_RUNS=1`):

- **Rome — the hours worked.** The prompt read
  `- WANT: Pantheon (41.8986, 12.4769) — open Mo-Sa 08:30-19:15; Su 09:00-17:45 (OpenStreetMap)` and
  the Colosseum's seasonal hours likewise. The model put the Colosseum at 9:00-11:00 on 1 November
  (hours 08:30-16:30) and the Pantheon at 9:30-10:30 on a Monday (08:30-19:15): both inside. The
  one remaining critical code is `mobility` — three family days with over 3h of activity and no rest
  entry, a real miss and a rule matter, not a data one.
- **Kyoto — no hours reached the prompt.** The lookup came back empty inside the server, most likely
  because the run started while a heavier four-key query was live (since replaced after review; it
  had failed on every mirror once). Nothing logged it, so the cause is not proven; the lookup now
  warns when it returns nothing. The harness correctly left Kyoto's anchor hours unchecked, so this
  run measures nothing about hours.
- **A scorer false alarm, fixed.** The first report failed Rome on "Colosseum is shut all day on Sun".
  Real OSM hours had never reached the bench's parser before, and it read the month-range clauses
  (`Oct 25-Feb 28 08:30-16:30`) as no hours for that weekday. `hoursForWeekday` now leaves seasonal
  syntax unchecked, as `closedDaysFromOpeningHours` already did.

Headline: 2/2 runs broke a hard rule — Kyoto on `over_budget`, Rome on `mobility`. **Neither broke an
anchor's hours**, which on every earlier legacy run one or both had. Two runs, one of which had no
hours, is a direction and not a measurement; the Kyoto re-run with hours is the next thing to take.

## Still open

**Not fixable by rules — no data behind them.** Adding skill rules for these would be instructions
with no facts to act on:

| Gap | Missing fact |
|---|---|
| Transit-time realism (rush hour, transfers) | Real routing with a departure time. Today: haversine × 1.3 and three fixed speeds |
| Transport mode availability | `transportModes.available` is hardcoded `false`; walk + transit is always assumed |
| Terrain, gradient, uphill | No elevation source anywhere |
| Hours for model-chosen stops | Only pinned anchors are looked up, and most stops are not anchors. A post-generation Overpass pass over emitted names is feasible — `resolveNamedPlaceCoords` already proves the pattern |
| Timed-entry lead times | No source carries it |
| Real prices | Every cost is the model's estimate |
| Per-POI crowd data | The crowd *preference* plumbing is complete; busyness itself is not fetched |

**Needs a run, not a change:** the legacy path now has a partial baseline (3 of 7 fixtures, see
"Legacy-path baseline" above), taken without weather because of a harness bug since fixed. Finishing
it — the remaining four fixtures, and a re-run of the three with weather — is the next measurement.
