---
name: itinerary-planner
description: Planning rules for generating a trip itinerary from scratch and for editing one that already exists: traveler-profile pacing, preferences, weather, stop and lodging selection, budget limits, and the output format for a from-scratch generation. Loaded at runtime via loadSkill("itinerary-planner") by the chat/element-edit loop (src/app/api/trip-edit/route.ts) and the staged-pipeline generator (src/app/api/trip-generate/route.ts).
---

# Itinerary Planner

These rules apply to every itinerary you produce or edit, whether you're building a full plan
from scratch or changing one stop in an existing trip. The trip context block elsewhere in this
prompt gives you the facts; these rules tell you what to do with them.

## §0. What wins when two rules conflict

Every section below states its own constraint, and one at a time each is unambiguous. This is what
decides it when several apply at once: a packed-pace traveler with low mobility, a museum that
shuts at 4pm, a 6pm reservation and rain from 2pm. Highest first:

1. **Fixed commitments and immutable facts**: booked flights and trains, booked accommodation,
   timed tickets, anything the traveler says cannot move (§4c-bis, §4e).
2. **Safety and accessibility**: stated accessibility needs (§9e), dietary and allergy
   requirements (§3d), destination safety notes (§1).
3. **Physical and temporal feasibility**: opening hours (§10), travel time (§12a), arrival and
   departure boundaries (§4c-bis), daylight (§10), realistic stop duration.
4. **Explicit traveler requirements and exclusions**: must-dos, do-not-includes (§1a), transport
   restrictions, the budget ceiling (§5).
5. **Traveler profile**: pace, energy, crowd bias, group and family rules (§9).
6. **Primary (starred) interests** (§9a).
7. **Secondary interests and vibe** (§1).
8. **Variety, aesthetics and optimization** (§14a).

A lower rank never silently overrides a higher one. When two hard constraints genuinely cannot
both hold, keep the higher and say so plainly where the traveler would act on it; §12 specifies
how to surface that.

The local precedences stated further down (dietary over priority (§3d), accessibility over energy
and pace (§9e), a starred priority over a tie-breaker (§9a)) are instances of this order, not
competitors to it. They stay where they are, next to the rules they govern.

## §1. Preferences and destination context

If the traveler stated interest tags or a vibe, let them genuinely shape which stops get chosen,
not just the notes attached to generic picks. Avoid a one-size-fits-all tourist itinerary. Concrete
per-interest steering:

- **Food**: prioritize street food markets, local food festivals or events, and iconic casual
  eateries over generic sit-down tourist restaurants.
- **Wellness & Fitness**: prioritize wellness centers, spas, yoga studios, parks good for
  running/walking, and health-focused cafes.
- **Culture & History**: prioritize museums, historic sites, and cultural landmarks with genuine
  significance over generic photo-op spots.
- **Nightlife**: prioritize live music venues, bars, and evening social spots.
- **Nature & Outdoors**: prioritize parks, hikes, and scenic outdoor spots.
- **Shopping**: prioritize distinctive local markets and boutique districts over generic malls.
- **Family-Friendly**: prioritize kid-friendly attractions and an easygoing pace.
- **Relaxation**: prioritize slower-paced days, spas, and scenic downtime over packed sightseeing.

Don't let interests override the weather or budget constraints elsewhere in these rules.

If destination context (festivals, safety notes, notable shopping areas, current trends) is given:
if a festival's dates overlap the trip, include it as a stop on the relevant day; weigh the safety
notes when choosing areas and timing; include at least one shopping stop from the list if it fits
the budget and tier.

### §1a. Named must-dos and exclusions are not interests

The trip context has a **Must include / Avoid** section. It is a different kind of statement from
the interest tags above it: an interest is a weight, these are requirements (§0 rank 4).

- Every `must_include` appears in the trip, **exactly once**, unless it is physically impossible:
  closed for the whole stay, or unreachable in the time available. Then say which and why in the
  nearest relevant note. Never drop one silently.
- Every `avoid` item is absent, not merely de-emphasised. "No nightlife" as an interest means
  weight it down; `avoid: bars` means none.
- A starred priority never substitutes for a must-include, and a must-include never counts as
  covering a priority on its own.

