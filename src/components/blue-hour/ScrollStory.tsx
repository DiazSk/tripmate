import Hero from "./Hero";
import ImageRow from "./ImageRow";
import HowItWorks from "./HowItWorks";
import HeroPoster from "./HeroPoster";

/**
 * The Blue Hour Expedition landing sequence: a stunning photo hero opens with no
 * CTA, a compact image row and a short mechanism explainer follow, and "Plan a
 * trip" is uncovered only at the very end (HeroPoster) — the reveal the whole
 * sequence builds toward. Owns composition and motion only — trip-form state
 * stays in page.tsx.
 */
export default function ScrollStory({ onPlan }: { onPlan: () => void }) {
  // Cancels <main>'s own padding exactly: that padding exists for the centered-card
  // layouts (the plan-step form, the result view), but every section here is full-bleed
  // and must reach all four viewport edges — including the top, behind the fixed glass
  // navbar, which is transparent and floats above whatever's already there rather than
  // needing content to make room for it. Collapsing the four sections into one flex
  // child also takes <main>'s gap-6 out from between them, so the bands stack with no
  // seam. The top value mirrors <main>'s pt-[calc(var(--nav-h)+1.25rem)] precisely,
  // since that's the one side where the padding isn't uniform.
  return (
    <div className="-mx-5 -mb-5 -mt-[calc(var(--nav-h)+1.25rem)] sm:-mx-6 sm:-mb-6 sm:-mt-[calc(var(--nav-h)+1.5rem)]">
      <Hero />
      <ImageRow />
      <HowItWorks />
      <HeroPoster onPlan={onPlan} />
    </div>
  );
}
