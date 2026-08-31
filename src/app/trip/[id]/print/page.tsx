import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTrip } from "@/lib/db";
import { formatDateRange, formatDateWithWeekday, formatMoney } from "@/lib/format";
import { dayPlanned } from "@/lib/itinerary";
import { TIERS } from "@/lib/tiers";
import { toTripDetail } from "@/lib/tripPayload";

/**
 * A reviewer-facing, printable copy of one trip — the whole itinerary on one page, sent to
 * someone outside the team to find out whether the plan holds up for a human who didn't
 * generate it.
 *
 * Why this exists as its own route rather than a print stylesheet over `/trip/[id]`:
 * `ItineraryCard` is tab-based and renders exactly one day, so printing that page yields one day
 * whatever the trip's length. The `@media print` block in globals.css unpins the shell; this
 * route supplies the all-days document to put inside it.
 *
 * Every stop carries an explicit "Day N · Stop M" label. That numbering is the point: it is what
 * lets a reviewer say "day 2, stop 3 is wrong" instead of "the afternoons felt off", and it is
 * why the labels are written out rather than left to an `<ol>` marker, which would number stops
 * within a day but drop the day half of the reference.
 */
export const dynamic = "force-dynamic";

/** Asked of every reviewer, in this order, so five replies stay comparable instead of arriving
 *  in five shapes. Hardcoded: five reviewers do not justify a config surface or a table. */
const REVIEW_QUESTIONS = [
  "Would you actually follow this itinerary as written? If not, where does it break down?",
  "Which single stop would you cut, and why?",
  "What's missing that you'd expect a plan for this place to include?",
  "Is anything here wrong — a place that doesn't exist, is closed, or isn't where we say it is?",
  "Does the pace feel right, too packed, or too empty? Name the day you're judging.",
  "Would you have paid for this plan? If yes, roughly what?",
];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const destination = getTrip(id)?.destination;
  // Names the saved PDF, which is the only reason this route carries metadata at all.
  return { title: destination ? `${destination} — itinerary for review` : "Itinerary for review" };
}

export default async function TripPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // No `preview` branch, unlike the sibling route: a hardcoded fixture has nothing to review.
  const row = getTrip(id);
  if (!row) notFound();

  const trip = toTripDetail(row);
  const { days } = trip.itinerary;
  // `?.` because `tier` is absent on rows saved before it existed.
  const tier = TIERS.find((t) => t.id === trip.itinerary.tier)?.name;
  // `dayPlanned` for both the per-day and the trip figure, rather than `tripSpend` for the
  // total: `tripSpend` prefers a stop's `actualCost` where one has been entered, so mixing the
  // two would let the day numbers fail to sum to the trip number in a document whose whole
  // purpose is to be checked line by line. This is a plan, so it reports planned cost.
  const planned = days.reduce((sum, day) => sum + dayPlanned(day), 0);

  // `pt-10 sm:pt-12` clears the fixed nav on screen, matching TripsView; `print:pt-0` drops it on
  // paper, where the print block hides the nav and the padding is only wasted margin.
  return (
    <main className="pointer-events-auto mx-auto max-w-3xl scheme-light bg-white p-8 pt-10 text-black sm:pt-12 print:pt-0">
      <header className="border-b border-neutral-300 pb-4">
        <h1 className="text-3xl font-semibold">{trip.destination}</h1>
        <p className="mt-1 text-neutral-600">
          {formatDateRange(trip.startDate, trip.endDate)} · {days.length}{" "}
          {days.length === 1 ? "day" : "days"}
          {tier ? ` · ${tier}` : ""}
        </p>
        <p className="mt-1 text-neutral-600">
          Planned {formatMoney(planned)} of a {formatMoney(trip.budget)} budget
        </p>
        <p className="mt-3 text-sm text-neutral-500 print:hidden">
          Print or save as PDF: ⌘P / Ctrl+P
        </p>
      </header>

      {days.map((day, i) => (
        <section key={i} className="break-inside-avoid-page border-b border-neutral-200 py-5">
          <h2 className="text-xl font-semibold">
            Day {i + 1}
            {day.title ? ` — ${day.title}` : ""}
          </h2>
          <p className="text-sm text-neutral-600">
            {formatDateWithWeekday(day.date)}
            {day.weather ? ` · ${day.weather}` : ""}
          </p>
          {/* Optional: added after the first itineraries were saved. */}
          {day.summary && <p className="mt-2 text-neutral-700 italic">{day.summary}</p>}

          {day.lodging && (
            <p className="mt-3 text-sm">
              <span className="font-medium">Staying:</span> {day.lodging.name} —{" "}
              {formatMoney(day.lodging.cost)}
              {day.lodging.note && (
                <span className="text-neutral-600"> ({day.lodging.note})</span>
              )}
            </p>
          )}

          <ol className="mt-3 space-y-3">
            {day.stops.map((stop, si) => (
              <li key={si} className="break-inside-avoid border-l-2 border-neutral-300 pl-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-medium">
                    <span className="text-neutral-500">
                      Day {i + 1} · Stop {si + 1} —{" "}
                    </span>
                    {stop.name}
                  </span>
                  <span className="text-sm text-neutral-600">{formatMoney(stop.cost)}</span>
                </div>
                {/* `stop.time` raw, as every other reading surface prints it — reformatting it
                    here would have a reviewer report a time the sender never sees. */}
                {[stop.time, stop.durationLabel].filter(Boolean).length > 0 && (
                  <p className="text-sm text-neutral-500">
                    {[stop.time, stop.durationLabel].filter(Boolean).join(" · ")}
                  </p>
                )}
                {stop.why && <p className="mt-0.5 text-sm text-neutral-700">{stop.why}</p>}
                {stop.note && <p className="text-sm text-neutral-600">{stop.note}</p>}
              </li>
            ))}
          </ol>

          <p className="mt-3 text-sm font-medium text-neutral-700">
            Day {i + 1} planned: {formatMoney(dayPlanned(day))}
          </p>
        </section>
      ))}

      <section className="break-before-page pt-6">
        <h2 className="text-2xl font-semibold">Reviewing this plan</h2>
        <p className="mt-2 text-neutral-700">
          This is a draft itinerary generated by TripMate, an app we&rsquo;re building. Nobody
          outside the team has judged one yet, which is the only reason you&rsquo;re reading it.
          Please be blunt — a polite review is worth nothing to us. Reference anything specific by
          its label, e.g. &ldquo;Day 2 · Stop 3&rdquo;.
        </p>
        <ol className="mt-4 list-decimal space-y-2 pl-6 text-neutral-800">
          {REVIEW_QUESTIONS.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ol>
        <p className="mt-6 text-sm text-neutral-600">
          Send answers back however is easiest — reply to whoever sent you this.
        </p>
      </section>
    </main>
  );
}