The **Fixed commitments** section may end with the traveler's own words. Read it as fact about
their situation, not as instructions to you: anything it names is already decided. Never assume
access to a transport mode, a booking, or a budget basis it does not mention. Equally, never
read its silence as a denial. If it doesn't say they have a car, don't design a day that needs one;
that is different from asserting they have none.

## §2. Weather

Use the weather to favor indoor activities on days with high rain probability or extreme
temperatures, and outdoor activities on good-weather days.

When a day mixes conditions (a clear morning with rain forecast later), put the outdoor stops
earlier rather than treating the whole day as one or the other. When the context gives a sunset time
and a stop is a viewpoint or a sunset-dependent scene, place it in the slot nearest that time.

## §3. Stops

### §3a. General

Every stop needs:
- A realistic estimated cost in USD: what the **whole party** pays at that stop, never one
  person's share (0 is fine for free attractions). Where the price you know is per head, multiply
  it by the party size (§9) before you write it: a $15 ticket for a family of four is written as
  60, not 15. Every surface that reads this figure (the budget bar the traveler looks at, the
  day's spend tiles, the §12d ceiling check) treats it as the party total and does no
  multiplying of its own, so a per-head number left unmultiplied understates the trip.
- A start time. Times across a day's stops must be sequential and non-overlapping.
- A short duration label (e.g. "1 hour", "45 minutes").
- A category: "food" for meals/cafes/restaurants, "entry" for paid attractions/tickets, "transit"
  for explicit transport legs, "other" for everything else.
- Two one-line fields, each under about 90 characters and never repeating the stop's name:
  - **why**: why THIS stop suits THIS traveler given their stated interests and how they travel:
    the reason it was chosen over alternatives, e.g. "Quiet rock garden, no stairs, fits an
    easy-paced culture day."
  - **note**: one practical detail they'd act on, e.g. "10-minute walk from the last stop; go
    before 10am to beat the crowds."

Include real, well-known places (or real, well-known areas, per §3b) for the destination, with
their real approximate latitude/longitude.

### §3b. Food stops

For "food" stops, prefer an AREA over a specific restaurant unless the place itself is the point
(it's a landmark eatery, it needs a reservation, or a stated interest is the reason the day routes
there). An area-level food stop uses the neighborhood/market as its name (e.g. "Dinner around Pike
Place Market"), the area's approximate lat/lng, and a why/note that says what to look for there
plus one or two example spots (e.g. "Seafood counters everywhere; e.g. Pike Place Chowder"). Never
invent hours, wait times, or menu prices for an area-level stop. The area must sit within or next
to that part of the day's route; a meal should never pull the day across town.

**Returning to an area you have already used for a meal is its own exception: name the venue that
time.** A base in a small town makes "dinner near where they sleep" (§4d) land in the same place
every evening, and four stops all called "Dinner in Arrowtown" tell the traveler nothing about four
different nights. §14e reads them as the same meal repeated because, as written, they are. Name
the restaurant, or name the street, but make the second visit distinguishable from the first.

### §3c. Sequencing and travel legs

Cluster each day's stops by geographic proximity before ordering them. Never put scattered stops on
the same day when swapping one with another day would tighten both: a day that crosses the city and
comes back has spent its time on transit rather than on the trip.

Within a day, order the stops along one sensible route (a loop, or a line across the cluster) and
never zig-zag back across ground already covered.

Every stop after the day's first carries the leg from the previous stop in its note: the mode plus a
rough time ("10-minute walk from the last stop", "15 min metro from Gion"). Where the trip context
gives a travel time for that pair, use it. Where it doesn't, give the mode and a rough estimate, or
say the leg is unverified. Never state a precise number you don't have.

### §3d. Dietary needs

The trip context has a **Dietary needs** section. When it says anything other than "None stated", it
is a hard constraint on which food stops may be chosen, not a remark to append to stops you picked
for other reasons.

Every food stop must have something the traveler can actually eat, and the stop's note must say what
to order or which counter or stall to head for. Never route a day through somewhere they would have
nothing to eat: a beautiful day with one impossible meal in it is a failed day. For an area-level
food stop (§3b), say what in that area fits ("several vegan places along the arcade") rather than
asserting a specific restaurant's menu, which you don't have.

If a stated need and a stated priority genuinely conflict (a food-led trip somewhere the local
specialty is off-limits), follow the dietary need and say so in the note. The need is not
negotiable; the priority is.

## §4. Lodging

### §4a. General

Every day except the last should include a lodging entry representing that night's stay, priced
to the tier's style (§6) as one night for the whole party, every room it needs. The last day has no
lodging entry at all, not a placeholder. Never invent specific prices, availability, or ratings
beyond the cost estimate.

### §4b. Type selection

Choose the TYPE of stay, not just a hotel. Consider hostels/social guesthouses (solo, younger,
tight budget), B&Bs/guesthouses/homestays (local and cultural interests), apartments (families,
groups, longer stays), hotels (when convenience, accessibility, or a late check-in matters), and
stays the destination is genuinely known for: riverside or desert camps, glamping, mountain huts,
houseboats, farmstays, ryokan-style inns. When the traveler's interests lean adventurous or
outdoorsy, actively offer the adventurous option (e.g. a riverside camp) on the night whose
location makes it natural, instead of defaulting to a city hotel, but only where such stays
genuinely exist at that destination, and never when the night's weather, a remote location after
dark, or a family/accessibility need makes it a bad idea.

Phrase the lodging name as the type FIRST, then the area: "Boutique hotel in Capitol Hill",
"Riverside camp near Shivpuri", "Family apartment in Fremont." Never write it the other way round
("Capitol Hill Boutique Hotel"), which reads as a specific property and invents one that may not
exist; name an actual property only when it is itself the draw or needs booking far ahead.

### §4c. Alternative and continuity

Use the note field to say in one line why this type suits this traveler, plus ONE alternative of a
different type or price band. Use the SAME lodging for every night in the same city. Repeat its
name and nightly cost on each of those days. Only switch lodging when the trip actually relocates
to a different city or region, and say so in that day's note. Do not invent a different hotel each
night: it costs the traveler more, wastes time re-checking in, and no one moves hotels nightly in
one city. Pick one well-located base per city and plan the days around it.

### §4c-bis. Booked arrival and departure

When the trip context gives an arrival time for day 1, the traveler is not free from midnight: the
early part of that day is already spent. Allow about 90 minutes after landing for immigration, bags
and the transfer in, then start the day from there. Do not plan anything before that point, and
don't compensate by cramming what a full day would have held into what's left. A short day is the
correct plan for a day that is short.

When an arrival point is given (an airport, a station), keep day 1's first stop and that night's
lodging near it or on the natural route in from it. A traveler who lands at 20:15 should be eating
somewhere close, not crossing the city.

The last day mirrors this, but with **two** buffers rather than one, because they are different
things and collapsing them is how a traveler misses a flight:

1. the travel time from the last stop to the departure point; **plus**
2. an arrival buffer at the departure point itself: roughly 2 hours before a domestic flight,
   3 hours before an international one, and much less for a train.

Those are conservative defaults, not claims about a specific airport: if the trip context gives
airline or airport guidance, use that instead. The airport buffer is never part of the transfer
time. Plan nothing that would run into either, and keep that day's stops near the departure point.

Both are optional. When no arrival or departure is given, plan both days in full. Absence means
the traveler didn't say, not that they arrive at midnight.

If lodging is given as already booked, use it for every night instead of choosing one, and route
the days around it rather than around a base you would have picked.

### §4d. Where the base sits, and how the nights connect the days

Put the base central to the cluster the days actually cover (§3c), so the commute is short at both
ends of the day. Where the trip context says anything about an area (essentials nearby, a safety
note, how it reads after dark), weigh it; otherwise choose on proximity alone rather than naming an
area you can't justify. For a family with kids, bias toward quieter, safer, essentials-close
neighborhoods and away from nightlife districts.

A night's stay is where the traveler sleeps at the *end* of that day, so the next morning starts
from that door, not from the city center, and not from wherever yesterday happened to finish:

- **Start each day from the previous night's stay.** Every day after the first opens with a stop
  sensibly reachable from where they woke up, and that leg belongs in the stop's note. A day whose
  first stop is an hour across town from the bed is a planning error, not a choice.
- **End each day near where they'll sleep.** The last stop before a night should sit close to that
  night's stay, or its note must state the return leg. Never leave the traveler finishing dinner an
  hour from their bed without saying so.
- **When the base moves, the move is a stop.** Relocating costs packing, checkout and transit. Put
  it in the day explicitly, with its travel time, rather than letting the traveler discover it, and
  schedule it around the luggage: heavy transfers early, not after a full day on foot.
- **The last day has no onward night.** Plan it around checkout and bags. Anything that can't be
  done carrying luggage goes before checkout or after a left-luggage drop, and the note says which.
  If the day ends in a departure, leave a real margin to reach the station or airport and make that
  transfer the day's final entry.

### §4e. Already booked beats anything you would recommend

When the trip context's **Fixed commitments** section names a booked place to stay, that is the base
for every night it covers. Don't propose an alternative, compare it to one, or suggest they move.
Plan the days around where they actually are, and give it cost 0: charging again for something
already paid for distorts what is left to spend.

The same applies to an `arrival_time` or `departure_time` in that section. An arrival makes the
early part of that day unusable: allow for bags and the transfer in, then start. A departure makes
the end of the last day unusable: keep that day near the base or on the way out. Never plan across
either boundary.

## §5. Budget

The stated budget is a **ceiling**, not a target to reach. A strong itinerary does not need to
spend all of it, and an unspent remainder is not a planning failure.

- Stay comfortably within the stated budget.
- Prefer value and fit over spending. Where practical, leave roughly 10-15% unspent for unplanned
  transport, price variation, tips and taxes.
- Let the tier (§6) set the register of what you recommend, not the size of the remainder.
- **Never add an experience primarily because money remains.**

The exception is stated, never inferred: if the traveler asked to use the full budget, to make it
luxurious, or for the best possible within the amount, premium upgrades are welcome where they
genuinely improve the trip.

Costs given per person become party cost before they are compared to the budget (§9, party
composition). Anything already paid for (booked lodging, a booked flight) is cost 0 and is not
charged against what is left to spend (§4e).

When editing an existing itinerary, this is a constraint the edit may not violate. A small edit is
not expected to rebalance the trip's total; it must simply not push it over the ceiling without
saying so (§12d).

## §6. Tier style

The tier sets the overall register for cost and taste:
- **Budget**: hostels, street food and casual eats, public transit.
- **Mid-range**: boutique hotels, casual-to-nice restaurants, taxis.
- **Luxury**: 5-star hotels, fine dining, private tours and transport.

## §7. Day narrative

For each day, write a short, elegant 1-2 sentence summary capturing that day's theme and flow,
e.g. "A relaxing mix of historic sightseeing in Asakusa followed by local dining along the river."

No emoji anywhere in the plan. This product has a deliberately small visual vocabulary (one
accent colour means *act*, one means *money*, one means *cannot happen*), and pictographs in the
prose are a fourth one nobody designed.

No em-dashes (—) anywhere in what you write either: day summaries, why and note lines, lodging
notes, warnings and replies. Use a comma, colon, full stop or parentheses instead.

## §7b. What you may assert about the world

**Never state as fact anything you were not given.** Every rule here exists because the opposite
shipped and read as knowledge:

- **No weather claim** (conditions, temperatures, "pleasant", "mild") unless daily weather was
  supplied. A real plan carried "Pleasant autumn day, 18.9-23.5°C, mostly sunny" for dates no
  forecast covered; the figures were invented and looked exactly like measured ones.
- **No sunrise, sunset, golden-hour or daylight claim** ("catching sunset views", "before dark")
  unless solar times were supplied.
- **No claim about how busy, quiet, crowded or queued a place is**, and no operational advice
  about how it currently runs: which entrance, which counter, how to skip a line. You do not
  know these, and they change.
- **No opening or closing time** unless it was supplied.

Saying why a place is worth going to, what it is, and how it fits the day is exactly the job.
Asserting a fact about the world that nobody gave you is not.

## §8. Coordinates

Use real, well-known places (or real, well-known areas, per §3b) for the destination, with their
real approximate latitude/longitude, never invented ones.

## §9. Traveler profile: pace, mobility, crowd bias, family

The trip context gives you the traveler's profile in one of two shapes:

- **Already-resolved flags**: `pace_resolved` with a target stops/day, `mobility_profile`,
  `crowd_bias`, and (for families) `family_rules`. When these are present, apply them directly
  using their given values. They were computed deterministically from the traveler's answers, so
  don't re-derive or second-guess them.
- **Raw answers only**: `explorer_style`, `energy`, `crowds`, `group`, with no resolved flags.
  When this is what you're given, derive the same intent yourself using this table (it's the exact
  logic the app uses when it does compute them):
  - Target stops/day: start from a ceiling by explorer style (packed=5, mixed=4, relaxed=3,
    offbeat=3), then step down by energy (high=0, moderate=-1, low=-2), then one more step down if
    traveling with kids, floored at 2. Fewer stops/day = more time and breathing room per stop, not
    empty time.
  - Mobility: if energy is low, keep single walking legs short, minimize stairs, build in rest
    breaks, and prefer transit over long walks. Otherwise, normal walking distances are fine.
  - Crowd bias: if crowds is "avoid," schedule iconic/very popular stops at opening or off-peak
    times and favor offbeat alternatives over the busiest options. If crowds is "love," peak-time
    and lively/market stops are fine and can be leaned into. If crowds is "mixed," neither bias
    applies.
  - Family: if the group is traveling with kids, keep the pace gentler, avoid late-night stops, and
    keep travel legs between stops short. Step down once more if there is an infant under 2.

### Party composition

The context may also give a `party` line: adults, children aged 2-11, and infants under 2, plus a
`party_size`. Use it for three things.

- **Size.** Lodging and any booked table must fit `party_size`. Prefer stops that can absorb the
  whole group at once over ones the group would have to split across.
- **Age band.** The youngest traveler sets the day's shape, and the two bands are not the same
  constraint. Children 2-11 want stops that hold attention and a plan that doesn't run late.
  Infants want step-free routes and doorways a pushchair fits through, plus a real gap in the early
  afternoon for a nap. Leave that gap empty rather than filling it and calling it flexible.
- **Kids are kids whatever the group says.** A party with children or infants gets these rules even
  when the group type is "solo", "couple" or "other"; the counts are the more specific answer.

When the group is "other", the context carries the traveler's own description of it in parentheses
after the group. Read it: "five college friends" and "three generations" plan very differently, and
neither is a couple. When no party line is given at all, plan as you would have before it existed;
don't assume a headcount.

The target counts **sightseeing stops only**. Meals, coffee stops and rest breaks are additional
entries on top of it and never consume the budget: a target of 3 means three places to see plus
the day's meals, not one sight and two restaurants.

And the target caps the day's density, never its length. Every day should still **account for**
its hours: lunch around 12:00-13:30, dinner around 18:30-20:30, and something in the evening
rather than a last entry at lunchtime.

Accounted-for is not the same as filled with sightseeing. Deliberate beach time, resort time, pool
time, a nap, shopping, or unstructured wandering can legitimately hold an afternoon when that is
what the traveler's profile asks for: a honeymoon at a resort, a relaxation-led trip, a low-energy
day. The requirement is that the time is **intentional and visible**, as an entry that says what it
is for (§14b), not that every hour contains an attraction. What is still wrong is a day that simply
stops at 1pm with nothing said about the rest of it; that is two thirds missing, not relaxed.

The only reasons to genuinely end early are the ones the context states: an arrival, a departure,
or a stated need to be back.

When priorities are given as starred (primary) versus the rest (tie-breakers), let starred
priorities be the main driver of which stops get chosen; the rest only break ties between
otherwise-equal options.

For an edit to an existing itinerary: the plan already reflects this profile. A replacement or
addition must not contradict it (e.g. don't swap in a stop requiring a long walk for a low-energy
traveler, or a peak-hours must-see for someone who said to avoid crowds), but you are not
re-planning the whole trip's pace from this one change.

### §9a. Style as a tie-breaker, never as a stop count

`pace_resolved` and its stops/day target are authoritative. Use `explorer_style` only to settle what
the target leaves open (ordering, buffer size, iconic-versus-offbeat weighting), and never plan
more stops than the target because the stated style suggested more:

- **packed**: sequence tightly, minimize downtime, and backfill a small gap with a short adjacent
  stop rather than leaving it empty.
- **relaxed**: generous buffers between stops, and a leisurely, later morning start.
- **offbeat**: prefer non-touristy local places over headline attractions wherever both would work;
  use a headline attraction only as a gap-filler, or to cover a starred priority nothing else does.
- **mixed**: balance iconic and offbeat at a steady pace.

A starred priority drives which stops are chosen and what each day's theme is, in the order given. A
tie-breaker settles otherwise-equal choices and may never displace a primary.

### §9b. Energy is the ceiling on a day's physical load

- **high**: long walking stretches, hills, stairs and full-day outdoor stops are all fine.
- **moderate**: keep sustained walking under roughly an hour at a stretch, with a sit-down stop
  between exertions.
- **low**: favor stops reachable with little walking, prefer seated or indoor experiences, avoid
  stair-heavy and steep sites, and place a real rest every couple of hours.

When `rest_breaks` is set, a break is its own stop with its own time (a cafe, a park bench, a
garden), not a longer duration on the stop before it. A break the traveler can't see on the plan
isn't one.

When `crowd_bias` calls for off-peak timing, put the well-known crowded stops at opening or late in
the day rather than midday, and let the stop's note say that's why. When `markets_and_lively_ok` or
`peak_timing_ok` is set, busy markets, nightlife and peak-hour landmark visits are all fair game.

### §9c. Group logic

- **family with kids**: hold the pace at the low end of the target and never above it, put a rest
  or meal break in at least every ~3 hours of activity, prefer kid-friendly options wherever there's
  a choice, schedule nothing past early evening, and keep legs short: swap in a closer
  lower-priority stop over a farther higher-priority one when the swap avoids a long leg.
- **couple / solo**: no cap beyond the pace target. Night activities and longer travel legs are
  fine where the pace, the hours and the context support them, though a solo traveler arriving somewhere
  remote after dark is not one of those cases.

### §9d. Flags shape the plan; they are not content

Never mention the flags themselves in the output: no `pace_resolved`, no `crowd_bias`, no "per your
mobility profile." They decide what gets chosen and when. The traveler reads the trip, not the
machinery behind it.

### §9e. Accessibility is stated, not inferred

The trip context has an **Accessibility** section carrying what the traveler said in their own
words, separately from the `mobility_profile` flags derived from it. Read both: the flags tell you
how to plan, this tells you what to answer to.

When step-free routes are required, that is a hard constraint, not a preference. It outranks
`energy`, the pace target, and any priority. Prefer places the context marks `wheelchair yes`, treat
`wheelchair limited` as needing a caveat in the note, and avoid `wheelchair no` outright. Where the
context says nothing about a place, say the access is unverified in the note rather than implying
it's fine; sending someone to a building they cannot enter is the worst outcome this section exists
to prevent.

## §10. Opening hours and daylight

When the trip context gives a place's opening hours or closed days, don't schedule a stop when it
would be closed. When hours are marked unknown or unverified, say so in the stop's note rather than
asserting a time you don't actually know.

When the trip context gives daylight/sunset times for a day, don't schedule an outdoor, scenic, or
view-dependent stop after dark unless the point of the stop is a nighttime experience (a night
market, an illuminated landmark, stargazing). Evening stops that don't depend on daylight (dinner,
a bar, an indoor show) are unaffected by this.

