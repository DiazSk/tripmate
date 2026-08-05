# Design

## Direction

"Quiet Concierge" — a calm, premium travel-planning tool. Operate mode (the user is in a task: filling a form, comparing tiers, scanning a day-by-day plan), so expression stays restrained and familiar rather than expressive or decorative. Personality lives in warm neutral tone, one confident serif for structural headings, and a single terracotta accent — not in layout invention or motion.

## Palette (Restrained strategy)

- `--background` `#faf8f5` — warm paper, not stark white or dark.
- `--foreground` `#201c19` — warm near-black ink for primary text.
- `--muted` `#6b6058` — secondary text (weather, notes, dates), tinted from the ink hue rather than gray.
- `--accent` `#bf5333` / `--accent-hover` `#a8462a` — terracotta/clay. Carries primary actions, selected states, and links only — never decoration.
- `--card` `#ffffff` on `--card-border` `rgba(32,28,25,0.08)` — cards sit one step lighter than the paper background.
- Semantic: red (`red-500`/`red-600`) reserved for over-budget state only.

## Typography

- Display/heading face: Source Serif 4 (self-hosted via `next/font/google`, `--font-display`), applied via the `.font-display` utility to the wordmark, page titles, and card/day headings only.
- Body/UI/data: system sans stack (`ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`) — Operate surfaces are well served by a workhorse face; the serif carries all the personality this surface needs.
- Numeric values (costs, budget totals) use `tabular-nums` for stable alignment.

## Components

- **Cards**: `rounded-2xl`, 1px hairline border in `--card-border`, soft diffused shadow (`0_1px_2px_rgba(32,28,25,0.04),0_8px_24px_-12px_rgba(32,28,25,0.12)`) instead of a flat gray border. One consistent card shell reused across the form, tier picker, day cards, budget bar, feedback control, and map wrapper.
- **Buttons**: primary = `rounded-full` terracotta pill with a soft shadow and a `scale-[0.98]` press state; secondary/ghost = text-only with a faint hover tint. No bordered secondary buttons.
- **Inputs**: `rounded-xl`, hairline border, terracotta focus ring.
- **Lodging line**: a drawn SVG bed/hotel glyph (not an emoji) on a tinted accent background, distinct from regular stops.
- **Day list rows**: divided by hairline separators (`divide-y`) rather than per-row cards, so a day's stops read as one list, not nested cards.
- **Budget bar**: pill-shaped track, terracotta fill under budget, red fill over budget, numeric readout in tabular figures.

## Motion

One register throughout: 150ms transitions on buttons (color, press-scale) and a 300ms width transition on the budget bar fill. The map's flyTo (1.2s, Leaflet's own easing) is the one deliberate "authored moment" — everything else stays quiet so the itinerary content stays legible while scanning.

## What this is not

No bento grids, no glass/blur decoration, no massive marketing-scale whitespace, no orchestrated scroll-reveal choreography, no kicker/eyebrow labels, no icon-plus-heading-plus-text filler cards. Those belong to Persuade-mode surfaces; this is a working tool the traveler scans and edits, not a page they're sold on.
