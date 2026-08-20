import type { Itinerary, TripSummary, UserAnswers } from "./types";
import { TIERS } from "./tiers";
import { sanitizeAnswers } from "./userAnswers";

/**
 * The frozen anchor for an edit session.
 *
 * Assembled ONCE, from data already stored on the trip and inside the itinerary itself — no
 * geocode, no weather call, no POI lookup, no context rebuild. Steps 2a/3/4/5 never run during
 * editing, which is the whole point: an edit is a patch against fixed facts, so the same edit
 * always sees the same world.
 *
 * Trips generated before the staged pipeline existed carry no stored trip-context, so this
 * reconstructs the equivalent fact block from what the trip does have (dates, budget, tier, and
 * the real per-day forecast that generation attached to each day as `weatherDetail`).
 */
export function buildEditContext(
  trip: TripSummary,
  itinerary: Itinerary,
  rawAnswers?: UserAnswers | null
): string {
  // Stored `user_answers_json` predates the sanitizing, and a raw POST to /api/trips can write
  // whatever it likes into it — same normalize-at-the-barrier rule as `reconcileTrip`.
  const answers = rawAnswers ? sanitizeAnswers(rawAnswers) : rawAnswers;
  const tier = TIERS.find((t) => t.id === itinerary.tier);

  const dayLines = itinerary.days.map((d, i) => {
    const w = d.weatherDetail;
    const bits: string[] = [`Day ${i + 1} — ${d.date}`];
    if (w) {
      const parts = [`${Math.round(w.tempMinC)}-${Math.round(w.tempMaxC)}C`];
      if (w.precipitationProbability !== null) parts.push(`${w.precipitationProbability}% rain`);
      const sunset = w.sunset?.split("T")[1]?.slice(0, 5);
      const sunrise = w.sunrise?.split("T")[1]?.slice(0, 5);
      if (sunrise && sunset) parts.push(`daylight ${sunrise}-${sunset}`);
      if (w.historical) parts.push("(typical, not a live forecast)");
      bits.push(parts.join(", "));
    } else {
      bits.push(d.weather || "weather unknown");
    }
    return `- ${bits.join(": ")}`;
  });

  // The profile the traveler already gave at planning time. Without this the model re-asks what
  // interests them and how much walking they want — questions they have already answered once.
  const profile = answers
    ? `

## Traveler (already answered — never ask these again)
priorities: ${answers.topPriorities?.length ? answers.topPriorities.join(" > ") : answers.priorities?.join(", ") || "none stated"}${
        answers.priorities?.length ? `\nalso interested in: ${answers.priorities.join(", ")}` : ""
      }
energy: ${answers.energy ?? "unknown"} (walking/stairs tolerance)
crowds: ${answers.crowds ?? "unknown"}
group: ${answers.group ?? "unknown"}${answers.group === "other" && answers.groupOther?.trim() ? ` (${answers.groupOther.trim()})` : ""}${
        answers.party
          ? `\nparty: ${answers.party.adults} adults, ${answers.party.children} children (2-11), ${answers.party.infants} infants (under 2)`
          : ""
      }${
        answers.logistics?.arrivalTime || answers.logistics?.arrivalPoint
          ? `\narrival (day 1): ${answers.logistics.arrivalTime ?? "time unknown"}${answers.logistics.arrivalPoint ? ` at ${answers.logistics.arrivalPoint}` : ""}`
          : ""
      }${
        answers.logistics?.departureTime || answers.logistics?.departurePoint
          ? `\ndeparture (last day): ${answers.logistics.departureTime ?? "time unknown"}${answers.logistics.departurePoint ? ` from ${answers.logistics.departurePoint}` : ""}`
          : ""
      }
explorer_style: ${answers.explorerStyle ?? "unknown"}${answers.purpose?.trim() ? `\npurpose: ${answers.purpose.trim()}` : ""}`
    : "";

  return `# Trip Context (frozen for this edit session)

## Trip
${trip.destination} — ${trip.startDate} to ${trip.endDate} (${itinerary.days.length} days)
budget_usd: ${trip.budget}
tier: ${itinerary.tier}${tier ? ` — ${tier.description}` : ""}

## Daily conditions
${dayLines.join("\n")}${profile}

These facts are fixed. Do not assume any fact not stated here — if something needed to judge a
change isn't present (opening hours, exact travel time), say so in the change note rather than
inventing it.`;
}
