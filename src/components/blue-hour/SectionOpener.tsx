import type { ReactNode, Ref } from "react";

import { devLabel } from "@/lib/devInspector";

/**
 * The scene's section opener: a small label pinned in a left column, the heading offset into
 * column two, a hairline across the top.
 *
 * This is a deliberate reversal of DESIGN.md's **No-Kicker Rule** ("Nothing sits above a headline.
 * No eyebrows, no all-caps kickers, no category labels introducing a title."), taken on an explicit
 * instruction after the Vita Travels breakdown identified it as the reference's most recognisable
 * move. The rule is amended in DESIGN.md rather than left standing while the code breaks it.
 *
 * Two things make it a running header rather than a stacked eyebrow, which is the version worth
 * defending: the label sits *beside* the heading in its own column, not above it, and it names the
 * movement rather than restating the heading. On narrow viewports the column collapses and it does
 * become a stacked label — that is the honest cost, and it is why the label stays at white/40 and
 * never repeats a word the heading already says.
 *
 * `headingRef` exists so the caller can pass it to `useLineReveal`; the reveal masks lines, so it
 * has to own the heading element itself.
 */
export default function SectionOpener({
  label,
  children,
  headingRef,
  id,
  align = "center",
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
  /** Where the label sits against the heading. `center` is right for the 3.75rem section
   *  headings; `start` is for the generation screen, whose heading runs to 8rem and leaves the
   *  centred label floating in the middle of a very tall cell. */
  align?: "center" | "start";
  /** Whether to draw the opener's own top hairline. Off for `/profile`, which puts this inside
   *  one cell of a ruled two-column grid: there the rule belongs to the grid so it spans both
   *  cells, and a second one here would rule only the right half. Off also drops the `pt-10`
   *  that goes with it, since the cell's own padding sets the offset in that arrangement. */
  rule?: boolean;
}) {
  return (
    <div
      id={id}
      className={`grid gap-6 lg:grid-cols-[11rem_1fr] lg:gap-10 ${
        rule ? "border-t border-white/10 pt-10" : ""
      }`}
      {...devLabel("SectionOpener")}
    >
      <p
        className={`flex gap-2 text-sm font-semibold leading-none tracking-[-0.045em] text-white/55 ${
          align === "start" ? "items-start lg:pt-3" : "items-center"
        }`}
      >
        <SectionMark />
        {label}
      </p>
      <div ref={headingRef}>{children}</div>
    </div>
  );
}

/**
 * Drawn, not typed. The reference sets a `❋` here, but a Unicode glyph as an icon renders in
 * whatever the fallback font decides and cannot be given a stroke weight — so this is an authored
 * six-point asterisk at the same 1.5 stroke the app's lucide icons use.
 */
function SectionMark() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 12 12"
      className="h-2.5 w-2.5 shrink-0 text-accent"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M6 1v10M1.7 3.5l8.6 5M10.3 3.5l-8.6 5" />
    </svg>
  );
}