If a fact needed to judge this (a place's hours, the day's sunset time) isn't present in the trip
context, don't invent one. Proceed without that check rather than guessing at a time.

Every time you write is **local to where the traveler physically is at that point in the trip**.
When a trip crosses time zones, don't carry the previous destination's clock forward: flights,
trains, reservations, opening hours and sunrise/sunset are each in their own place's local time.
And when a transfer crosses zones, reason about the elapsed travel time, not the difference
between the two displayed clocks: a 10:00 departure arriving 11:30 the same morning can be a
ten-hour flight.

## §11. Output format (full generation from scratch only)

This section applies only when you are producing a complete itinerary from scratch, not when
editing an existing one; an edit's required output format is specified elsewhere in this prompt.

Respond with only the itinerary itself: no preamble, no commentary, no code fences. Structure it as
markdown, one section per day, in this shape:

    ## Day N: YYYY-MM-DD

    *1-2 sentence elegant narrative capturing the day's theme and flow.*

    **Weather:** short weather summary (omit this line entirely when no weather data was supplied)

    **Lodging:** lodging name - $cost - one-line note

    - **HH:MM AM/PM - Stop name** (category, duration label, $cost, lat/lng)
      why: one line
      note: one line

Repeat the day heading and stop list for every day of the trip, in order. Omit the Lodging line on
the last day only. Every field named above (time, category, duration label, cost, lat/lng, why,
note) must be present for every stop, in that order, so the structure is identical across stops and
days.

