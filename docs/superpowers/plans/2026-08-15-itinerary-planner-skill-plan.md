# Itinerary-Planner Skill Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the missing `.claude/skills/itinerary-planner/SKILL.md` with the exact content approved in the design spec, and verify both runtime consumers (`trip-edit`, `trip-generate`) can actually load and use it end-to-end.

**Architecture:** This is a single untracked local file (`.claude/` is gitignored) read verbatim by `loadSkill()` in `src/lib/skill.ts`. There is no code change — the fix is placing the file at the exact expected path with the exact approved content, then proving both consumers work against it with a real request.

**Tech Stack:** Plain markdown file; verified via the running Next.js dev server and `curl`.

## Global Constraints

- The file must live at exactly `.claude/skills/itinerary-planner/SKILL.md` (relative to repo root) — this is what `path.join(process.cwd(), ".claude", "skills", name, "SKILL.md")` in `src/lib/skill.ts:16` resolves to.
- Content must match the design spec's "The skill content" section verbatim, including the YAML frontmatter (`loadSkill()` strips a `---\n...\n---\n` block at the top — see `src/lib/skill.ts:19`).
- No code changes in this plan — `src/lib/skill.ts`, `src/app/api/trip-edit/route.ts`, and `src/app/api/trip-generate/route.ts` already call `loadSkill("itinerary-planner")` correctly; they were only failing because the file didn't exist.
- `.claude/` is gitignored (`.gitignore:53`) — this file will not show up in `git status` and does not get committed. That's expected, not a bug to fix.

---

### Task 1: Create the skill file and verify both consumers load it successfully

**Files:**
- Create: `.claude/skills/itinerary-planner/SKILL.md`

**Interfaces:**
- Consumes: nothing (no code dependencies)
- Produces: a file `loadSkill("itinerary-planner")` (`src/lib/skill.ts:15-20`) can read

- [ ] **Step 1: Create the directory and file with the exact approved content**

