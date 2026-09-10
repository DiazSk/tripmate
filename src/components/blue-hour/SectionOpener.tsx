import type { ReactNode, Ref } from "react";

import { devLabel } from "@/lib/devInspector";

/**
 * A section's opening: a folio line, then the heading at full measure beneath it.
 *
 * **What this replaced.** The previous opener was a two-column grid — an 11rem left column holding
 * a small label, the heading offset into column two, a hairline across the top. That construction
 * came in wholesale from an external reference, which this file's own comment identified as "the
 * reference's most recognisable move", and it was allowed in by *amending* DESIGN.md's standing
 * No-Kicker rule ("Nothing sits above a headline. No eyebrows, no all-caps kickers, no category
 * labels introducing a title") rather than by outgrowing it. The defence was that the label sat
 * beside the heading rather than above it — true above `lg`, and false on every narrower viewport,
 * where the column collapsed and it became exactly the stacked eyebrow the rule forbids.
 *
 * **What it is now.** The label moves onto the rule itself, at the far end, where a printed page
 * puts a running head: it is a marker for where you are in the document, not an introduction to
 * the sentence below it. The heading then starts at the left margin with the full measure to work
 * in, rather than beginning a third of the way across the page. Two consequences worth stating:
 *
 * - The No-Kicker rule holds again unamended at every width. Nothing is above the headline; the
 *   label is on a rule, and the rule is a boundary between sections, not a lead-in to one.
 * - Long headings get roughly 11rem of measure back on desktop, which is most of a word per line.
 *
 * `headingRef` exists so the caller can pass it to `useLineReveal`; the reveal masks lines, so it
 * has to own the heading element itself.
 */
export default function SectionOpener({
  label,
  children,
  headingRef,
  id,
  rule = true,
}: {
  label: string;
  /** The heading. Passed as children so each beat picks its own level and size. */
  children: ReactNode;
  /** Point this at the heading, never at a block that also holds body copy: `useLineReveal`
   *  masks every line inside what it is given, so a paragraph caught in the same element gets
   *  split apart. When the opener holds more than a heading, ref the heading directly instead. */
  headingRef?: Ref<HTMLDivElement>;
  id?: string;
  /** Whether to draw the folio line at all. Off for `/profile`, which puts this inside one cell of
   *  a ruled two-column grid: there the rule belongs to the grid so it spans both cells, and a
   *  second one here would rule only the right half. With the line gone the label has nothing to
   *  sit on, so it is dropped too rather than left floating — which is the No-Kicker rule doing
   *  its job rather than an omission. */
  rule?: boolean;
}) {
  return (
    <div id={id} {...devLabel("SectionOpener")}>
      {rule && (
        // The folio line. `justify-end` puts the label at the right margin, which is what keeps it
        // from reading as a kicker: a label at the left is the first thing you read and introduces
        // what follows; a label at the right is something you find after the fact, the way a page
        // number is. `pb-3` sets the label just above the rule rather than centred on it, so the
        // rule stays an unbroken boundary rather than a line with a gap punched in it.
        <div className="mb-8 flex items-baseline justify-end gap-2 border-b border-card-border pb-3">
          <SectionMark />
          <span className="text-[0.6875rem] font-semibold tracking-[var(--tracking-label)] text-muted uppercase">
            {label}
          </span>
        </div>
      )}
      <div ref={headingRef}>{children}</div>
    </div>
  );
}

/**
 * Drawn, not typed — a Unicode `❋` renders in whatever the fallback font decides and cannot be
 * given a stroke weight, so this is an authored six-point asterisk at the same 1.5 stroke the
 * app's lucide icons use. It is the project's own mark and stays; it belongs to the same asterisk
 * family as `LogoMark` and the four-point `ButtonMark`.
 */
function SectionMark() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 12 12"
      className="h-2 w-2 shrink-0 self-center text-accent"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M6 1v10M1.7 3.5l8.6 5M10.3 3.5l-8.6 5" />
    </svg>
  );
}