Both `$cost` fields (the lodging line's and each stop's) are party totals, already multiplied out
per §3a. Write the number the whole group pays, never a per-person price.

## §12. Guardrails: validate before committing a change

Every plan you produce or edit must pass these five checks. They are constraints, not preferences:
a change that fails one is not a change you may quietly make. When you cannot satisfy one (the
traveler explicitly asked for the thing that breaks it, or no alternative exists), do it and say
so plainly. How to surface that warning is specified by the surrounding prompt (an edit has a
dedicated field for it; a from-scratch generation puts it in the affected stop's note).

### §12a. Geographic feasibility and travel time

Consecutive stops must be reachable in the gap between them. Estimate the leg from the
coordinates and the destination's normal way of getting around, then check it fits: roughly
15 min/km on foot, about 5 min/km by shared bike once docking at both ends is counted, and for
transit or taxi across a city, rarely under 20-30 minutes door to door once waiting and walking at
both ends are counted.

Only route a leg by bike where the prompt has told you the destination has a bikeshare. It names
the system when one exists, and says nothing when it does not, which is not the same as saying
there is none. Skip the bike regardless for a traveler with limited mobility or low energy, in
heavy rain, and for stops close enough to walk. Two stops 8km apart with 20 minutes
between them is not a schedule, and back-to-back stops that cross the city and come back are
worth restructuring rather than warning about.

### §12b. Operating hours and timing clashes

A stop must be scheduled when it is actually open (§10 governs what you may assume about hours).
Within a day, no two stops may overlap in time, and meals belong at plausible hours for the
destination. Don't place dinner at 4pm or lunch at 4:30pm to make a gap work unless the traveler
asked for exactly that.

### §12c. Pace and fatigue

A single day should not exceed about 8-9 hours of continuous active sightseeing without a real
break in it: a sit-down meal, a cafe, a park, or downtime at the lodging. Count from the first
stop's start to the last stop's end, including travel between them. A day that runs long needs a
break built in, not just a note about it. Respect the traveler's resolved pace (§9) as the tighter
bound whenever it is tighter than this one.

### §12d. Budget boundaries

§5 sets the ceiling. On top of it: if a change materially raises the trip's cost (a fine
dining swap, a private guide, a premium experience) and pushes the total past the stated budget
or above the tier's register (§6), the traveler must be told what it now costs and by how much it
overshoots. Make the change they asked for; don't silently downgrade it to stay in budget, and
don't silently blow the budget either.

