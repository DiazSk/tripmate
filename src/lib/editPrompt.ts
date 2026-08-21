import { dayActiveSpan } from "./itinerary";
import type { DayPlan, Itinerary, Stop } from "./types";

/** The stop payload every op that writes a stop carries. */
const STOP_SHAPE = `{"name":"...","lat":0.0,"lng":0.0,"cost":0,"why":"one line","note":"one line","time":"9:00 AM","durationLabel":"1 hour","category":"food|entry|transit|other"}`;

/** Mode B answers in `replace_stop` alone — it is scope-locked to one slot, and the applier
 *  rejects everything else, so offering the rest would only invite rejected ops. */
const OPS_SHAPE = `{"op":"replace_stop","dayIndex":0,"stopIndex":0,"stop":${STOP_SHAPE}}`;

/** Mode A gets the applier's full vocabulary (see itineraryPatch.ts). It used to be handed
 *  `replace_stop` only, which quietly capped the conversation at swapping stops one-for-one:
 *  asked to add a stop or drop one, the model's only legal move was to overwrite a neighbour. */
const CHAT_OPS_SHAPE = [
  `{"op":"replace_stop","dayIndex":0,"stopIndex":0,"stop":${STOP_SHAPE}}`,
  `{"op":"add_stop","dayIndex":0,"stopIndex":2,"stop":${STOP_SHAPE}}`,
  `{"op":"remove_stop","dayIndex":0,"stopIndex":3}`,
  `{"op":"replace_lodging","dayIndex":0,"lodging":{"name":"...","cost":0,"note":"one line"}}`,
  `{"op":"add_day","dayIndex":3}`,
  `{"op":"remove_day","dayIndex":2}`,
].join(",");

/** What the ops above can and cannot express, and the index arithmetic that makes a multi-op
 *  patch land where it was aimed. Sequential application is the trap: two removes on one day
 *  written low-index-first delete the wrong second stop. */
const CHAT_CAPABILITIES = `You can, within the scope stated below:
- Add a stop ("add_stop" at the position it should occupy), remove one, or swap one for another
  ("replace_stop").
- Reorder a day: emit one "replace_stop" per position whose contents change, keeping the indices
  as they are now. Don't remove-then-re-add to reorder.
- Move a stop to a different day: "remove_stop" on the day it leaves, "add_stop" on the day it
  joins. Give it a time that works in its new day.
- Retime or re-length a stop: "replace_stop" with a new "time" and/or "durationLabel".
- Change a night's stay: "replace_lodging".
- Make the trip longer or shorter: "add_day" / "remove_day" (see the rules below).

Whenever you move, add, remove or retime anything, restate the "time" of every stop whose slot
shifted as a result, so the day stays in sequential order with no overlaps.

Ops apply in the order you list them, against an itinerary that is already changing as they do.
So: list several removals on the SAME day from the highest stopIndex down to the lowest, and treat
the indices shown below as valid only until your first op on that day. Ops on different days never
affect each other's indices.

Lengthening or shortening the trip:
- "add_day" inserts a NEW EMPTY day at that position ("dayIndex":3 on a 3-day trip appends a
  fourth; "dayIndex":1 inserts a day between today's day 1 and day 2 and pushes the rest later).
  "remove_day" drops a day and everything on it.
- Never set a date on anything. Days are consecutive calendar dates from the trip's start date, so
  the dates restate themselves after any day op — the trip's START date never moves, its END date
  moves out or in by one per day added or removed. Say the trip's new end date in your reply.
- A day you add arrives EMPTY. Fill it in the same batch: add its stops, and give it lodging unless
  it is now the last day. An empty day left behind is worse than not adding one.
- There is no weather forecast for a day that did not exist a moment ago. Don't state one, and
  prefer flexible choices there over anything that depends on the weather being right.
- More days almost always costs more. Check the total against the budget (§12d) and warn if it now
  overshoots — the budget does NOT grow just because the trip did.
- Order matters: list "add_day" BEFORE the ops that fill it, and remember every later dayIndex
  shifts by one once it applies.
- A trip must keep at least one day; "remove_day" on the only day will be refused.

What you still cannot do: change the destination, the budget, or the trip's start date. If the
traveler asks for one of those, say plainly that it can't be done from this chat and offer the
nearest thing you can.`;

