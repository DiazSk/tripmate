import { LEAD_DAYS, addDays, ideaToPrefill } from "./homeIdeas";
import type { IdeaRead } from "./ideaRead";
import type { PlanPrefill } from "./planExamples";
import { SCOPE_BLOCK_WITH_REFUSAL, tagUserText } from "./promptScope";

/**
 * Meri's answers to travel questions ("when's the best time to go?", "where should I eat?"), held
 * to facts that were fetched for this question. Pure on purpose, like ideaRead.ts: no DB, no fetch,
 * no Next, so the phone can import it through `@shared/*`.
 *
 * The model is handed an `Evidence` bundle and asked to cite it by id. Nothing it wrote reaches a
 * traveller except through `parseMeriAnswer`: places, months and sources are rendered from the
 * evidence records the ids point at, and any id or quoted name the evidence does not contain
 * replaces the whole answer with the honest line rather than a trimmed one.
 */

export type QuestionKind = "best_time" | "food" | "see" | "entry" | "other";

export interface EvidenceSource {
  id: string;
  label: string;
  url?: string;
}

export interface EvidencePlace {
  id: string;
  name: string;
  lat: number;
  lng: number;
  detail?: string;
  sourceId: string;
}

export interface Evidence {
  sources: EvidenceSource[];
  places: EvidencePlace[];
  /** 1-12: the months the fetched climate data covers. */
  months: number[];
  /** Short fetched statements, e.g. "July: 33°C average high, 0 rain days". */
  facts: { text: string; sourceId: string }[];
}

export interface MeriAnswer {
  answer: string;
  places: EvidencePlace[];
  months: number[];
  sources: EvidenceSource[];
  nothingChecked: boolean;
}

export const NOTHING_CHECKED = "I don’t have anything checked on that yet.";

/** Entry rules depend on the traveller's passport and change often, so no model and no evidence: a fixed line. */
export const ENTRY_LINE = "Entry rules depend on your passport and change often, so check your government’s travel advice for {place} before you book.";

export function nothingCheckedAnswer(): MeriAnswer {
  return { answer: NOTHING_CHECKED, places: [], months: [], sources: [], nothingChecked: true };
}

export function entryAnswer(place: string): MeriAnswer {
  return { answer: ENTRY_LINE.replace("{place}", place), places: [], months: [], sources: [], nothingChecked: false };
}

const KIND_LINES: Record<QuestionKind, string> = {
  best_time: "When is the best time to go.",
  food: "Where to eat.",
  see: "What to see.",
  entry: "Entry requirements.",
  other: "A travel question.",
};

export function buildAnswerPrompt(question: string, kind: QuestionKind, place: string, evidence: Evidence): string {
  const sourceLabel = (id: string) => evidence.sources.find((s) => s.id === id)?.label ?? id;
  const places = evidence.places.map((p) => `${p.id} · ${p.name}${p.detail ? ` · ${p.detail}` : ""} (${sourceLabel(p.sourceId)})`);
  const facts = evidence.facts.map((f) => `${f.text} (${sourceLabel(f.sourceId)})`);
  return `${SCOPE_BLOCK_WITH_REFUSAL}

Answer the traveller's question about ${place}, using only the evidence below. Kind of question: ${KIND_LINES[kind]}

${tagUserText(question)}

<evidence>
Sources:
${evidence.sources.map((s) => `${s.id} · ${s.label}`).join("\n") || "(none)"}

Places:
${places.join("\n") || "(none)"}

Months with climate data: ${evidence.months.join(", ") || "(none)"}

Facts:
${facts.join("\n") || "(none)"}
</evidence>

Return exactly one JSON object and nothing else:
{"answer": string, "places": string[], "months": number[], "sources": string[], "nothing": boolean}

Rules:
- answer is 1 to 4 sentences. Use only what the evidence says; add nothing from memory.
- Mention a place only if it is listed above, by its exact name, and put its id in places. Put a month number in months only if the facts cover it.
- sources lists the id of every source you used. An answer that used none is not an answer.
- If the evidence does not answer the question, return {"answer": "", "places": [], "months": [], "sources": [], "nothing": true}.`;
}

