import Hero from "./Hero";
import ImageRow from "./ImageRow";
import HowItWorks from "./HowItWorks";
import FeaturedPlans from "./FeaturedPlans";
import type { PlanPrefill } from "./planExamples";
import DestinationMap from "./DestinationMap";
import SiteFooter from "./SiteFooter";

/**
 * The Blue Hour Expedition landing sequence. Owns composition only — trip-form state stays in
 * HomeView.
 *
 * Six beats. A one-word photo hero opens and carries the CTA; the Blue Hour row and the method
 * strip say what the planner knows; **FeaturedPlans** shows four trips it has actually produced,
 * with the prices stated; **DestinationMap** answers "will it know where I mean"; **SiteFooter**
 * ends the page.
 *
 * The closing `HeroPoster` beat is gone. It existed to withhold "Plan a trip" until the very end,
 * which was the story's organising idea when the page was four beats — but once four more sections
 * of evidence landed in front of it, one word on an empty ground was the least substantial screen
 * on the page, arriving last. See `Hero` for the full reasoning.
 */
export default function ScrollStory({
  onPlan,
}: {
  /** Optional payload so `FeaturedPlans` can open the wizard already filled in from a card. `Hero`
   *  calls the same prop with no argument — one callback, not two, because both mean "start
   *  planning" and only one of them happens to know what. */
  onPlan: (prefill?: PlanPrefill) => void;
}) {
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
      <Hero onPlan={onPlan} />
      <ImageRow />
      <HowItWorks />
      <FeaturedPlans onPlan={onPlan} />
      <DestinationMap />
      <SiteFooter />
    </div>
  );
}
