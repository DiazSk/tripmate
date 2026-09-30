# Estimates that stay estimates, and a design system that admits what it ships

## Context

An outside review read the 22-screen design board against this project's own rules rather
than against generic mobile taste. Its headline finding is that TripMate has become
disciplined about *source* uncertainty — `Not checked`, `2 blockers found`, `projected` —
while a few figures acquire false precision purely because the arithmetic that produced
them is exact.

Every falsifiable claim in that review was checked against the source before this spec was
written. Most held. Two did not, and both were artifacts of the throwaway fixture built for
the board shoot rather than defects in the product:

- **"The 8:13 PM clock merely repeats the phone's."** It does not. `today.tsx:95` reads
  `clockInZone(trip.timezone)`, so it is destination-local. The shoot's temporary trip was
  written with `timezone: 'America/Los_Angeles'` — the host's own zone — so the two agreed
  in that one frame. A real Kyoto trip reads 12:13 PM beside a 20:13 status bar.
- **"Today does not distinguish a booked next stop."** It does — `today.tsx:330` renders a
  BOOKED badge off `timeFlexibility === 'FIXED'`. The temporary trip had no booked stop.

**The lesson is about the board, not the reviewer.** A fixture that differs from real data
invents findings, and the reviewer cannot tell which is which. A future shoot should prefer
a real trip and say so where it cannot.

One further claim was refuted in a way that makes the underlying finding *stronger*. The
review assumed travel durations are routing output and therefore go stale offline, and asked
for an epistemic caveat on `Leave now`. `travelTime.ts` performs no fetch at all: it is
haversine distance times a 1.3 circuity factor over door-to-door average speeds, recomputed
from coordinates on every render. The number does not age, so `Leave now` is exactly as
reliable offline as online and needs no caveat. What it *is* — and always was — is an
estimate, which three surfaces fail to say.

## The defect, precisely

`travel-segment.tsx` already states the rule in its own docblock:

> "Every one of these is estimated — straight-line distance times a circuity factor, since
> there is no free transit router … The hedge belongs in the sentence."

Four surfaces render the output of the same function. One obeys that rule:

| surface | today |
|---|---|
| `travel-segment.tsx:71` | `Transit · about 14 min` |
| `today.tsx:229` | `22 min by transit` |
| `dayTravel.ts` `travelSummary` | `48 min walking · 14 min transit` |
| `addPlace.ts` `slotLine` | `+7 min walking` |

This is not a copy preference. It is one rule the repository set for itself and then broke in
three places, and the breakage matters most on Today, where an estimated input is transformed
into an exact-looking imperative.

## Decisions taken

| Question | Decision |
|---|---|
| Hedge the imperative too? | **No.** Hedge the input, keep `Leave in 18 min` crisp — see below |
| Jade-washed selected rows, coral-filled conflict rows | **The rules bend**: DESIGN.md gains a stated semantic-tint clause |
| Naked text actions (`DONE`, `CLOSE`, `Edit`) | **Platform slots are exempt**, in-content controls are not |
| Offline caveat on `Leave now` | **Not needed** — the estimate is local arithmetic and does not age |
| Hierarchy work on Today and the day screen | **Deferred** until after on-device testing |

**Why the imperative stays unhedged.** "Leave in about 18 min" weakens the one line that must
be obeyed while adding no information: the countdown is arithmetic against a clock the reader
can already see. The uncertainty lives in the journey estimate, so it is marked there. A
reader who wants to know how soft the number is finds the softness one line down, attached to
the thing that is actually soft.

---

## 1. One hedge, four call sites

`TravelLeg.estimated` is `true` on every leg this codebase can produce; there is no router and
no second path. An implementation that branches on that flag would be machinery pretending to
vary, so the helper is unconditional and its docblock records the condition under which the
branch should appear — the day a real router lands.

One export beside the arithmetic, in `src/lib/travelTime.ts` (shared, so both clients reach
it):

```ts
aboutMinutes(22) // "about 22 min"
```

| site | after |
|---|---|
| `today.tsx:229` | `about 22 min by transit` |
| `dayTravel.travelSummary` | `about 48 min walking` |
| `addPlace.slotLine` | `adds about 7 min walking` |
| `travel-segment.tsx:71` | unchanged in output; switched to the shared helper so one place owns the phrasing |

`+7 min` becoming `adds about 7 min` carries a second fix the review asked for: `+7 min` can
be read as seven minutes from an anchor, seven more than the current route, or seven added to
total travel. `adds` says which without a caption.

## 2. `No requirements` overstates what is known

`profileRows.ts:accessibilityValue` returns `No requirements` when neither toggle is set and
no note exists. What is known is that none were provided; whether this traveller has
accessibility requirements is not known. This is the same error `Not checked` exists to
prevent, one screen over.

It becomes `Nothing noted` — the exact wording `dietaryValue` already returns in its
equivalent branch, so the two hard-constraint rows finally agree. The docblock above it lists
`No requirements` as an example and is updated with it.

*Corrected during execution:* one helper, **one** surface. `accessibilityValue` has a single
caller, `plan/review.tsx:83`. The Profile tab imports `dietaryValue` and `interestsValue` only and
never renders accessibility needs, so the "Review and Profile" written here was wrong.

## 3. DESIGN.md admits two things the app already does