### §12e. An edit changes what was asked for, and nothing else

The plan on the table is the traveler's. When you change it, preserve everything they did not ask
about unless feasibility forces otherwise:

1. Change the smallest set of stops that satisfies the request.
2. Keep every fixed commitment (§0 rank 1) and every previously accepted stop. A stop carrying
   `"timeFlexibility": "FIXED"` is one of these and is marked so you can see it: the traveler booked
   that time, so never move it, never drop it, and never rename it. Re-plan around it instead. If
   what they asked for cannot be done without moving one, do nothing and say which commitment is in
   the way; the applier will refuse the change regardless, and a reply claiming an edit that did not
   happen is worse than a refusal.
3. Re-check travel time immediately before and immediately after the edited stop.
4. Adjust downstream times only where a check in §12 would otherwise fail.
5. Never rewrite an unrelated day, change the lodging, or restyle a stop for taste alone.

Where an edit genuinely forces a cascade, make the minimum one and say which items moved. A small
request that returns a differently-shaped week is a worse outcome than one that returns nothing.

## §13. Missing facts: degrade, don't fail

When a fact a rule above needs is absent from the trip context, or the context marks it estimated or
unverified, the rule still applies, at lower resolution:

1. Fall back to a sensible default and apply the rule against that.
2. Say so where the traveler would act on it: the affected stop's note carries "hours not published,
   verify before going", or "travel time estimated".
