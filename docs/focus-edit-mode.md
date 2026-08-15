# Focus Edit Mode — UI/UX spec

Split-panel editor that replaces the result card when a user edits one day. Implemented in
`FocusEditMode.tsx` (shell), `DayTimeline.tsx` (right pane), `EditChatPanel.tsx` (left pane) and
`useFocusEdit.ts` (draft state).

## Component structure

```
TripPage / Home
├─ useFocusEdit(itinerary)          ← draft buffer: target, draft, dirty, open/applyDraft/save/cancel
├─ FocusEditMode                    ← rendered INSTEAD of ItineraryCard while target != null
│  ├─ header   Editing Day N — date · [Save changes] [✕]
│  ├─ tabs     chat | preview        (below lg only)
│  └─ grid
│     ├─ EditChatPanel  (left)      ← history, suggestion chips, input
│     └─ DayTimeline    (right)     ← vertical timeline, one day
└─ ItineraryCard                    ← standard multi-day view (target == null)
```

`ItineraryCard` is **not rendered** during focus mode — the budget bar, day tabs and cost footers
are absent from the tree rather than hidden with CSS, so they can't be tabbed into or read out.

## Layout

| Token | Value | Why |
|---|---|---|
| Card height | `h-[min(78vh,760px)]` | Fixed height so both panes scroll independently; capped so it never outgrows a laptop viewport. |
| Column width (focus) | `sm:w-[62%] sm:max-w-[880px]` | Two panes need ~400px each. |
| Column width (summary) | `sm:w-[40%] sm:max-w-[520px]` | Unchanged; a single column reads better narrow. |
| Pane split | `grid lg:grid-cols-2` + `lg:divide-x` | Equal halves; a 1px divider instead of a gap keeps it one card. |
| Scroll containment | `min-h-0` on grid **and** both children | Without it flex/grid children refuse to shrink and the card grows instead of scrolling. |
| Header | `border-b px-4 py-3` | Matches the card's own padding rhythm. |

## State machine

```
                open(dayIndex, scope)
   [summary] ─────────────────────────► [focus · clean]
       ▲                                   │  AI turn changes plan
       │ cancel (discard)                  ▼
       │                              [focus · dirty]
       └──────── save (commit+persist) ────┘
```

- **open** snapshots the itinerary (`structuredClone`). The live plan is untouched from here on.
- **applyDraft** replaces the draft. It compares first: a turn that changes nothing (a question, or
  the model asking for clarification) must not set `dirty`.
- **save** returns the draft only if `dirty`, so a no-op save skips the network write entirely.
- **cancel** drops the draft. No confirmation today — see edge cases.

## Live update behaviour

Each AI turn: `EditChatPanel` → `onItineraryChange(next)` → `diffChangedStops(draft, next, dayIndex)`
→ draft replaced → right pane re-renders.

Changed stops are diffed by **name + serialized content**, not name alone, so an in-place edit (a
shifted time, a rewritten note) still highlights. Highlighted rows get an accent dot, a tinted
background and an `updated` pill. A *removed* stop produces no badge — it's simply gone, and the
stop count in the pane header moves.

## Transitions

| Moment | Treatment |
|---|---|
| Enter focus | Card swaps in place. No slide/scale — the header and Save button are the affordance, and animating a workspace the user is about to type into delays them. |
| Turn in flight | Right pane drops to `opacity-60` + `aria-busy`, left pane shows "Thinking…". The preview stays readable — it's the reference while they wait. |
| Change lands | `transition-colors duration-500` on the changed rows, so the highlight arrives rather than snapping. |
| Exit | Immediate swap back to the summary view. |

Respect `prefers-reduced-motion` if any entrance animation is added later; nothing here currently
moves position.

## Responsive

- **≥ lg (1024px)**: true split, two equal panes.
- **< lg**: panes become tabs (`chat | preview`), one visible at a time. Two 200px-wide panes are
  worse than one usable one, and a stacked scroll fight is worse than both.
- **< sm**: the column already goes full-bleed (`inset-x-6`), inherited from the card.

## Edge cases

| Case | Behaviour |
|---|---|
| Turn fails (500/timeout) | Error line in the chat pane; **draft untouched**, so the preview still shows the last good state. The user can retry without losing the conversation. |
| Slow turn | Whole-trip chat uses the day-scaled timeout (`itineraryTimeoutMs`); element edits use the 90s default. Preview dims; input is disabled while busy. |
| Model returns no ops | Reply renders, `dirty` stays false, Save remains a no-op. |
| Model edits outside scope | `applyPatch` rejects the op and returns the reason — the plan cannot be changed outside the focused element in Mode B. |
| Save with no changes | Returns `null`; no PATCH is issued. |
| Cancel with unsaved changes | **Currently discards silently.** Known gap — should confirm. |
| Save fails to persist | `saving` clears in `finally`, but the failure isn't surfaced yet. Known gap. |
| Day removed while focused | `FocusEditMode` returns `null` if `draft.days[dayIndex]` is missing. |

## Known gaps

1. No confirm-on-cancel when `dirty`.
2. Persist failure on Save isn't surfaced to the user.
3. Pre-save (`/`, unsaved trip) has no DB write, so Save only commits to local state — correct, but
   means Focus Mode's "Save" means two slightly different things across the two hosts.
