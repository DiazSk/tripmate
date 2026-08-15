import { DayPlan, Itinerary, Stop } from "./types";

/** The op vocabulary both modes answer in. Kept identical across the two so the applier and the
 *  response shape never diverge. */
const OPS_SHAPE = `{"op":"replace_stop","dayIndex":0,"stopIndex":0,"stop":{"name":"...","lat":0.0,"lng":0.0,"cost":0,"why":"one line","note":"one line","time":"9:00 AM","durationLabel":"1 hour","category":"food|entry|transit|other"}}`;

/** Trimmed view of the itinerary: enough to reason about geography, timing and sequence without
 *  spending tokens on fields an edit never consults. */
function compactDay(day: DayPlan, dayIndex: number): string {
  const stops = day.stops
    .map(
      (s, i) =>
        `    stopIndex=${i}: ${s.name} — ${s.time || "no time"}, ${s.durationLabel || "no duration"}, $${s.cost}, ${s.lat.toFixed(3)}/${s.lng.toFixed(3)}${s.note ? ` — ${s.note}` : ""}`
    )
    .join("\n");
  // Both numbers, always: the traveler says "day 1" meaning the first day, while ops address
  // days 0-indexed. Showing only one of them got the wrong day edited.
  return `  Day ${dayIndex + 1} of the trip — dayIndex=${dayIndex} (${day.date})${day.lodging ? ` — staying: ${day.lodging.name} ($${day.lodging.cost})` : ""}\n${stops || "    (no stops)"}`;
}

/** Every day, always — even when only one is editable.
 *
 *  Showing just the target day let the model add a stop that already exists on another day, since
 *  it had no way to see the rest of the trip. Other days are marked read-only rather than hidden. */
export function compactItinerary(itinerary: Itinerary, editableDayIndex?: number): string {
  return itinerary.days
    .map((d, i) => {
      const body = compactDay(d, i);
      if (editableDayIndex === undefined || i === editableDayIndex) return body;
      return body.replace(/^ {2}Day/, "  [read-only, do not change] Day");
    })
    .join("\n");
}

const SHARED_RULES = `The planning rules above remain in force for anything you change: sequencing and geography, the mobility and crowd constraints, opening hours and daylight, and the budget. An edit may not produce a plan the rules would have rejected.

Return ONLY minimal operations describing what changes. Never restate stops you are not changing — anything you don't name is preserved automatically. Never include your reasoning.`;

/**
 * MODE A — conversational, whole-trip or whole-day.
 *
 * Multi-turn and exploratory: the transcript is replayed each turn so the model can draw out what
 * the traveler actually wants across several exchanges. Still emits patches, not a rewrite — a
 * from-scratch redo only happens if the traveler explicitly asks for one.
 */
export function buildChatEditPrompt(params: {
  skill: string;
  editContext: string;
  itinerary: Itinerary;
  /** Set for a day-scoped chat; omitted for whole-trip. */
  dayIndex?: number;
  messages: { role: "user" | "assistant"; content: string }[];
}): string {
  const scope =
    params.dayIndex === undefined
      ? "the whole trip"
      : `day ${params.dayIndex + 1} of the trip (dayIndex=${params.dayIndex}) only — do not change any other day`;

  const transcript = params.messages
    .map((m) => `${m.role === "user" ? "Traveler" : "You"}: ${m.content}`)
    .join("\n");

  return `<planning_rules>
${params.skill}
</planning_rules>

<trip_context>
${params.editContext}
</trip_context>

<current_itinerary>
${compactItinerary(params.itinerary, params.dayIndex)}

The trip already includes every stop listed above. Never add a place that already appears on any day, editable or read-only — pick a different one instead.
</current_itinerary>

<conversation>
${transcript}
</conversation>

You are helping the traveler refine this itinerary through conversation. Scope: ${scope}.

Answer their latest message.

Only return operations when the traveler has actually ASKED FOR A CHANGE. If they asked a question, wondered aloud, or invited an opinion ("is day 1 too packed?", "what do you think of..."), answer it and return an EMPTY ops array — you may suggest what you would change and offer to do it, but do not change their plan until they say yes. Changing a plan someone only asked about is worse than being unhelpful.

When they do ask for a change, JUST MAKE IT. Do not interview them first. You already know who they are — their priorities, energy, crowd tolerance, group and style are in the trip context above, and the trip's dates, weather and budget are there too. Never ask about anything already answered there.

Decide the rest yourself from sensible defaults and say what you assumed in one short line. "Add more to my day" means fill the day's obvious gaps using their stated priorities — not "what time do you arrive?" and "what interests you?".

Ask a question ONLY if the change is genuinely impossible to attempt without it, and then ask at most ONE, and still apply whatever part of the request you can. When you do ask, always provide 2-4 concrete tappable answers in "options" so they can tap instead of type.

When the traveler refers to "day N", they mean the Nth day of the trip — that is dayIndex=N-1. Always copy the exact dayIndex and stopIndex values shown above rather than counting them yourself.

${SHARED_RULES}

Respond with ONLY valid JSON, no markdown fences:
{"reply":"conversational answer to their message, 1-3 sentences","options":["short tappable reply","another"],"changes":["one short line per change, in plain language"],"knockOn":"one line if a change forced an unavoidable adjustment elsewhere, else null","ops":[${OPS_SHAPE}]}

"options" must be an empty array unless you asked a question. Each option is what the traveler would tap to answer it — under 6 words, and directly usable as their next message.`;
}

/**
 * MODE B — one element, one time span, near-one-shot.
 *
 * Scope-locked by construction: only the target slot is offered for replacement, and the applier
 * rejects any op that lands elsewhere. Neighbours are supplied read-only so the replacement can
 * be judged against the day's route and timing without licence to change them.
 */
export function buildElementEditPrompt(params: {
  skill: string;
  editContext: string;
  dayIndex: number;
  stopIndex: number;
  day: DayPlan;
  target: Stop;
  instruction: string;
}): string {
  const { day, stopIndex } = params;
  const before = stopIndex > 0 ? day.stops[stopIndex - 1] : null;
  const after = stopIndex < day.stops.length - 1 ? day.stops[stopIndex + 1] : null;
  const neighbour = (s: Stop | null, label: string) =>
    s
      ? `${label}: ${s.name} — ${s.time || "no time"}, ${s.lat.toFixed(3)}/${s.lng.toFixed(3)}`
      : `${label}: none`;

  return `<planning_rules>
${params.skill}
</planning_rules>

<trip_context>
${params.editContext}
</trip_context>

<slot>
Day ${params.dayIndex + 1} of the trip — dayIndex=${params.dayIndex} (${day.date}), stopIndex=${stopIndex} of ${day.stops.length}
Current: ${params.target.name} — ${params.target.time || "no time"}, ${params.target.durationLabel || "no duration"}, $${params.target.cost}, ${params.target.lat.toFixed(3)}/${params.target.lng.toFixed(3)}
${neighbour(before, "Previous stop")}
${neighbour(after, "Next stop")}
</slot>

The traveler wants this ONE stop changed: "${params.instruction}"

Replace only this stop, keeping its time window workable between the neighbours shown. The replacement must fit the day's geography (it sits between those two stops), the slot's timing, and the trip context's conditions for that day. Do not move, add or remove any other stop — the surrounding plan is fixed.

${SHARED_RULES}

Respond with ONLY valid JSON, no markdown fences:
{"changes":["one short line describing the swap"],"why":"one line on why this replacement fits","knockOn":"one line if the next leg's travel note must shift, else null","ops":[${OPS_SHAPE}]}`;
}
