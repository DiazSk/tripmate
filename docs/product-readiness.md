# Product readiness — external judgment

What people *outside* the team think of this app, and what has to be true before that question can
even be asked. Distinct from the other trackers: `backend.md` / `frontend.md` / `llm.md` record what
was built, `itinerary-quality.md` records how the output scores against a rubric **we wrote
ourselves**. This records what someone who did not build it says — which is, as of today, nothing,
because nobody outside the team has ever seen an itinerary.

## Council verdict — 2026-08-22 (Zaid)

Five independent advisors plus an anonymized peer-review round were run against the question "is
this a product, is it ready, and what would make it sellable to travel sites or agencies."

**The verdict was unanimous and is not close: this is a demo, not a product.** Every advisor
independently reached for the same test — does it survive a second user — and every one got "no".
The evidence is all in the repo:

- No authentication or multi-tenancy of any kind. `owner_id` exists on `traveler_profile`
  (`src/lib/db.ts:71`) and is never checked; `trips` has no such column at all.
- Storage is a single SQLite file at the repo root, no deploy config anywhere.
- `README.md` was one word. No pitch, no stated problem, no positioning.
- No user-facing feedback path. `LlmTraceFab` is a *developer* trace viewer, not a way for anyone
  to tell us the plan was wrong.
- Itinerary quality stood at **3 of 29 rubric criteria fully handled, 11 missing**
  (`itinerary-quality.md:17-26`) while the preceding ~2.5 weeks of commits went to hover states,
  header overflow and tab-strip titles.

### Where the council agreed

Three advisors independently produced the same metaphor — polishing paint on a house with no
plumbing — for the gap between the front-end's production value (Cesium globe, cinematic camera
flights, themed unboxing transitions) and the fact that the thing it presents has never been judged
by an outsider. The convergence matters more than the phrasing: nobody was told what the others
said.

The second agreement: **every market-fit question currently has no answer, not a bad answer.**
There is no data, because there are no users. Asking "what's our market fit" before a single
stranger has read an itinerary is asking a question the repo cannot answer.

### Where it clashed

One advisor argued the B2B/white-label path is the real business and bigger than the consumer one —
that the rubric plus the Sonnet-vs-Haiku cost/quality sweeps are an eval harness almost no
competitor has, and "composite quality score vs cost per call" is a slide most of them literally
cannot produce. That asset is real and this doc is not dismissing it.

The peer reviews rejected its **timing**, not its substance, and the objection is sharp enough to
record: you cannot sell quality-per-dollar off a scorecard that reports the core output 62%
incomplete, running on free-tier APIs with no SLA where an Overpass rate-limit silently drops
content and notifies nobody. That is a liability pitch. The sequencing that survives: validate with
real humans, close the rubric gaps, *then* revisit the B2B pitch with retention data instead of a
hunch.

### Blind spots peer review caught

These emerged only from advisors reading each other, and two of them are more useful than anything
in the individual responses:

1. **The rubric may not be measuring what we think.** It is self-graded and has never been checked
   against a real traveler's preference. It could be evidence the output is good, or evidence the
   team is good at building evals. **Nothing currently in the repo can tell those two apart** — see
   G4 below, which is the only cheap experiment that would.
2. **Nobody proposed the cheapest test.** Every advisor, including the ones insisting on validation
   first, jumped to infrastructure (deploy, hosted DB, a feedback widget) before anyone suggested
   just sending a stranger the itinerary. That is now G1, and it needs no deploy at all.
3. **Unit economics were never priced.** Every model call is a `spawn` of the `claude` CLI
   (`src/lib/claude.ts`). The refine sweep has real numbers ($0.235/cell Sonnet 4.5, $0.107 Haiku);
   whole-itinerary generation does not.
4. **The competitive bar is probably misidentified.** Not TripIt or Wanderlog — the bar is whether
   this beats someone just asking Claude or ChatGPT to plan the trip. If it doesn't, the fetches,
   the reconcile layer, the skill rules and the rubric are not buying what they cost.
5. **Some of the ruthlessness was miscalibrated to project age.** "No monetization, no feedback
   loop" at 2.5 weeks old is normal for the stage, not damning. Recorded so a later reader doesn't
   over-correct from the tone of the rest of this section.

### Open gaps

Scope decision, stated so it stays visible: this round is **validation-unblocking only**. The
listed deferrals are not oversights.

| # | Gap | Action | Blocks the test? | Status | Developer |
|---|---|---|---|---|---|
| G1 | No external human has ever seen an itinerary | `/trip/[id]/print` — an all-days reviewable document, then send it to ~5 people | **Yes** | Done 2026-08-22 | Claude |
| G2 | Nowhere to record what reviewers say | The Reviewer findings table below. Deliberately a doc, not a schema — five reviewers do not justify a table in SQLite | **Yes** | Done 2026-08-22 | Claude |
| G3 | `README.md` was one word | A real pitch: the problem, what's different, setup | No | Done 2026-08-22 | Claude |
| G4 | The rubric is self-graded, never validated against a traveler | Tag every reviewer complaint against a rubric criterion. **The complaints that map to no criterion are the finding** — they are a blind spot no internal sweep can surface | No — depends on G1 | Open | — |
| G5 | Unit economics of a generation never priced | **$1.09 and 5.8 min of model time per generation** (median) on the production model, against $0.235 for a refine turn. See "What a generation costs" below | No | Done 2026-08-23 | Claude |
| G6 | Benchmark unswept since the format fix and the model change | Already tracked at `itinerary-quality.md:180-181` — "needs a run, not a change" | No | Open | — |
| G7 | Competitive bar may be misidentified | For 1–2 trips, also generate a plain single-prompt itinerary and put both in front of reviewers unlabeled. **The sharpest test available**, and optional | No | Open | — |

