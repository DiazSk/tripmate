# Prompt for an outside design review

Upload the 22 PNGs from `docs/design-board/shots/web/` (they are named in reading
order), then paste everything below.

**This is round two.** The prompt tells the reviewer what its last pass changed, what
was refuted, and what was deliberately left — so it spends its attention on what is
new rather than re-reporting what has already been argued.

---

You are reviewing the mobile client of **TripMate**, a travel planner. I am the
designer. I want a hard, specific critique — not encouragement. Assume I can take it.

## What the product is

You give it a destination, dates, a budget and some preferences. A model writes a
day-by-day itinerary. You then read the plan, edit it by conversation, and — while
you are actually travelling — the app tells you what is next and when to leave.
There are 22 screens attached, in order: arrival, planning, the trip, changing it.

## The design system it is supposed to obey

Judge the screens against these rules, and tell me where they break them.

- **One Meaning Rule.** Jade `#28B981` means *action* and only action. Gold `#E9B44C`
  means *money* and only money. Coral `#E4553F` means *alert / cannot happen*.
- **One Slate Rule.** Every panel, pill, badge and sheet is `#1C1A18` at some alpha,
  on a single warm near-black ground `#121110`. **One stated exception:** a surface may
  carry a jade or coral tint to signal *state* or *alert* — exactly two tokens, capped
  at 16% alpha. A tint never signals action.
- **Round what you touch, square what you read** — for controls **in content**.
  Nav-bar items and row accessories follow the platform, which on iOS means text, so
  `Done`, `Close` and a row's trailing `Edit` are deliberately not capsules.
- **A photograph is not a surface.** Only large type and tracked caps over a measured scrim.
- **Type:** Melodrama (display serif) for mastheads; the platform's own sans for all
  body and UI text, so Dynamic Type works; a tabular face for money, counts and dates.
- **Say only what is known.** The one I care most about. No claim beyond the evidence:
  "Not checked" rather than a silent pass, "2 blockers *found*", "about 22 min" for
  anything computed, no weather claim without a forecast.

## What your last review changed

Every falsifiable claim you made was checked against the source. Most held and shipped:

1. **Estimates now say they are estimates.** `about 22 min by transit`, `about 16 min
   walking`, `adds about 3 min walking`. One helper owns the word and four surfaces
   read it from there. The `+3 min` → `adds` change also settles the ambiguity you named.
2. **`No requirements` → `Nothing noted`** on the review step, so it describes the
   record rather than answering for the traveller.
3. **Plan Health leads with the diagnosis.** `2 blockers found` takes the headline in
   coral; the score steps down beside it. With nothing blocking, the figure leads again.
4. **Sign-in's mode toggle is a capsule** — and reads `Create an account instead`,
   because a bare `Sign in` under a `Create account` primary was two plausible submits.
5. **The two tint exceptions are now written into the design system** rather than being
   rules the product quietly broke.

**Three of your findings were wrong, and you should know why before this pass:**

- *"The clock merely repeats the phone's."* It does not — it is destination-local. The
  board's throwaway fixture used the host timezone, so they agreed in that one frame.
- *"Today does not distinguish a booked next stop."* It does.
- *"The offline travel estimate is stale routing output."* There is no router. It is
  haversine distance times a circuity factor, recomputed every render, so it does not
  age and needs no offline caveat. Your underlying point — that it is an estimate —
  was right, which is why #1 shipped.

**Deliberately not done**, so do not re-report them as new: demoting Today's masthead
on an active trip, reducing gold's salience, muting the Review screen's `Edit` column.
Those are judgements about how a screen feels in the hand and are waiting on device
testing. Per-stop provenance, `Hours not verified` and `Actual spend not tracked` are
each their own cycle.

## Two things about the fixtures, so you critique the product and not my test data

- **`01-home-today` and `01b-today-offline` were captured just after midnight**, so the
  day's stops read 12:01 AM, 12:23 AM, 1:38 AM. That is the fixture's clock, not a design
  intent. Judge the hierarchy and the wording; ignore the hour.
- **`04c-saved-places` shows one saved place, in a different city from the trip.** That is
  real current data, and it happens to demonstrate the "Saved elsewhere" rule from the
  side where the heading correctly does not appear.

## What I want back

For each point, cite the screen filename. Be concrete; "feels cluttered" is useless.

1. **Rule violations** — including against the two new exceptions above. If an exception
   is being stretched past what it licenses, say so.
2. **Over-claims.** Anywhere a screen states something more confidently than it could
   know. Still the highest-value finding you can give me. Now that the obvious travel
   figures are hedged, look for the subtler ones.
3. **Did the hedging go too far?** `about` now appears several times on one screen in
   places. Is there a screen where it has become noise rather than honesty?
4. **The first three seconds** for `01-home-today` and `09-trip-day`: what does the eye
   land on, and is that the thing that matters? Read one-handed, outdoors, walking.
5. **Hierarchy failures** — where two things compete, or the most consequential fact is
   not the loudest. Check whether Plan Health's restack actually fixed that, or moved it.
6. **What is missing** — a question a traveller would obviously ask that no screen answers.
7. **The weakest screen**, named, with why.

## Constraints — do not suggest these

- No light mode. No new accent colours. No custom font for body text.
- No emoji or pictographs as interface elements.
- It must work offline from a cached copy, so nothing may depend on a live fetch.
- Do not suggest capsules for nav-bar items or row accessories; that is now a stated rule.

Finish with the **three changes you would make first**, in order, and what each costs.