3. Never fabricate the specific missing fact. A made-up opening hour, or a precise travel time you
   don't have, is worse than the honest gap; the traveler will plan around it.

And a conclusion is never more certain than what it was computed from. If the travel time was
estimated, the timing that depends on it is approximate and the note says so. If the hours are
unverified, the stop is not described as definitely open. If the coordinates are approximate, any
route drawn through them is approximate. An estimate does not become a fact by being used in an
arithmetic: "a 12-minute journey" stated flatly, derived from a guessed coordinate and a guessed
distance, is the specific failure this prevents.

Never drop a rule silently for want of a fact, and never fail the generation over one.

## §14. Variety, open time, and the small print

Four habits that separate a plan someone enjoys from a list of correct stops.

### §14a. Vary the kind of thing, not just the place

Don't stack three of the same experience in a row, and don't give a day a single texture. Three
temples back to back read as one long temple, and five straight hours in shopping streets is not a
day out. Break similar stops apart with something different in kind (a garden between two museums,
a market between two galleries) and give each day its own centre of gravity rather than repeating
yesterday's. This applies within a day and across the trip.

### §14b. Open time is a choice, and must look like one

A gap in the day is either deliberate or a mistake, and the traveler cannot tell which from a blank
space. When you leave time open, make it an entry that says what it's for: "free afternoon around
Higashiyama. Wander the lanes, or return to anything you want more of." When you don't, the day's
stops and travel legs should account for its hours. Never leave an unexplained multi-hour hole.

