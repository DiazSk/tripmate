import { SCOPE_BLOCK_WITH_REFUSAL, tagUserText } from "./promptScope";
import type { QuestionKind } from "./meriAnswer";
import { MAX_TRIP_DAYS } from "./tiers";

/**
 * Reading a traveller's one-sentence trip idea ("4 slow days in Lisbon under $2,000 for two") into
 * the planner's fields. Pure on purpose: the phone app imports this file through `@shared/*`, so it
 * reaches no DB and no Next. The route that asks the model is `/api/read-idea`.
 *
 * Nothing the model wrote reaches a client except through `parseIdeaRead`'s field-by-field
 * validation, which is why the route has no reply-length check.
 */

/** The ready-made trips' vocabulary, so a read can pick the chips a traveller would have tapped. */
export const IDEA_TAGS = ["Desert", "Coast", "Food", "Mountains", "History", "City", "Nature", "Winter", "Islands", "Wine"] as const;
export type IdeaTag = (typeof IDEA_TAGS)[number];

/** The planner's interest chips, verbatim. */
export const IDEA_INTERESTS = [
  "Food",
  "Wellness & Fitness",
  "Culture & History",
  "Nightlife",
  "Nature & Outdoors",
  "Shopping",
  "Family-Friendly",
  "Relaxation",
  "Photography",
] as const;

/** The planner's dietary chips, verbatim (both clients' DIETARY_TAGS). A need the plan keeps, not a taste. */
export const IDEA_DIETS = ["Vegetarian", "Vegan", "Pescatarian", "Halal", "Kosher", "Gluten-free", "Dairy-free", "Nut allergy"] as const;

/** `undefined`-free on purpose: `null` is "the sentence did not say", so the client keeps its own default. */
export interface IdeaRead {
  /** A place a geocoder can read ("Lisbon, Portugal"), or null. */
  destination: string | null;
  /** What was asked for instead of a place ("somewhere warm"), or null. */
  kind: string | null;
  /** Integer 1..MAX_TRIP_DAYS. */
  days: number | null;
  /** USD, > 0. */
  budget: number | null;
  budgetBasis: "per_person" | "whole_party" | null;
  /** 1..12. */
  adults: number | null;
  /** 0..12. */
  children: number | null;
  pace: "relaxed" | "balanced" | "packed" | null;
  interests: string[];
  tags: IdeaTag[];
  /** Tags the traveller ruled out ("no food tours", "anything but a city"). A matcher excludes
   *  them; leaving a refusal out of `tags` alone would still offer the trip that has it. */
  avoidTags: IdeaTag[];
  /** What the traveller must eat or avoid ("halal food", "no nuts"), from `IDEA_DIETS`. */
  dietary: string[];
  /** Set when the sentence asks about a place rather than describing a trip to plan. `destination`
   *  still holds the same place, so the idea path works if the answer step is skipped. */
  question: { kind: QuestionKind; place: string | null; diet: string | null } | null;
}

const QUESTION_KINDS = ["best_time", "food", "see", "entry", "other"] as const;

/** What the box takes. The route checks it before the model sees a character. */
export const IDEA_MAX_CHARS = 500;

// Same as CAPS.destination; not imported because inputLimits pulls in next/server.
const DESTINATION_MAX = 200;