**Deferred deliberately:** deploy/Vercel, hosted Postgres or Turso, auth and multi-tenancy, an
in-app feedback widget, payments, the B2B API tier and white-label, and the seven data-blocked
rubric gaps at `itinerary-quality.md:165-179`. Every one of these is downstream of a G1 result.

**Update, 2026-08-25:** deploy is no longer deferred — a public Railway link is needed for a
LinkedIn demo, a different trigger than this round's validation sequencing. Not a reversal of the
judgment above: hosted Postgres/Turso, auth/multi-tenancy, and the B2B pitch are all still
deferred. See `docs/superpowers/specs/2026-08-25-deploy-and-direct-api-design.md`.

## What a generation costs — 2026-08-23 (Claude)

Closes G5. Measured off the 237 rows already in `llm_traces`, grouped into runs by `run_id`, with
cost and tokens read out of the stored CLI envelope by the app's own `parseUsage`
(`src/lib/runs.ts:18`) rather than a second parser written for this — that function already handles
the two traps here, preferring per-model `costUSD` over the envelope's `total_cost_usd` because the
CLI makes its own housekeeping call on Haiku alongside the requested model.

**A generation is not one call.** `runGeneration()` fires `generate`, then `critique`
unconditionally (`src/lib/generationRunner.ts:186`, fail-soft), plus `context` on a
`destination_context` cache miss. So the number that matters is per *run* — what one press of
"plan my trip" costs — not per call. On `claude-sonnet-4-5`:

| Run shape | n | Median | Range | Median latency |
|---|---|---|---|---|
| `generate + critique` (context cached) | 4 | **$0.850** | $0.781–$1.095 | 402s |
| `context + critique + generate` (cold context) | 4 | **$1.156** | $1.082–$1.182 | 325s |
| `generate` alone (staged pipeline, no critique) | 3 | $0.526 | $0.516–$0.550 | 241s |

Across the eight critique-bearing runs the median is **$1.088 and 348s (5.8 min) of summed model
time**, ranging $0.781–$1.182 and 4.9–8.4 min. For comparison, the refine sweep in
`itinerary-quality.md` measured $0.235 per turn — **a generation costs 4.6× a refine turn** — and
the whole trace table to date is $33.21 of observed spend.

Per call, `claude-sonnet-4-5`: `generate` $0.445 median (189s, n=15), `critique` $0.438 median
(163s), `context` $0.234 median (27s). Haiku 4.5 runs the same shape at **$0.231** per generation —
4.7× cheaper — which is the same downgrade question `itinerary-quality.md` already asks, now with a
generation-side price on it.

Three findings the raw totals hide:

- **Critique roughly doubles the bill for a second opinion.** It is 34% of spend (generate is 54%,
  context 11%) and costs almost as much per call as the generation it checks — $0.438 against
  $0.445. It is also the step with the timeout problem: `generationRunner.ts:210`'s own comment
  records a 35% critique failure rate that once went unnoticed, and 5 of the 8 timeouts in this data
  are critique calls giving up at 150s. **This is the single biggest cost lever in the app**, and
  whether it earns its ~$0.55 has never been measured — the benchmark scores finished itineraries,
  not the critique's marginal contribution to one.
- **Prompt caching is paid for and never collected.** Every call writes ~34.5k tokens of cache at
  the 1.25× creation rate and then reads it back on 2 of 15 sonnet calls and 0 of 18 Haiku ones. A
  one-shot subprocess per trip means each prompt is unique, so the 0.1× read discount is
  structurally unreachable — the cache is pure overhead as currently used. Note the `inputTokens`
  field reads as **10** on almost every trace, which is real but misleading: the prompt arrives as
  `cacheCreationInputTokens`. Anything reading `inputTokens` alone will conclude these calls have no
  input.
- **Failures are unmeasurable, not free.** All 11 failed generate/critique/context calls have
  `raw_response` NULL — the CLI was killed before it emitted an envelope, so their token spend is
  unknown rather than zero. That is 22.3 minutes of wall time with no accounting. One *success* is
  unmetered too: a 487s sonnet generation returned a real itinerary with `modelUsage: {}` and
  `total_cost_usd: 0`. **Every figure above is therefore a floor**, and it is excluded from the
  medians rather than averaged in as a free generation.

Caveat on all of it: n=8 for the headline, all from 2026-08-20/22, one destination mix, and untagged
(`llm_runs.batch_tag` is NULL on all 116 runs — nothing here came from a controlled sweep). Good
enough to size the unit and rank the levers, not to quote as a stable per-user cost.

### Reviewer findings

Empty until the first review comes back. One row per distinct complaint, not per reviewer.

The `Rubric criterion` column is the load-bearing one: a complaint that maps to an existing
criterion says the rubric was right and the pipeline missed it, which is an implementation bug. A
complaint tagged **`not in the rubric`** says the rubric itself has a hole — and that is the only
evidence that would settle blind spot 1 above. Expect the second kind to be more valuable and
rarer to spot.

| Date | Reviewer | Trip | Complaint | Rubric criterion | Action |
|---|---|---|---|---|---|
| — | — | — | *(none yet)* | — | — |