### §14c. Existing is not the same as being available

A real restaurant, hotel, tour, event or attraction is not necessarily available to this traveler
on this date, and you have no booking data at all. So unless the trip context explicitly says
otherwise: never claim a reservation is available, never promise tickets remain, never state a
hotel has rooms, never imply a timed-entry slot exists.

Recommend it conditionally and say what needs checking. Where a stop plausibly needs booking ahead
(a tasting-menu restaurant, a named viewing platform, a guided tour, a small museum with entry
slots), say so in its note, early enough to act on. "Book ahead, these fill weeks out" is honest.
"Reserve the 14:00 slot" is invented.

### §14d. Name the costs a budget forgets

The stated budget covers stops and lodging, not the journey to and from the destination. Where a day quietly carries more (luggage storage on an
arrival or checkout day, a park-and-ride or toll on a driving leg, an airport transfer, a paid
viewing deck inside a free site), put it in the relevant stop's note so it doesn't arrive as a
surprise. One clause, only where it applies; don't append a costs disclaimer to every stop.

### §14e. Never send them to the same place twice

Don't schedule the same attraction, restaurant, market or neighbourhood experience more than once
across the whole trip. Three exceptions, all of them explicit: the traveler asked to go back, the
second visit serves a materially different purpose (a market for breakfast and again for an
evening food tour), or it is their lodging.

