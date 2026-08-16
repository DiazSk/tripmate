---
name: floating-widget-ui
description: The icon/expand/collapse/list-detail UI pattern for a persistent floating widget mounted once in the root layout — used for LlmTraceFab, and reusable for any other floating widget (chat, notifications, help, cart). Covers the collapsed-icon/expanded-panel states, the context-provider API for opening the widget pre-focused from elsewhere in the app, and the view-switching mechanics. Does not cover what content belongs in a widget — see dev-analytics-fab for that decision.
---

# Floating Widget UI

A reusable pattern for a persistent floating widget: a small icon in a fixed corner that expands
into a panel, with list and detail views inside it, mounted once for the whole app rather than
routed to. Extracted from `LlmTraceFab` (`src/components/LlmTraceFab.tsx`) — read that file for a
complete worked implementation of everything below.

## When to use this

Use this pattern when something needs to be reachable from anywhere in the app without taking over
the screen or requiring its own route — a persistent utility, not a page. If what you're building
genuinely needs a full page (its own URL, deep-linkable, the primary thing the user came to do),
this is the wrong pattern.

## Collapsed state: the icon

A fixed-position circular button, one Lucide icon, no label text:
- Position: `fixed bottom-5 right-5 z-50`.
- Size: `h-12 w-12`, `rounded-full`, dark solid background (`bg-stone-900 text-white`), `shadow-lg`.
- Hover: `hover:scale-105` with `transition-transform`.
- Always give it both `aria-label` and `title` describing what it opens (e.g. "Open LLM trace
  viewer") — it has no visible text of its own.
- Animate in/out with `framer-motion`'s `AnimatePresence` + a spring transition: `initial={{
  opacity: 0, scale: 0.6 }}`, `animate={{ opacity: 1, scale: 1 }}`, `exit={{ opacity: 0, scale: 0.6
  }}`, `transition={{ type: "spring", stiffness: 260, damping: 22 }}`.

## Expanded state: the panel

Replaces the icon in the same corner when open (mutually exclusive — never show both at once):
- Position: same fixed corner as the icon (`fixed bottom-5 right-5 z-50`).
- Fixed size, not resizable: pick dimensions that comfortably fit a list and a detail view without
  feeling cramped (`LlmTraceFab` uses `h-[32rem] w-[23rem]`).
- Structure: `rounded-2xl border shadow-2xl` shell, a header bar, then a scrollable body that fills
  the remaining height (`flex-1 overflow-hidden` on the body wrapper, the actual view inside handles
  its own `overflow-y-auto`).
- Header: icon + short title on the left, a single collapse button (`X` icon) on the right, in a
  `flex items-center justify-between` row with a bottom border separating it from the body. The
  collapse button always returns to the icon state — it does not close a "session," it just
  collapses the panel.
- Animate in/out with a spring transition that also moves it slightly up as it appears: `initial=
  {{ opacity: 0, scale: 0.9, y: 16 }}`, `animate={{ opacity: 1, scale: 1, y: 0 }}`, `exit={{ opacity:
  0, scale: 0.9, y: 16 }}`, `transition={{ type: "spring", stiffness: 260, damping: 24 }}`.

## View state and navigation

The panel's body swaps between views by a simple discriminated `view` state (a string union, e.g.
`"list" | "detail"` or more if the widget has more than one kind of detail), not by routing:
- A list view fetches and renders a scrollable list of items; each item is a full-width button that
  switches to a detail view for that item.
- A detail view shows a "← Back to list" link/button at its top-left (an arrow icon + short label),
  which switches `view` back to `"list"` and clears whatever selection state pointed at the detail.
- If a detail view can itself drill into a sub-detail (like `LlmTraceFab`'s run view drilling into
  one step of that run), handle that as local state *inside* that view component rather than adding
  more values to the top-level `view` union — keeps the top-level switch small and each view
  self-contained.
- Key detail views by the id they're showing (`key={selectedId}`): switching to a different item
  should remount the view component fresh rather than trying to reset its internal fetch/selection
  state by hand in an effect. This is simpler and avoids a whole class of stale-state bugs.

## The provider and context hook

Mount one `<XWidgetProvider>` in the root layout, wrapping the app once, so the widget is available
on every page without prop-drilling its open/closed state through the tree:
- The provider owns all the widget's state (`isOpen`, `view`, whatever selection ids the views need)
  and renders the actual floating icon/panel component as a sibling of `children`.
- It exposes a context hook (e.g. `useXWidget()`) with an API scoped to what other parts of the app
  actually need to trigger from outside — typically `openList()`, `open<Item>(id)` for jumping
  straight to a specific item's detail, and `close()`. This is what lets a "View details →" link
  anywhere in the app open the widget pre-focused, instead of navigating to a page that doesn't
  exist for this content.
- The hook throws if called outside its provider (`if (!ctx) throw new Error(...)`) rather than
  silently returning a no-op — a call site that isn't inside the provider is a real bug to catch
  immediately, not something to degrade gracefully.
