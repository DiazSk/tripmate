# Four things on `dev-aryan` that `feat/ui-optimization` doesn't have

> **Resolved 2026-09-06 (Claude). All four gaps are closed on `development`.** Re-checked one by
> one against the merged branch, not assumed from the merge landing:
>
> | # | Gap | Where it is closed now |
> |---|---|---|
> | 1 | Accessibility never collected | `HomeView.tsx` has the `accessibility` state, the "Getting around" controls, and it reaches `currentAnswers()` |
> | 2 | `stayBooked` never collected | `HomeView.tsx` collects it and sends `stayBooked: stayBooked \|\| null` in the payload |
> | 3 | Day ✨ opened the day-scoped window | Both entry points call `focus.open(dayIndex, "trip")` — `HomeView.tsx` and `trip/[id]/TripView.tsx` |
> | 4 | `ItineraryCard` got no `trip` prop on `/` | Passed as `trip={{ id: "preview", destination, startDate, endDate, budget }}`, the exact shape this doc prescribed. `ArrangeBoard` has since been replaced by `SplitEditor`, which takes the same prop |
>
> Kept rather than deleted for the merge-direction section at the foot, which is still the live
> question, and because "these type-check while doing nothing" is the failure mode worth
> remembering — none of the four would have been caught by `tsc`, `eslint` or the suite.
>
> **Everything below this line is the original 2026-08-23 note, left as written.**

---

Written 2026-08-23, checked against `origin/feat/ui-optimization` @ `67e77f1`.

Not a complaint about the merge — `d55e394` took `dev-aryan` at `b727d49`, and every one of
these landed after it. They are here because each one **type-checks and tests clean while doing
nothing**, so nothing will flag them on your side.

Three are the same shape: the reading half of a feature is on your branch and the writing half
isn't, so the plumbing looks healthy and no value ever arrives.

### 1. Accessibility is never collected

`deriveMobilityProfile` and `sanitizeAnswers` read `answers.accessibility`. On
`feat/ui-optimization` nothing sets it — `HomeView` has no controls for it.

Effect: a wheelchair user who reports high energy gets no accommodation, which is the exact case
`322eafe` existed to close. OSM's `wheelchair` tag is already in the Overpass response and is
discarded.

Fix: `dev-aryan`'s `HomeView` — `accessibility` state, `setAccess`, the "Getting around" block,
and `accessibility` in `currentAnswers()`.

### 2. `stayBooked` is never collected

Three live consumers — `sanitizeLogistics`, `formatTravelerProfile` ("Lodging is already booked:
… use it for every night instead of choosing one"), and `trip-context.md`'s `booked_lodging: …
already paid for, cost 0, every night`. `HomeView` hardcodes `stayBooked: null`.

Effect: skill §4e ("already booked beats anything you would recommend") has no input, and a
traveller with a paid hotel gets a different one chosen for them.

### 3. The day ✨ icon opens the wrong window

`onChatDay` opens `focus.open(dayIndex, "day")`. The day-scoped window looks identical to the
trip-scoped one but has no day navigation and a chat forbidden from touching other days, so it
reads as the same feature quietly not working. Both entry points were collapsed onto `"trip"`
scope; the day-scoped path stays in `FocusEditMode`/`buildChatEditPrompt` because it is a real
guarantee, just not one reachable from the UI.

### 4. `ItineraryCard` gets no `trip` prop on `/`

`ArrangeBoard` renders only when `boardOpen && trip && onItineraryChange`. You restored
`onItineraryChange` in your merge; `trip` is still missing, so the guardrail board has nothing to
render against on the result view. `trip={{ id: "preview", destination, startDate, endDate,
budget }}` — assembled from the form, since pre-save there is no trip row.

---

## The merge direction

We have crossed twice now: you merged `dev-aryan` at `b727d49` while this branch merged
`20eaf20`, and both of us re-resolved the same fifteen files independently. That produced a
`handleRearrange` defined twice — a duplicate that compiled fine on each side alone and only
broke where they met. No test would have caught it.

Worth agreeing one direction: either you integrate `dev-aryan` and this branch stops merging
yours, or the reverse, or both merge into a shared branch and never into each other. `dev-aryan`
@ `ba0aff2` currently contains all of `feat/ui-optimization`, so merging it your way should be
close to a fast-forward.