export function buildIdeaReadPrompt(idea: string, today: string): string {
  return `${SCOPE_BLOCK_WITH_REFUSAL}

Read the traveller's one-sentence trip idea into planner fields. Today is ${today}, so a month or season is read against it, but return no date.

${tagUserText(idea)}

Return exactly one JSON object and nothing else:
{"destination": string|null, "kind": string|null, "days": integer|null, "budget": number|null, "budgetBasis": "per_person"|"whole_party"|null, "adults": integer|null, "children": integer|null, "pace": "relaxed"|"balanced"|"packed"|null, "interests": string[], "tags": string[], "avoidTags": string[], "dietary": string[], "question": {"kind": "best_time"|"food"|"see"|"entry"|"other", "place": string|null, "diet": string|null}|null}

Rules:
- Use null (or [] for the lists) for anything the sentence did not say. Never guess a field it did not give.
- destination is a place a geocoder can read, such as "Lisbon, Portugal". A region like "the Algarve" is a destination. If they named no place and asked for a kind of trip instead, such as "somewhere warm", leave destination null and put that in kind.
- days is 1 to ${MAX_TRIP_DAYS}. budget is a number in US dollars. budgetBasis is "per_person" or "whole_party" as they said it; null if the sentence gave a budget without saying which.
- adults is 1 to 12 and children 0 to 12. "for two" is 2 adults; "a couple" is 2 adults.
- pace: "slow" or "easy" is relaxed, "packed" or "see everything" is packed.
- interests: choose only from ${IDEA_INTERESTS.map((i) => `"${i}"`).join(", ")}.
- tags: choose only from ${IDEA_TAGS.map((t) => `"${t}"`).join(", ")}.
- avoidTags: from the same list, only the ones the traveller ruled out ("no food tours" is Food, "anything but a city" is City, "nothing historic" is History). A ruled-out tag never goes in tags.
- dietary: choose only from ${IDEA_DIETS.map((d) => `"${d}"`).join(", ")}, and only what the traveller said they must eat or avoid ("halal food" is Halal, "no nuts" is Nut allergy). A cuisine they would enjoy is an interest, not a diet.
- question is null when the sentence describes a trip to plan, even if it ends in "?". Otherwise it is a travel question: kind is "best_time" (when to go), "food" (where or what to eat), "see" (what to see or do), "entry" (visas, passports, entry rules) or "other" (any other travel question). place is the place asked about, as a geocoder reads it, or null. diet is from the dietary list above when the question names one. A question still fills destination with the same place.`;
}

const int = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;

const text = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim().slice(0, DESTINATION_MAX) : "";
  return s || null;
};

const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;

const subset = <T extends string>(v: unknown, allowed: readonly T[]): T[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is T => pick(x, allowed) !== null))] : [];

/** Null when absent or not an object; an unknown kind is "other", since it was still a question. */
function parseQuestion(v: unknown): IdeaRead["question"] {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const q = v as Record<string, unknown>;
  return { kind: pick(q.kind, QUESTION_KINDS) ?? "other", place: text(q.place), diet: pick(q.diet, IDEA_DIETS) };
}

/** How much of the sentence was understood: fields with a value plus lists with something in them. Counts only, for analytics. */
export function ideaFieldCount(read: IdeaRead): number {
  // The question is not a trip field: it says what the sentence is, not what it asked for.
  return Object.entries(read).filter(([k, v]) => k !== "question" && (Array.isArray(v) ? v.length > 0 : v !== null)).length;
}

/** Null when the reply is not a JSON object or is the refusal shape; otherwise every field validated. */
export function parseIdeaRead(raw: string): IdeaRead | null {
  let v: unknown;
  try {
    // Same fence-strip-and-parse as parseJsonResponse in claude.ts (see isRefusalShape).
    v = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (o.refused !== undefined) return null;
  // A refusal wins over a want: a tag in both lists is one the traveller said no to.
  const avoidTags = subset(o.avoidTags, IDEA_TAGS);
  return {
    destination: text(o.destination),
    kind: text(o.kind),
    days: int(o.days, 1, MAX_TRIP_DAYS),
    budget: typeof o.budget === "number" && Number.isFinite(o.budget) && o.budget > 0 ? o.budget : null,
    budgetBasis: pick(o.budgetBasis, ["per_person", "whole_party"] as const),
    adults: int(o.adults, 1, 12),
    children: int(o.children, 0, 12),
    pace: pick(o.pace, ["relaxed", "balanced", "packed"] as const),
    interests: subset(o.interests, IDEA_INTERESTS),
    tags: subset(o.tags, IDEA_TAGS).filter((t) => !avoidTags.includes(t)),
    avoidTags,
    dietary: subset(o.dietary, IDEA_DIETS),
    question: parseQuestion(o.question),
  };
}