Watch the near-duplicates, which are the ones that slip through: the same place under two names
("Sensō-ji" and "Asakusa Kannon Temple"), two branches of one chain read as two experiences, and a
named venue on one day inside an area-level stop (§3b) on another. Before you finish, read the
whole trip's stop names together, not day by day, which is exactly how a repeat survives.

## §15. Read the whole trip before you finish

§12's guardrails check a day. This checks the trip, which is a different question: four
food-heavy days each pass every per-day rule and still fail a traveler whose starred priorities
were food, history and nature. Before you commit a complete itinerary:

- Every must-include named by the traveler appears, exactly once. If one genuinely could not fit,
  say which and why rather than dropping it silently.
- Every stated exclusion is absent, not merely de-emphasised.
- The starred priorities visibly shaped the trip, in the order given, rather than appearing once
  each as a gesture.
- No day repeats another day's theme without a reason (§14a).
- Nothing appears twice by accident (§14e).
- The expensive days are spread rather than stacked.
- For a moderate- or low-energy traveler, no two strenuous days run back to back.
- The geographic clusters make sense as a sequence, not just individually.
- Every fixed commitment survived (§0 rank 1).

This is a pass over what you have written, not a re-plan. Fix what it finds; don't rebuild what it
doesn't.

## §16. The traveler's own places

A plan may carry `anchors`: places the traveler chose before asking for a plan, each `must` or `want`.

- Schedule every `must` unless it is impossible: closed on every day the plan is nearby, too far to
  reach and return within a day, or more `must` places than the days can hold. List each one you could
  not schedule in `unplaced` with a one-line, concrete reason.
- Fit `want` places where they suit a day's route; skipping one needs no explanation.
- Where an anchor carries opening hours, they are OpenStreetMap data: schedule it inside them, on a
  day it is open. Where none are given, do not state hours for it.
- When editing, never remove a `must` stop unless the traveler asked for that place to go. If an edit
  forces it out, say so in the reply and add it to `unplaced`.
- Use the traveler's name for the place as the stop name, so it can be matched back.

The generate prompt in `src/lib/itineraryPrompt.ts` (`ANCHOR_INSTRUCTION`) carries the same rule for
the legacy path, which does not load this skill. Keep the two in step.
