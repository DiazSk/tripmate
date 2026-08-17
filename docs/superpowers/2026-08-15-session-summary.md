# Tonight's work — summary for the team

## 1. LLM performance metrics dashboard (new feature)

Built a benchmarking tool to measure and compare response time, tokens, and cost across the
three LLM-backed features (itinerary generation, place-detail lookup, AI chat editing) — so
future prompt/model changes can be judged against real before/after numbers instead of guesswork.

**What it does:**
- A synthetic load script (`npm run perf-bench -- --label <name>`) fires real traffic at each
  feature and tags the results with a batch label.
- A new **Perf Dashboard** panel on `/backend` lets you pick two batches (or "All time") and see,
  per feature, side-by-side averages with deltas: total duration, API duration, CLI startup
  overhead, thinking/planning time (time-to-first-token), tokens in/out, and cost.
- No new instrumentation needed — it turned out the Claude CLI already reports all of this in
  its response envelope; it just wasn't being parsed or aggregated anywhere before.

**Real numbers pulled tonight** (live data, not samples):

| Feature | Avg Duration | Thinking (TTFT) | Tokens In → Out | Avg Cost |
|---|---|---|---|---|
| Generation | 107.2s | 94.4s | 2680 → 15053 | $0.0891 |
| Critique/Validation | 61.3s | 46.9s | 3208 → 7735 | $0.0481 |
| Chat Edit | 55.4s | 49.4s | 5964 → 7755 | $0.0685 |
| Place Detail | 9.8s | 6.1s | 646 → 688 | $0.0112 |

Headline finding: ~90% of a generation call's wall-clock time is the model actually thinking —
CLI startup overhead is negligible (~200-300ms).

Shipped as 6 incremental commits, each independently reviewed, plus a final whole-branch review
that caught and fixed one real regression before merge. Merged to `restore-design` and pushed.

## 2. Fixed a broken production feature: AI chat/edit was completely non-functional

While dogfooding the new benchmark tool, it surfaced that the chat-based itinerary editor was
failing on every request. Root cause: a required file, `.claude/skills/itinerary-planner/SKILL.md`
— which holds the actual planning rules (budget targeting, stop/lodging selection, pacing) — was
missing from this machine and had never been checked into git (it's a local-only config file by
design). Two production routes depend on it at runtime; both were silently broken.

Recovered the file by mirroring the equivalent rules already shipping in the legacy generator, plus
two rule sets that didn't exist anywhere yet (traveler pacing/mobility, opening-hours/daylight
awareness) — grounded directly in the app's own existing derivation logic, not guesswork.

**Verified fixed, with real requests, not just code review:**
- Chat-edit: real request → real reply and applied edit, no error.
- The newer staged-pipeline generator: ran a full real trip generation for Kyoto — output followed
  the new rules correctly (right pacing for the traveler profile, correct lodging-naming
  convention, correct area-level food-stop handling).

## Net for tonight

- One new dev tool (perf dashboard) shipped and merged.
- One previously-broken core feature (AI chat editing) fixed and verified working end-to-end.
- Both proven against the real running app, not just typechecked.
