# Mobile design feedback — triage and ranking

**Date:** 2026-09-28 · **Developer:** Claude · **Client:** `mobile/` (Expo), branch `feat/mobile-auth-entry`

A 29-item design critique arrived, written from the 14-screen design board
(`docs/design-board/`). The board is a set of *screenshots*, so each screen could only be judged in
the one state it was captured in. **Nine of the 29 items ask for something that is already built**,
including three the review named as top-ten priorities.

This file is the ranking, so the next round of feedback starts from what exists rather than from
what was photographed. It is not a plan — each band below is its own piece of work.

## Band 0 — already built; the board never showed it

| # | Asked for | Where it already is |
|---|---|---|
| 6 | Plan Health drill-down *(their #2)* | `mobile/src/components/plan-health.tsx:35` — tappable, expands to seven dimensions with sub-scores and every finding. Deterministic arithmetic (`src/lib/planHealth.ts:156`, flat `PENALTY = 8`), and unmeasured dimensions read **"Not checked"** rather than 100. |
| 23 | Review / Trip Brief *(their #10)* | `mobile/src/app/plan/review.tsx`. Now also carries pace, diet and access — see Band 1. |
| 24 | Generation should show real stages *(their #10)* | Exceeds the ask. Five stages stream over SSE (`src/lib/generationStages.ts:20`) with weights re-derived from measured p50s, plus `sketch`, per-stop `stop` events and `revised`. |
| 19a | Budget category breakdown | `daySpendByCategory()` (`src/lib/itinerary.ts:89`) → `spend-breakdown.tsx`. |
| 9 | Interests star grammar "too hidden" | Disclosed three ways: state-dependent caption (`preferences.tsx:45`), a `★` prefix plus a colour step, and an `accessibilityHint` naming the next tap (`form.tsx:581`). |
| 11 | Jade means action *and* selected | Already the fix they proposed — `form.tsx:457` `choiceSelected` is `accentWash`, jade at 9%. |
| 13a | Home should adapt | Already switches "Up next" / "Latest memory" (`(tabs)/index.tsx:63`). |
| 27 | Profile fields should be defaults | The wizard collects each per-trip and the trip answer already wins. A labelling question, not a model change. |
| 1 | Day hero eats vertical space | Fair, and cheap: a scroll-collapse on `day-page.tsx:78`. |

## Band 1 — shipped 2026-09-28

Seven changes, no server change. See the Enhancements rows in `docs/frontend.md`.

| # | Change |
|---|---|
| 10 | Home's `01/02/03` ordinals off gold — gold counts money and only money. |
| 8 | "Who's travelling" now seeds the Party counters (`partyForGroup`, `planDraft.tsx`); "Something else" → "Friends / group". |
| 22 | Day chips carry a date and weekday (`formatDayChip`, `dayDisplay.ts`). |
| 21 | Day selection lifted out of the control row — selection, view and actions are three groups. |
| 12 | Memories → **Trips**, sectioned Upcoming / Past (`tripsWall.ts`). |
| 19b | The budget figure is labelled **Projected**, or **Spent** once a real figure exists (`anyActualSpend`). |
| 23b | Review gained Pace, Diet and Access rows; the last two print even when empty. |

## Band 2 — real gaps, each worth its own design pass

| Rank | # | Gap | Note |
|---|---|---|---|
| 1 | 4 | **Change Preview + Undo** | `trip/[id].tsx:420` swaps the whole itinerary in unconditionally; `:127` already says so in a comment, and `updateTripItinerary` overwrites with no history table. The client holds the old itinerary, so diff and undo can both be client-side. |
| 2 | 14 | Add Stop is generic search | The app already picks the day and the slot; it just doesn't say so. |
| 3 | 3 | Ask needs a scope control | Copy reads "The whole plan is in scope" (`chat-sheet.tsx:157`). Suggestions are half-built via `askWith()`. Scope must reach `src/lib/editContext.ts`. |
| 4 | 20 | Legs deserve a summary and detail | Derivable from `TravelLeg` data already computed. |
| 5 | 7 | Pace and discovery are welded together | `packed / relaxed / offbeat / mixed` (`planDraft.tsx:30`). A packed offbeat trip is unsayable. `explorerStyle` is a shared enum reaching `types.ts`, `userAnswers.ts`, `travelerProfile.ts`, `tripContext.ts`, `editContext.ts`, the web wizard **and stored profiles** — a migration. |
| 6 | 5 | "Fix this" should offer concrete options | Blocked: a `Guardrail` carries prose and no suggested fix (`guardrails.ts:65`). |

## Band 3 — needs data that does not exist

- **16 — per-stop provenance.** A `Stop` carries none. The `available`/`estimated` convention dies at the reconcile boundary: `generationRunner.ts:7` takes coordinates from `poiDetails` and drops the rest, and `ReconciledTrip.notes` is never persisted. `Anchor` is the one precedent that carries verified `openingHours` onto a saved plan (`types.ts:88`).
- **17/18 — booking details.** `timeFlexibility: "FIXED"` is a bare enum: no confirmation number, URL or booking note anywhere.
- **19c — projected vs booked vs spent.** Only planned and actual exist, coalesced by `spendOf`.
- **25 — deliberate edge states.** `components/states.tsx` has the primitives; this is an audit.

## Band 4 — new surfaces

- **2 — Today / Trip Mode** *(their #3)*. The biggest single gap: **no trip lifecycle exists**. `TripStatus` is `"draft" | "saved"` — persistence, not time. `tripsWall.ts` now derives upcoming/past for the library and is the natural seed for a phase helper.
- **13b** Home's in-trip and post-trip states (depends on the above) · **29** outbound share (`share.tsx` only receives) · **28** Explore (overlaps 14).
- **26 — light mode / high-contrast Trip Mode.** A product decision, not a task: `constants/theme.ts` states "There is no light theme, and that is the design" and `app.json` pins `userInterfaceStyle: "dark"`. The outdoor-legibility argument is good and pairs with Today Mode, but it reopens a settled call.

## Computed and then thrown away

Cheap to surface, already calculated:

- `revisionIsNoWorse()` returns before/after blocking-finding counts, only `console.log`'d (`generationRunner.ts:691`).
- `checkCommitments` knows the offending stop and omits `stopIndex` (`guardrails.ts:443,463,488`), so a missed reservation cannot render on its own row the way a weather finding can.
- `planHealth` is never served over HTTP — the web app does not show it at all.
