# Glass blur refinement (Apple Maps sidebar reference)

## Context

The current `.glass-itinerary` treatment (`src/app/globals.css`) — shared by every card in the app (destination form, tier picker, itinerary card, place-detail panel, trips list) — uses `rgba(15, 23, 42, 0.7)` with a `blur(16px)` backdrop filter. That alpha/blur pair was tuned earlier this session purely for worst-case text contrast against the live 3D globe, not for how the glass itself should look.

The user shared a macOS Apple Maps screenshot of its sidebar: a much softer, heavier-blurred frosted glass (the map behind it reads as soft indistinct color blobs, not recognizable detail) than what we currently have. They want that same transparency/blur *character* applied to our panels, while keeping our existing teal-navy tint (`rgba(15, 23, 42, …)`) rather than adopting Apple's neutral gray/black. This is a pure visual refinement of one existing CSS class — no component/markup changes.

Two decisions were made explicit before design:
- **Priority is matching the reference look**, not preserving the contrast floor established earlier. If the heavier blur/lighter opacity reopens legibility risk against a bright backdrop, that gets re-tested and adjusted live rather than constraining the values up front.
- **Isolate the experiment in a new branch.** `zaidswork` currently has uncommitted work (this session's round 1+2 glass-consistency and loader rework). That gets committed as a checkpoint first, then a new branch is cut for this tuning pass. Only merged back into `zaidswork` if the user approves it live; otherwise the branch is simply left alone/discarded, and `zaidswork` is never touched by the experiment.

## Approach

**Git workflow:**
1. Commit the current round 1+2 changes to `zaidswork` (clean checkpoint, already live-verified in the browser earlier this session).
2. Create and check out a new branch, `glass-blur-refinement`, from that commit.
3. All tuning happens on this branch.
4. Live-review with the user once tuned; merge into `zaidswork` only on explicit approval. No merge, no push, no cleanup decision made unilaterally — that's the user's call at review time.

**CSS approach — `.glass-itinerary` only** (`src/app/globals.css`):
- Raise `backdrop-filter: blur(...)` substantially, from `16px` toward the ~40-60px range that produces Apple's soft, detail-erasing look — exact value tuned by eye against our real running globe backdrop, not fixed in advance.
- Likely add a `saturate(...)` boost alongside the blur (Apple/iOS-style frosted glass typically saturates the little color that bleeds through) — `.glass-panel` elsewhere in this file already does `blur(16px) saturate(180%)` as a precedent for this app's own vocabulary.
- Adjust the background alpha to match the reference's darkness/softness. Keep the hue fixed at our existing `rgba(15, 23, 42, …)` — only the alpha (and possibly the blur/saturate pairing) changes; this is not a recolor.
- No other selectors touch color: `--foreground`/`--muted`/`--card-border` overrides inside `.glass-itinerary` stay as-is unless live testing shows the new backdrop makes existing text illegible, in which case that gets flagged and adjusted as part of the same pass (per the "prioritize the look, then re-test" decision above).

## Testing / acceptance

Live in the Claude Browser, on the `glass-blur-refinement` branch, dev server running:
1. Screenshot each of the four surfaces this class touches (home page form/tier steps, result view, `/trip/[id]`, `/trips`) and visually compare the blur/transparency character against the Apple Maps reference — the bar is "does this feel like the same frosted-glass material," not a pixel-diff.
2. Spot-check text legibility at a few different camera positions/backdrops (including a bright one, since that's the case most likely to regress) and flag anything that's gone from "legible" to "actually hard to read" — per the priority decision, minor softening is acceptable, but note it either way for the user's review.
3. `read_console_messages` clean; `npx tsc --noEmit && npx eslint src` clean.
4. Get the user's live yes/no before merging.
