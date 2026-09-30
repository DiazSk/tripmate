# Prompt for an outside design review

Upload the 22 PNGs from `docs/design-board/shots/web/` (they are named in reading
order), then paste everything below.

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

- **One Meaning Rule.** Jade `#28B981` means *action* and only action — never a label,
  never a figure. Gold `#E9B44C` means *money* and only money. Coral `#E4553F` means
  *alert / cannot happen*. A colour doing a second job is a defect.
- **One Slate Rule.** Every panel, pill, badge and sheet is `#1C1A18` at some alpha,
  on a single warm near-black ground `#121110`.
- **Round what you touch, square what you read.** Controls are pills; reading
  surfaces are square or lightly rounded.
- **A photograph is not a surface.** Only large type and tracked caps may sit on an
  image, and only over a measured scrim.
- **Type:** Melodrama (display serif) for mastheads and statements; the platform's own
  sans for all body and UI text (so Dynamic Type works); a tabular face for money,
  counts and dates.
- **Say only what is known.** This is the rule I care most about. The app must not
  assert what it has not checked — "Not checked" rather than a silent pass,
  "2 blockers *found*" rather than "2 blockers", "about 24 min" for an estimate,
  and no weather claim when there is no forecast.

## What changed in this cycle — aim here first

1. **Today** (screens `01-home-today`, `01b-today-offline`) was five rows of equal
   weight with no subject. It now leads with one spoken line — *Leave in 18 min* /
   *Leave by 8:25 AM* / *Free for about 3 hr* / *Leave now* — with the verb quiet and
   the figure loud. A vertical rail once joined the stop dots and was removed.
2. **The day list** (`09-trip-day`) lost the rules between stops, and the day's
   photograph now spans the full device width.
3. **Secondary actions** that were uppercase, letter-spaced jade text — a web link
   wearing a label's clothes — became slate capsules in sentence case.
4. **Share** moved from a shelf across the foot of the screen to an icon in the nav
   bar, opposite the back chevron; withdrawing a link is now a destructive button in
   a native alert.
5. **Sign-in** (`00-signin`) became a full-screen modal, and "Keep planning without an
   account" — previously grey body text — became a capsule.

## What I want back

For each point, cite the screen filename. Be concrete; "feels cluttered" is useless.

1. **Rule violations.** Every place a colour, shape or face breaks the system above.
2. **Over-claims.** Anywhere a screen states something more confidently than it could
   know. This is the highest-value finding you can give me.
3. **The first three seconds.** For `01-home-today` and `09-trip-day`: what does the
   eye land on, and is that the thing that matters? These are read one-handed, outdoors,
   while walking.
4. **Hierarchy failures.** Where two things compete, or where the most important thing
   is not the loudest.
5. **What is missing.** A question a traveller would obviously ask that no screen answers.
6. **The weakest screen**, named, with why.

## Constraints — do not suggest these

- No light mode. There is one ground and no light variant.
- No new accent colours; the palette above is the whole vocabulary.
- No custom font for body text — that would break Dynamic Type and Android scaling.
- No emoji or pictographs as interface elements.
- It must work offline from a cached copy, so nothing may depend on a live fetch.

Finish with the **three changes you would make first**, in order, and say what each
one costs.