/** Names the answer sets off in quotes or bold: the way a model names a venue. */
function quotedNames(answer: string): string[] {
  const out: string[] = [];
  for (const m of answer.matchAll(/"([^"]+)"|“([^”]+)”|\*\*([^*]+)\*\*/g)) out.push((m[1] ?? m[2] ?? m[3]).trim());
  return out;
}

/** Never throws: anything that cannot be vouched for by the evidence is `nothingCheckedAnswer()`. */
export function parseMeriAnswer(raw: string, evidence: Evidence): MeriAnswer {
  let v: unknown;
  try {
    // Fence-strip like parseIdeaRead, then fall back to the outermost braces for prose around the JSON.
    const t = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try {
      v = JSON.parse(t);
    } catch {
      v = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
    }
  } catch {
    return nothingCheckedAnswer();
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return nothingCheckedAnswer();
  const o = v as Record<string, unknown>;
  if (o.refused !== undefined || o.nothing === true) return nothingCheckedAnswer();

  const answer = typeof o.answer === "string" ? o.answer.trim() : "";
  const ids = (x: unknown): string[] | null => (x === undefined ? [] : Array.isArray(x) && x.every((i) => typeof i === "string") ? (x as string[]) : null);
  const placeIds = ids(o.places);
  const sourceIds = ids(o.sources);
  const months = o.months === undefined ? [] : Array.isArray(o.months) ? (o.months as unknown[]) : null;
  if (!answer || !placeIds || !sourceIds || !months || sourceIds.length === 0) return nothingCheckedAnswer();

  const places = placeIds.map((id) => evidence.places.find((p) => p.id === id));
  const sources = sourceIds.map((id) => evidence.sources.find((s) => s.id === id));
  if (places.includes(undefined) || sources.includes(undefined)) return nothingCheckedAnswer();
  if (!months.every((m): m is number => typeof m === "number" && evidence.months.includes(m))) return nothingCheckedAnswer();

  const known = evidence.places.map((p) => p.name.toLowerCase());
  if (quotedNames(answer).some((n) => !known.includes(n.toLowerCase()))) return nothingCheckedAnswer();

  return {
    answer,
    places: [...new Set(places as EvidencePlace[])],
    months: [...new Set(months)],
    sources: [...new Set(sources as EvidenceSource[])],
    nothingChecked: false,
  };
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DEFAULT_DAYS = 4;

/** First day of the earliest best month still ahead; a month already under way starts a lead time out, as an idea's dates do. */
function bestMonthStart(months: number[], today: string): string {
  const now = Number(today.slice(5, 7));
  if (months.includes(now)) return addDays(today, LEAD_DAYS);
  const ahead = Math.min(...months.map((m) => (m - now + 12) % 12));
  return new Date(Date.UTC(Number(today.slice(0, 4)), now - 1 + ahead, 1)).toISOString().slice(0, 10);
}

/** The planner's fields from a question and what Meri answered: the idea's own, plus what the answer settled. */
export function answerToPrefill(read: IdeaRead, answer: MeriAnswer, today: string): PlanPrefill {
  const out = ideaToPrefill(read, today);
  const q = read.question;
  if (!out.destination && q?.place) out.destination = q.place;
  if (q?.kind === "best_time" && answer.months.length) {
    out.startDate = bestMonthStart(answer.months, today);
    out.endDate = addDays(out.startDate, (read.days ?? DEFAULT_DAYS) - 1);
  }
  if (q?.kind === "food" && q.diet) out.dietary = [...new Set([...(out.dietary ?? []), q.diet])];
  // There is no Sightseeing chip; Culture & History is the one a "what to see" answer is about.
  if (q?.kind === "see") out.interests = [...new Set([...(out.interests ?? []), "Culture & History"])];
  return out;
}

/** The button that carries an answer into the planner. */
export function answerPlanLabel(read: IdeaRead, answer: MeriAnswer): string {
  const place = (read.destination ?? read.question?.place ?? "").split(",")[0].trim();
  if (!place) return "Plan a trip";
  // ponytail: names the first month the answer gave; the prefill starts at the earliest one ahead, which may differ.
  return read.question?.kind === "best_time" && answer.months.length ? `Plan ${place} in ${MONTH_NAMES[answer.months[0] - 1]}` : `Plan a trip to ${place}`;
}