/** Trimmed view of the itinerary: enough to reason about geography, timing and sequence without
 *  spending tokens on fields an edit never consults. */
function compactDay(day: DayPlan, dayIndex: number): string {
  const stops = day.stops
    .map(
      (s, i) =>
        `    stopIndex=${i}: ${s.name} — ${s.time || "no time"}, ${s.durationLabel || "no duration"}, $${s.cost}, ${s.lat.toFixed(3)}/${s.lng.toFixed(3)}${s.note ? ` — ${s.note}` : ""}`
    )
    .join("\n");
  // The day's end-to-end length, computed rather than left to be derived from the clock times
  // below — see dayActiveSpan. Without it the pace guardrail (§12c) got narrated in the reply
  // and then not acted on, because the model had to do the arithmetic before it could compare.
  const span = dayActiveSpan(day);
  const spanNote = span
    ? ` — runs ${span.start}-${span.end}, ${(span.minutes / 60).toFixed(1).replace(/\.0$/, "")}h active`
    : "";
  // Both numbers, always: the traveler says "day 1" meaning the first day, while ops address
  // days 0-indexed. Showing only one of them got the wrong day edited.
  return `  Day ${dayIndex + 1} of the trip — dayIndex=${dayIndex} (${day.date})${spanNote}${day.lodging ? ` — staying: ${day.lodging.name} ($${day.lodging.cost})` : ""}\n${stops || "    (no stops)"}`;
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
  const target = params.dayIndex === undefined ? undefined : params.itinerary.days[params.dayIndex];
  const scope =
    params.dayIndex === undefined
      ? "the whole trip"
      : `day ${params.dayIndex + 1} of the trip (dayIndex=${params.dayIndex}${target ? `, ${target.date}` : ""}) only — do not change any other day`;

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

${CHAT_CAPABILITIES}

Before you answer, check the plan your ops would PRODUCE — not the one you started from — against each §12 guardrail: travel time between consecutive stops, opening hours and time clashes, the day's total active hours (each day's current length is given as "runs X-Y, Nh active" — work out what your ops do to it), and the trip's total against the budget. Restructure to satisfy them wherever you can.

Every check that still fails goes in "warnings", one line each — plain, specific, and quantified where you have the number ("day 1 now runs 8:00 AM to 8:30 PM, about 12 active hours"; "Nijo Castle to the bamboo grove is ~30 min across the city, so 4:30 PM is tight"). No leading emoji and no "Warning:" label — the UI supplies those.

The traveler having asked for it is NOT a reason to leave it out. "I don't mind a long day" tells you to make the change, not to keep quiet about what it costs them: make it AND warn. Likewise, anything you say in "reply" about hours, travel time, or the budget belongs in "warnings" too — the reply is conversation, "warnings" is the record. An empty "warnings" array claims every guardrail actually passed, so only send one when that is true.

${SHARED_RULES}

Respond with ONLY valid JSON, no markdown fences:
{"reply":"conversational answer to their message, 1-3 sentences","options":["short tappable reply","another"],"changes":["one short line per change, in plain language"],"warnings":["one line per guardrail worth flagging"],"knockOn":"one line if a change forced an unavoidable adjustment elsewhere, else null","ops":[${CHAT_OPS_SHAPE}]}

"ops" may mix the op types shown above. "warnings" is an empty array when nothing tripped a guardrail. "options" must be an empty array unless you asked a question. Each option is what the traveler would tap to answer it — under 6 words, and directly usable as their next message.`;
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