**A semantic tint on a surface.** `accentWash` is `#28B98117` and `alertSoft` is `#E4553F29` —
jade at 9% and coral at 16%. Selected planning rows and conflict rows therefore carry tinted
surfaces, which contradicts One Slate as written, and the jade case also puts an action colour
on a *state*. The decision is that the rules bend: these are legitimate signals and the UI
reads well. The clause must be narrow enough to stay a rule:

- it names the two tokens explicitly rather than permitting "a semantic tint" in general,
- it caps the alpha at **`29` hex (16%)**, which is `alertSoft` today and therefore the
  darkest tint currently shipped — so the clause licenses what exists and nothing heavier,
- it states that a tint signals state or alert and never action, which keeps One Meaning
  intact for jade in its ordinary use.

**Platform slots are not in-content controls.** `DONE`, `CLOSE` and Review's `Edit` column are
naked text, which contradicts "round what you touch". They are also exactly what iOS puts in a
nav bar and a row accessory — a capsuled `DONE` would look wrong on the platform this app
otherwise defers to. The clause states that the rule governs in-content controls and that
nav-bar items and row accessories follow the platform. `LIST / MAP` needs no exemption: it is
already a segmented control in a slate trough.

## 4. `Create an account` becomes a capsule

It is in-content prose, so the exemption above does not cover it. It is currently the second
half of a sentence ("New here? Create an account"), and half a sentence cannot be a capsule,
so the sentence goes and a `PillButton` carries the alternating label — `Create an account`
or `Sign in` depending on mode.

This stacks two capsules in a column with `Keep planning without an account`. **That is the
risk in this item**: two capsules of equal shape can read as two actions of equal weight when
one is a mode toggle and the other is the way out. It is verified on device, and reported
honestly if it reads wrong rather than being declared fixed.

## 5. The address the app already has — WITHDRAWN, the premise was false

*Corrected during execution, 2026-09-29.* This section claimed `types.ts:524` declares
`address?: string` and nothing renders it. The field is real but it is on **`FoundPlace`**, the
add-place search result — not on `Stop` — and `add-place-sheet.tsx:345` already renders it. `Stop`
has no address and never had one; `tsc` proved it (TS2339) the moment the task was attempted.

The underlying want stands: a name is enough to read and not enough to hand a taxi driver, and
that happens offline and under time pressure. But it needs the field added to `Stop` and populated
at generation or by a POI lookup, which is data-model work belonging to the provenance/POI cycle
below rather than a display fix. **The task was dropped rather than a field invented.**

## 6. Plan Health leads with the diagnosis

The score is the most immediate visual conclusion on a screen whose entire purpose is
diagnostic. A reader can glance at `84`, conclude "good enough", and leave without reading
two blocker-class findings. Severity outranks an aggregate.

Conditional, because the right answer depends on what was found:

- **blockers > 0** — the count leads, in coral; the score is demoted to `84 across checked`.
- **no blockers** — the score leads, because nothing outranks it.

Colour is unchanged. The existing docblock's reasoning about why the score is neither jade nor
gold still holds and is not touched; this is hierarchy only.

---

## Out of scope, deliberately

**Waiting on the device session**, because they are judgements about how a screen feels in the
hand and the board has just demonstrated what happens when such calls are made from
screenshots: demoting Today's masthead on an active trip, reducing gold's salience on the day
screen and on conflict rows, muting Review's `Edit` column.

**Their own cycles**: per-stop provenance, so sourced fact, computed figure and model-written
characterisation stop arriving in one undifferentiated voice; `Hours not verified` on
add-place rows, which needs that provenance to exist first; `Actual spend not tracked` on past
trips.

## Verification

- **Unit.** `addPlace.test.ts:209-211`, `dayTravel.test.ts:46` and `profileRows.test.ts:67,73`
  all assert the current strings. Updating those expectations *is* the check for sections 1
  and 2 — a regression re-breaks them. `cd mobile && npx jest`.
- **Types and lint.** `npx tsc --noEmit` and `npx expo lint` in `mobile/`; `npx tsc --noEmit
  -p tsconfig.json` and `npm run lint` at the root, since `travelTime.ts` is shared.
- **Not unit-tested, and said plainly.** Section 6's branch is presentational and nothing in
  this suite renders. It is verified on device in both states rather than asserted.
- **Device.** The four travel surfaces read as estimates; the sign-in capsule stack; the
  address row on a stop that has one and its absence on a stop that does not; Plan Health with
  blockers and without.
- **Board.** Sections 1, 4, 5 and 6 change shots already committed. Re-shooting is follow-on
  work, not part of this cycle.

## Tasks, in order

1. `aboutMinutes` in `src/lib/travelTime.ts`, with the docblock recording why it is
   unconditional.
2. Adopt it in `travel-segment.tsx`, `today.tsx`, `dayTravel.travelSummary`,
   `addPlace.slotLine`; `+N` becomes `adds`. Update the three test files.
3. `accessibilityValue` returns `Nothing noted`; update its docblock and tests.
4. DESIGN.md: the semantic-tint clause under Colors → Named Rules, the platform-slot clause
   under Shapes.
5. `signin.tsx`: the mode toggle becomes a `PillButton`.
6. `day-page.tsx`: render `address` in the expanded stop when present.
7. `plan-health.tsx`: blockers lead when there are any.
