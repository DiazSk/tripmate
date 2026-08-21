/**
 * The four-point star that sits after a button's label — the reference's own button mark, and
 * distinct from the six-point `❋` of `SectionOpener`'s rule. The reference carries both; these are
 * two different shapes and reusing the other one here does not work at this size, because 1.5 units
 * of stroke inside an 8px box closes the gaps between the arms and reads as a blob. This one is a
 * filled path and stays crisp.
 *
 * Extracted at the third call site, not the second. `Hero` and `FeaturedPlans` each held their own
 * copy of this path and could afford to; the full-screen mobile menu's CTA made it three, which is
 * the point where a redrawn mark would have to be found in three files and one of them would be
 * missed.
 *
 * `fill="currentColor"` is the load-bearing part, and the reason this is inline rather than an asset:
 * the reference hard-codes `#0D2E37`, which would be wrong in half the states this mark appears in.
 * `FeaturedPlans`' button inverts on hover (white on slate becomes dark on amber) and the mark has to
 * invert with it; the hero's does not invert its label and must stay dark in both. Following
 * `currentColor` is what makes one component correct in every one of those cases.
 *
 * 8px, fixed. It is punctuation on a label, not an icon that scales with anything — see the
 * `aria-hidden`: the label beside it already says what the button does.
 */
export default function ButtonMark() {
  return (
    <svg aria-hidden width="8" height="8" viewBox="0 0 8 8" fill="currentColor" className="shrink-0">
      <path d="M8 0C8 0 7.32057 2.41553 7.32057 4C7.32057 5.58447 8 8 8 8C8 8 5.58447 7.32057 4 7.32057C2.41553 7.32057 0 8 0 8C0 8 0.679427 5.58447 0.679427 4C0.679427 2.41553 0 0 0 0C0 0 2.41553 0.679426 4 0.679426C5.58447 0.679426 8 0 8 0Z" />
    </svg>
  );
}
