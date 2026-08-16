# LLM Integration — Feature Tracker

Covers `src/lib/claude.ts`, `src/lib/itineraryPrompt.ts`, and the trace
viewer's relationship to the model call. See
[`project-crux.md`](./project-crux.md) for how these tables are maintained.

## Features

| Feature | Status | Since | Developer | Notes |
|---|---|---|---|---|
| `runClaude()` — one-shot call to the `claude` CLI (Haiku, no tools, no session persistence) | Active | 2026-08-04 | Aryan | Uses `spawn`, not `execFile` — `execFile` reliably hung on this binary |
| `buildGeneratePrompt()` | Active | 2026-08-04 | Aryan | Weather-aware, budget-aware, requests strict JSON shape |
| `buildRefinePrompt()` | Active | 2026-08-04 | Aryan | Feeds back the previous itinerary + user feedback text |
| JSON-envelope parsing + markdown-fence stripping (`parseJsonResponse`) | Active | 2026-08-04 | Aryan | Model sometimes wraps JSON in ```` ```json ```` fences despite instructions not to |
| Preferences (trending tags + vibe) woven into `buildGeneratePrompt` | Active | 2026-08-05 | Aryan | No-op when preferences are empty/skipped — prompt text is byte-identical to before |
| Trace logging on every `runClaude` call | Active | 2026-08-05 | Aryan | Logs on *every* outcome — success, non-zero exit, timeout, non-JSON response — the failure cases are usually the most useful ones to inspect |
| LLM trace viewer (`/llm-trace`, `/llm-trace/[id]`) | Active | 2026-08-05 | Aryan | Full prompt + raw response, linked from every page and from each result |
| Daily narrative `summary` field in the itinerary JSON contract | Active | 2026-08-05 | Aryan | Model writes a 1-2 sentence, emoji-touched summary of each day's theme/flow; requested via `SHAPE_HINT` in both `buildGeneratePrompt` and `buildRefinePrompt` |
| `buildContainerThemePrompt()` — picks a destination-themed "unboxing container" | Active | 2026-08-05 | Aryan | Classifies into `containerType`/`themeTitle`/`primaryColor`/`stampOrIcon`/`lidType`; a separate, tiny, independent call — not folded into the itinerary prompt since it's decorative and shouldn't block/slow generation |
| `formatTravelerProfile()` | Active | 2026-08-16 | Zaid | Feeds pace, mobility, crowd bias, family rules and starred priorities into generate/refine/critique. `deriveFlags` computed all of this already; the route never read `userAnswers`, so it was discarded. Own module because `itineraryPrompt.ts` imports `TIERS` as a value and so can't be loaded from a `.test.mjs` |

## Enhancements

| Enhancement | Since | Developer | Notes |
|---|---|---|---|
| `runClaude` return shape changed from a bare `string` to `{ result, traceId }` | 2026-08-05 | Aryan | Needed so the API route (and eventually the UI) can link an itinerary back to the exact call that produced it |
| `runClaude` now takes a `type: "generate" \| "refine" \| "container-theme"` argument | 2026-08-05 | Aryan | Recorded on the trace row for filtering/context; widened again for the container-theme call |
| `SHAPE_HINT` grew a `summary` field per day | 2026-08-05 | Aryan | Typed as `DayPlan.summary?: string` — optional, so older saved trips (and the rare case the model omits it) don't break rendering |
| Area-level food stops (`FOOD_STOP_INSTRUCTION`) in generate/refine/rebalance, mirrored as §3b of the `itinerary-planner` skill | 2026-08-13 | Claude | Meals defaulted to one committed restaurant, which reads like a booking and pins the day's route to a single address. Now a `food` stop uses the neighborhood/market as its `name` with the area's lat/lng, and puts "what to look for + one or two examples" in `why`/`note`. A specific venue is named only when the venue is the point (landmark eatery, reservation needed, or a stated interest is why the day routes there) |
| Lodging type variety (`LODGING_INSTRUCTION`), mirrored as §4b/§4c of the skill | 2026-08-15 | Claude | Every night came back as the same mid-range city hotel. The model now picks the *type* — hostel, B&B/homestay, apartment, hotel, or a destination-native stay (riverside/desert camp, hut, houseboat, farmstay) — from traveler flags, offers one alternative of a different type/price in `note`, and keeps one base while consecutive days share an area. Adventurous/outdoors interests get camp-type stays actively proposed, gated on the destination genuinely having them and on weather/remoteness/family-accessibility not ruling it out. `name` is phrased type-first ("Boutique hotel in Capitol Hill") because the reverse invents plausible-sounding properties |

## Bugs

| Bug | Found | Fixed | Developer | Notes |
|---|---|---|---|---|
| `spawn("claude", ...)` failed with `claude CLI failed to start: spawn claude ENOENT` — `claude` wasn't resolvable via PATH in this environment | 2026-08-04 | 2026-08-04 | Aryan | Symlinked the CLI binary into `~/.local/bin` (added to `PATH` in `.zshrc`) and restarted the dev server so it picked up the updated environment |

## Non-obvious constraints (not bugs, just easy to trip on)

- `CLAUDECODE` must be stripped from the child process's env before spawning,
  or the CLI refuses to launch nested inside another Claude Code session.
  Already handled in `runClaude` — noted here so nobody "fixes" it back in.