Create `.claude/skills/itinerary-planner/SKILL.md` (create the `.claude/skills/itinerary-planner/` directories if they don't exist) with exactly this content:

```markdown
---
name: itinerary-planner
description: Planning rules for generating a trip itinerary from scratch and for editing one that already exists — traveler-profile pacing, preferences, weather, stop and lodging selection, budget targeting, and the output format for a from-scratch generation. Loaded at runtime via loadSkill("itinerary-planner") by the chat/element-edit loop (src/app/api/trip-edit/route.ts) and the staged-pipeline generator (src/app/api/trip-generate/route.ts).
---

# Itinerary Planner

These rules apply to every itinerary you produce or edit, whether you're building a full plan
from scratch or changing one stop in an existing trip. The trip context block elsewhere in this
prompt gives you the facts; these rules tell you what to do with them.

## §1. Preferences and destination context

If the traveler stated interest tags or a vibe, let them genuinely shape which stops get chosen —
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

## §2. Weather

Use the weather to favor indoor activities on days with high rain probability or extreme
temperatures, and outdoor activities on good-weather days.

## §3. Stops

### §3a. General

Every stop needs:
- A realistic estimated cost in USD (0 is fine for free attractions).
- A start time — times across a day's stops must be sequential and non-overlapping.
- A short duration label (e.g. "1 hour", "45 minutes").
- A category: "food" for meals/cafes/restaurants, "entry" for paid attractions/tickets, "transit"
  for explicit transport legs, "other" for everything else.
- Two one-line fields, each under about 90 characters and never repeating the stop's name:
  - **why**: why THIS stop suits THIS traveler given their stated interests and how they travel —
    the reason it was chosen over alternatives, e.g. "Quiet rock garden, no stairs — fits an
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
to that part of the day's route — a meal should never pull the day across town.

## §4. Lodging

### §4a. General

Every day except the last should include a lodging entry representing that night's stay, priced
to the tier's style (§6). Never invent specific prices, availability, or ratings beyond the cost
estimate.

### §4b. Type selection

Choose the TYPE of stay, not just a hotel. Consider hostels/social guesthouses (solo, younger,
tight budget), B&Bs/guesthouses/homestays (local and cultural interests), apartments (families,
groups, longer stays), hotels (when convenience, accessibility, or a late check-in matters), and
stays the destination is genuinely known for — riverside or desert camps, glamping, mountain huts,
houseboats, farmstays, ryokan-style inns. When the traveler's interests lean adventurous or
outdoorsy, actively offer the adventurous option (e.g. a riverside camp) on the night whose
location makes it natural, instead of defaulting to a city hotel — but only where such stays
genuinely exist at that destination, and never when the night's weather, a remote location after
dark, or a family/accessibility need makes it a bad idea.

Phrase the lodging name as the type FIRST, then the area — "Boutique hotel in Capitol Hill",
"Riverside camp near Shivpuri", "Family apartment in Fremont." Never write it the other way round
("Capitol Hill Boutique Hotel"), which reads as a specific property and invents one that may not
exist; name an actual property only when it is itself the draw or needs booking far ahead.

### §4c. Alternative and continuity

Use the note field to say in one line why this type suits this traveler, plus ONE alternative of a
different type or price band. Use the SAME lodging for every night in the same city — repeat its
name and nightly cost on each of those days. Only switch lodging when the trip actually relocates
to a different city or region, and say so in that day's note. Do not invent a different hotel each
night: it costs the traveler more, wastes time re-checking in, and no one moves hotels nightly in
one city. Pick one well-located base per city and plan the days around it.

## §5. Budget

The itinerary's total cost (lodging + stops combined) MUST come close to the full stated budget
(aim for 85-100% of it), not just "under" it. If standard sightseeing and dining wouldn't use up a
high budget, add premium extras appropriate to the tier (private guides, exclusive experiences,
shopping, spa, upgraded transport) rather than leaving the budget unused.

This targets a from-scratch plan against its full budget. When editing an existing itinerary, this
still applies as a constraint the edit may not violate, but a small, targeted edit is not expected
to re-hit 85-100% on its own; it must simply not push the trip's total meaningfully outside that
band.

## §6. Tier style

The tier sets the overall register for cost and taste:
- **Budget**: hostels, street food and casual eats, public transit.
- **Mid-range**: boutique hotels, casual-to-nice restaurants, taxis.
- **Luxury**: 5-star hotels, fine dining, private tours and transport.

## §7. Day narrative

For each day, write a short, elegant 1-2 sentence summary capturing that day's theme and flow, with
1-2 tasteful emojis, e.g. "A relaxing mix of historic sightseeing in Asakusa followed by local
dining along the river. 🏯🍜"

## §8. Coordinates

Use real, well-known places (or real, well-known areas, per §3b) for the destination, with their
real approximate latitude/longitude — never invented ones.

## §9. Traveler profile: pace, mobility, crowd bias, family

The trip context gives you the traveler's profile in one of two shapes:

- **Already-resolved flags** — `pace_resolved` with a target stops/day, `mobility_profile`,
  `crowd_bias`, and (for families) `family_rules`. When these are present, apply them directly
  using their given values — they were computed deterministically from the traveler's answers, so
  don't re-derive or second-guess them.
- **Raw answers only** — `explorer_style`, `energy`, `crowds`, `group`, with no resolved flags.
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
    keep travel legs between stops short.

When priorities are given as starred (primary) versus the rest (tie-breakers), let starred
priorities be the main driver of which stops get chosen; the rest only break ties between
otherwise-equal options.

For an edit to an existing itinerary: the plan already reflects this profile. A replacement or
addition must not contradict it (e.g. don't swap in a stop requiring a long walk for a low-energy
traveler, or a peak-hours must-see for someone who said to avoid crowds) — but you are not
re-planning the whole trip's pace from this one change.

## §10. Opening hours and daylight

When the trip context gives a place's opening hours or closed days, don't schedule a stop when it
would be closed. When hours are marked unknown or unverified, say so in the stop's note rather than
asserting a time you don't actually know.

When the trip context gives daylight/sunset times for a day, don't schedule an outdoor, scenic, or
view-dependent stop after dark unless the point of the stop is a nighttime experience (a night
market, an illuminated landmark, stargazing). Evening stops that don't depend on daylight (dinner,
a bar, an indoor show) are unaffected by this.

If a fact needed to judge this (a place's hours, the day's sunset time) isn't present in the trip
context, don't invent one — proceed without that check rather than guessing at a time.

## §11. Output format (full generation from scratch only)

This section applies only when you are producing a complete itinerary from scratch — not when
editing an existing one; an edit's required output format is specified elsewhere in this prompt.

Respond with only the itinerary itself: no preamble, no commentary, no code fences. Structure it as
markdown, one section per day, in this shape:

    ## Day N — YYYY-MM-DD

    *1-2 sentence elegant narrative with 1-2 tasteful emojis capturing the day's theme and flow.*

    **Weather:** short weather summary

    **Lodging:** lodging name — $cost — one-line note

    - **HH:MM AM/PM — Stop name** (category, duration label, $cost, lat/lng)
      why: one line
      note: one line

Repeat the day heading and stop list for every day of the trip, in order. Omit the Lodging line on
the last day only. Every field named above (time, category, duration label, cost, lat/lng, why,
note) must be present for every stop, in that order, so the structure is identical across stops and
days.
```

- [ ] **Step 2: Verify the file is at the exact expected path with correct frontmatter stripping**

Run:
```bash
node -e "
const { readFile } = require('fs/promises');
const path = require('path');
readFile(path.join(process.cwd(), '.claude', 'skills', 'itinerary-planner', 'SKILL.md'), 'utf8')
  .then((raw) => {
    const stripped = raw.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
    console.log('First 80 chars after stripping:', JSON.stringify(stripped.slice(0, 80)));
    console.log('Contains §11:', stripped.includes('§11'));
  });
"
```
Expected: prints `First 80 chars after stripping: "# Itinerary Planner..."` (frontmatter successfully stripped, body starts with the `# Itinerary Planner` heading, not `---`) and `Contains §11: true`.

- [ ] **Step 3: Verify the chat-edit path loads it successfully with a real request**

With `npm run dev` running, generate a trip through the app (or via `curl -X POST http://localhost:3000/api/itinerary` with a valid body) to get a real `itinerary` and `trip`, then:

```bash
curl -s -X POST http://localhost:3000/api/trip-edit \
  -H "Content-Type: application/json" \
  -d '{"mode":"chat","trip":{"id":"skill-check","destination":"Paris, France","startDate":"2026-09-19","endDate":"2026-09-21","budget":900},"itinerary":<PASTE ITINERARY JSON HERE>,"messages":[{"role":"user","content":"Make day 1 a bit later"}]}'
```

Expected: `200 OK` with a real `reply`/`ops` in the response — no `ENOENT` error, no 500.

- [ ] **Step 4: Verify the staged-generate path loads it successfully**

The staged pipeline needs a `reconciled`/`poiDetails` bundle from the earlier steps (`trip-submit`/`trip-fetch`/`trip-prepare`), which isn't a quick one-line curl. If a harness for driving this exists (check `src/app/backend/pipeline/page.tsx`'s `StagedPipelineConsole`), use it to invoke Step 5/6 with a real destination. Otherwise, confirm via code inspection that `trip-generate/route.ts:37`'s `loadSkill("itinerary-planner")` call succeeds by checking the `llm_traces` table for a fresh `generate`-type trace with `status = 'ok'` after driving the harness, or note in the task report that this path was not separately exercised (Step 3 already proves `loadSkill()` itself works — the remaining risk here is staged-generate-specific, not skill-loading-specific).

Expected: no `ENOENT` thrown from `loadSkill` when this path runs.

- [ ] **Step 5: No commit needed**

`.claude/` is gitignored (`.gitignore:53`), so there is nothing to commit — creating the file is the entire deliverable. Confirm with `git status` that it does not appear as untracked.

## Self-Review Notes

- **Spec coverage:** The file content is transcribed verbatim from the spec's "The skill content" section — every one of §1-§11 is present, in order, matching exactly.
- **Placeholder scan:** No TBD/TODO in the file content itself. Step 4's harness check is conditional because the staged pipeline has no simple one-line curl equivalent to Step 3's chat-edit check (per `CLAUDE.md`, it requires Steps 2a-4's bundles first) — this is a real environmental constraint, not a deferred requirement, and the step gives a concrete fallback (trace-table check) rather than leaving it open-ended.
- **Type consistency:** N/A — no code, no functions/types introduced by this plan.
