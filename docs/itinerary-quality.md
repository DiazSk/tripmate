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
| §4e | Booked lodging is the base at cost 0; arrival/departure times bound the first and last day | Recovered |
| §9a–§9d | Style as tie-breaker not stop count; energy ladder; rest break as its own entry; solo/couple logic; flags shape the plan but are never mentioned in it | Recovered. `explorer_style` had collapsed to a number, and solo/couple derived nothing |
| §9e | Accessibility is stated, not inferred; `wheelchair` values govern selection | New capability, see below |
| §13 | Degrade, don't fail: default, say so in the note, never fabricate the missing fact | Recovered |
| §14a–§14d | Vary the kind of stop; open time must look deliberate; flag what needs booking ahead; name the costs a budget forgets | New. A sample ran five straight hours of shopping and left an unexplained 4.5-hour hole |

### Data reaching the model

| Change | Why |
|---|---|
| `dietary` on `UserAnswers`, emitted as its own context section | It was collected, stored, validated and unit-tested, used by the legacy prompt, and silently dropped by the staged pipeline. `dietaryPrompt.ts` calls this the worst failure the feature can have |
| `logistics` (`arrivalTime`/`departureTime`/`stayBooked`) on `UserAnswers` | Fed §4e, which had no input. **`src/lib/bench/customTrip.ts` had been assigning this exact shape to a field `UserAnswers` never declared — a latent type error at HEAD**, so the names were adopted rather than reinvented, and `BenchLogistics` is now a re-export |
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

`MODEL` moved from `claude-haiku-4-5-20251001` to `claude-sonnet-5`. The benchmark's own first
sweep scored Haiku 4.5 at 0.842 composite against Sonnet 4.5's 0.959 and Opus 4.5's 0.952 — the
Sonnet/Opus gap is noise at 3 runs on one fixture, the Haiku gap is not. This is one call that
produces the whole product, so the tier matters more than the per-token rate. Bench defaults are
now Sonnet 5 (baseline) / Haiku 4.5 (the downgrade question) / Opus 5.

### Fixtures

Added `barcelona-access-dietary` — the only fixture stating dietary needs, a step-free
requirement, and booked logistics, with OSM `wheelchair` tags on its candidates. Its `energy` is
deliberately `high` so that a step-free requirement overriding it is what's being tested. The set
was already 6 trips covering group types, the pace range and every degraded path; the real gap was
that the one recorded sweep ran a single fixture, not that fixtures were missing.

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

**Needs a run, not a change:** the benchmark has not been swept since the format fix or the model
change. Every number in the audit baseline above predates both.
