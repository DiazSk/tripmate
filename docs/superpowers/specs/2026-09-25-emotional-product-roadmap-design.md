# TripMate product roadmap: from demo to a trip people fall in love with

**Date:** 2026-09-25 · **Author:** Zaid, with Claude · **Status:** Strategy, approved in brainstorm

The first sub-project under this roadmap is specified separately:
[`2026-09-25-chaos-in-trip-out-design.md`](2026-09-25-chaos-in-trip-out-design.md).

## North star

> Make the planner fall in love with the trip before they take it, and trust the plan enough to actually take it.

Every feature has to serve at least one of four pillars. If a feature serves none of them, it waits.

| Pillar | What the traveller feels | What produces it |
|---|---|---|
| Anticipation | "I can already see this trip" | the map, imagery, Story mode, the sketch |
| Understanding | "This was planned for *us*" | a `why` on every stop, day themes, honouring places they chose |
| Confidence | "This will actually work" | `guardrails.ts`, `placeConflicts.ts`, real hours, weather and travel times |
| Control | "I can change it without breaking it" | chat edits through patch ops, locked days, the receipt |

## Who it's for first: the designated group planner

This is the friend or partner who plans a 3–7 day city trip for 2–5 people. They carry two fears: *"I'll be
blamed if it sucks"* and *"I want everyone excited."* We chose them over a solo or couple planner for two reasons:

- The planning pain is worst when you're coordinating other people.
- Every trip reaches 2–4 more people who haven't used TripMate. That growth loop is built in, and a solo planner
  doesn't have one.

**The enemy is planning chaos, not other itinerary apps.** Chaos means saved TikToks, camera-roll screenshots, a
friend's WhatsApp list, 17 tabs and a Google Maps list. **The real competitor is ChatGPT plus Google Maps**, which is
free and already in the planner's hand. TripMate wins only if its plan is visibly better than that, and nobody has
checked yet (Stage 0).

## Where the outside brainstorm (ChatGPT, 2026-09-25) and the repo disagree

- **The "magic" moment arrives after a 5.8-minute median wait, at about $1.09 per plan.** Better copy can't make
  that feel like magic. That is why Stage 1 includes a ~20-second sketch.
- **Much of what the brainstorm proposes already exists:**
  - a per-stop `why`;
  - rotating real facts while the plan generates;
  - stops streaming onto the map as they're written;
  - Story mode as a "trailer for your day".

  The gaps are elsewhere: imports, sharing, the weeks before the trip, and the trip itself.
- **"Plan Integrity" is `guardrails.ts` plus `placeConflicts.ts`.** Budget compliance is still enforced only by
  prompt text and the critique.
- **Leaving budget headroom ("$174 left unplanned") contradicts SKILL.md §5,** which pushes the plan to spend close
  to the full budget. This is a real product decision, and we are **not** adopting it here. It is parked below.
- **The brainstorm's persona ("18–35 leisure travellers") is a demographic, not a person.** We replaced it with the
  group planner above.

## Stages

Each stage has an exit test. We don't start the next stage's build until the current one passes.

### Stage 0: prove it (no code, runs alongside Stage 1)

- Run the G7 blind test from `docs/product-readiness.md` with 8–10 real group planners: TripMate's plan against a
  plain single-prompt ChatGPT plan for the same trip.
- Watch 3 of them plan a real trip from their own saved pile. Their piles become the test fixtures for Stage 1.
- **Exit:** most testers prefer TripMate's plan, and we know which parts made the difference. If they don't prefer
  it, fix the plan before adding anything emotional on top.

### Stage 1: demo, "Chaos in → trip out"

- The planner drops screenshots, links and notes.
- The places show up on the 3D map.
- A sketch of the days appears in about 20 seconds.
- The full plan is built around their places, and a receipt shows which of them made it in.
- **Exit:** a first-time planner goes from their own pile to a plan they'd show their group, unaided.

### Stage 2: beta, real groups on real trips

- **Public deploy:** revive the parked `2026-08-25-deploy-and-direct-api-design.md`, including the abuse guard. At
  about $1/plan, the beta budget has to be set on purpose.
- **Win the group over:**
  - a share link and public trip page;
  - a vertical trailer exported from Story mode;
  - friends react to and vote on stops, and the planner decides.
- **Own the waiting weeks:** a countdown for the time between planning and departure, with the forecast firming up,
  a checklist (currency, eSIM, visas) and "3 weeks to Tokyo". People report more happiness *anticipating* a holiday
  than after it (Nawijn et al., 2010), and no product owns that window.
- **iOS Share Extension** on the Stage 1 endpoint ("Share → TripMate" from TikTok or Photos).
- **Exit:** a measurable share rate and a group-member-to-planner conversion rate.

### Stage 3: a monetisation story

- **A per-trip pass (~$5–9)** unlocking a during-trip "Today" mode ("we're tired", "it's raining", "running late")
  and group features. People travel 1–3 times a year, so subscriptions churn and a per-trip price fits.
- **Affiliate links** (eSIM, tours, stays), kept *beside* the plan, never inside its choices. Otherwise the plan's
  credibility is for sale.

## Parked (serves a pillar, but not now)

- Visible per-day check lines: "Open when you arrive ✓ · 12 min walk ✓ · Rain plan ✓".
- The budget-headroom decision above.
- Before/after diffs and undo for chat edits.
- A post-trip recap built from the plan, actual spend and photos.
