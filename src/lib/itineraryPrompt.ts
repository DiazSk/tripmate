// `import type` on everything that is only a type: Node erases those, which is the difference
// between this module being reachable from a `.test.mjs` and not (see CLAUDE.md). `TIERS` and
// the two formatters are real values and keep ordinary imports.
import type { DayWeather } from "./weather";
import type { BikeshareSystem } from "./bikeshare";
import type {
  Anchor,
  DestinationContext,
  Itinerary,
  ItineraryPreferences,
  ResolvedFlags,
  TripLogistics,
  UserAnswers,
} from "./types";
import { TIERS } from "./tiers";
import type { TierId } from "./tiers";
import { formatRequirements, formatTravelLegs, formatTravelerProfile } from "./travelerProfilePrompt";
import { formatDietary } from "./dietaryPrompt";
import {
  budgetInstruction,
  lodgingInstruction,
  lodgingPricingBasis,
} from "./lodgingPrompt";
import { formatPlaceConflicts } from "./placeConflicts";
import type { PlaceConflict } from "./placeConflicts";
import type { DietaryNeeds } from "./travelerProfile";
import { NO_EM_DASH_RULE } from "./writingStyle";

/**
 * One stop's shape.
 *
 * **`category` must stay last, and that is load-bearing rather than tidy.**
 * `streamingItinerary.ts`'s `isRenderableStop` gates emission on `category` being present,
 * precisely because it is the final field here — so an object that has one has all of them. A
 * field appended *after* `category` would start releasing half-written stops to the generation
 * screen, with nothing thrown and nothing logged. New fields go in front of it.
 */
const STOP_SHAPE = `{"name":"stop name","lat":0.0,"lng":0.0,"cost":0,"why":"one line: why this stop suits this traveler","note":"one line: practical detail","time":"9:00 AM","durationLabel":"1 hour","outdoor":false,"timeFlexibility":"FIXED|PREFERRED","category":"food|entry|transit|other"}`;

/**
 * One day's shape, shared by every prompt that asks for days back.
 *
 * Shared because it drifted, and the drift lost data. `SHAPE_HINT` listed `summary` and the
 * critique and rebalance shapes did not — and since both of those return a whole corrected day
 * set that replaces the original wholesale, a model following its own prescribed shape silently
 * erased every day's narrative, which `ItineraryCard` renders. Three literals meant nothing made
 * the omission visible. One literal means a field added here reaches all three, and `carryOverDaySummaries`
 * in itinerary.ts covers the case where a model ignores the shape anyway.
 */
/**
 * **`weather` is conditional, and that is a correctness fix rather than tidying.**
 *
 * This shape used to require a `weather` string on every day. `formatWeather` truthfully reports
 * "No weather data available." when the forecast lookup found nothing — and the model, handed no
 * data and a mandatory field, complied: a real stored Lisbon day reads "Pleasant autumn day,
 * 18.9-23.5°C, mostly sunny", temperatures and all, none of it observed. Asking for a field
 * nobody can fill is how a planner is made to invent.
 *
 * `dayShape` therefore omits the field entirely when there is nothing to base it on, and
 * `CLAIMS_POLICY` below says the same thing in prose so the two cannot be read apart.
 */
const dayShape = (hasWeather: boolean) =>
  `{"date":"YYYY-MM-DD",${hasWeather ? `"weather":"short weather summary",` : ``}"theme":"2-5 word identity for the day","summary":"1-2 sentence elegant narrative capturing the day's theme and flow","lodging":{"name":"lodging name","cost":0,"note":"short note"},"stops":[${STOP_SHAPE}]}`;

/**
 * Whether these days carry weather at all.
 *
 * The critique and rebalance prompts hand the model days it must return in the same shape. If
 * generation omitted `weather` because there was no forecast and *these* asked for it back, the
 * revision would reintroduce exactly the invention the omission prevents — and it would arrive
 * on the second pass, where nobody is looking. The three shapes move together or the fix leaks.
 */
const daysCarryWeather = (days: Itinerary["days"]) => days.some((d) => !!d.weather?.trim());
const shapeHint = (hasWeather: boolean) =>
  `{"days":[${dayShape(hasWeather)}],"unplaced":[{"name":"one of the traveler's MUST places","reason":"one concrete line"}]}`;



// Concrete stop-selection guidance per interest tag — generic "weight toward
// this interest" phrasing wasn't specific enough to reliably avoid the
// itinerary just defaulting to the same generic tourist stops with a
// different note attached.
const INTEREST_GUIDANCE: Record<string, string> = {
  Food: "prioritize street food markets, local food festivals or events, and iconic casual eateries over generic sit-down tourist restaurants",
  "Wellness & Fitness":
    "prioritize wellness centers, spas, yoga studios, parks good for running/walking, and health-focused cafes",
  "Culture & History":
    "prioritize museums, historic sites, and cultural landmarks with genuine significance over generic photo-op spots",
  Nightlife: "prioritize live music venues, bars, and evening social spots",
  "Nature & Outdoors": "prioritize parks, hikes, and scenic outdoor spots",
  Shopping: "prioritize distinctive local markets and boutique districts over generic malls",
  "Family-Friendly": "prioritize kid-friendly attractions and an easygoing pace",
  Relaxation: "prioritize slower-paced days, spas, and scenic downtime over packed sightseeing",
};

function formatPreferences(preferences?: ItineraryPreferences | null): string {
  // **`tags` is typed as required and is not guaranteed to be there.** `POST /api/itinerary`
  // spreads an unvalidated JSON body, and its own route calls itself "the trust boundary" — so a
  // caller that sends `preferences` without `tags` reached `.length` on undefined and took the
  // whole generation down with an unhandled TypeError, 26 seconds in, *after* the context call
  // had already been paid for. The traveller saw "The planner didn't finish".
  //
  // One coalesce here rather than four guards below, because all four readers are in this
  // function and nothing else in the codebase touches `preferences.tags`.
  const tags = preferences?.tags ?? [];
  if (!preferences || (tags.length === 0 && !preferences.vibe)) return "";
  const parts: string[] = [];
  if (preferences.vibe) parts.push(`leans toward a "${preferences.vibe}" vibe`);
  if (tags.length > 0) parts.push(`especially interested in ${tags.join(", ")}`);

  const guidance = tags
    .map((tag) => INTEREST_GUIDANCE[tag])
    .filter((line): line is string => Boolean(line));

  let out = `\nTraveler preferences: ${parts.join("; ")}.\n`;
  if (guidance.length > 0) {
    out += `For these interests: ${guidance.join("; ")}.\n`;
  }
  out += `Let these interests genuinely shape which stops are chosen, not just the notes. Avoid a generic, one-size-fits-all tourist itinerary. Don't ignore the weather/budget constraints above while doing so.\n`;
  return out;
}

export function formatWeather(weather: DayWeather[]): string {
  if (weather.length === 0) return "No weather data available.";
  return weather
    .map(
      (w) =>
        `${w.date}: ${w.tempMinC}-${w.tempMaxC}C${
          w.precipitationProbability !== null
            ? `, ${w.precipitationProbability}% chance of rain`
            : ""
        }${w.historical ? " (typical weather, not a live forecast)" : ""}`
    )
    .join("\n");
}

export function formatContextInsight(context: DestinationContext): string {
  const lines: string[] = [];
  if (context.festivals.length > 0) {
    lines.push(
      `Festivals/events: ${context.festivals
        .map((f) => `${f.name} (${f.dates}): ${f.note}`)
        .join("; ")}`
    );
  }
  if (context.safety.length > 0) {
    lines.push(
      `Safety notes: ${context.safety.map((s) => `[${s.severity}] ${s.note}`).join("; ")}`
    );
  }
  if (context.shopping.length > 0) {
    lines.push(
      `Notable shopping areas: ${context.shopping
        .map((s) => `${s.name} (${s.area}): ${s.note}`)
        .join("; ")}`
    );
  }
  if (context.trends.length > 0) {
    lines.push(`Current trends: ${context.trends.map((t) => t.note).join("; ")}`);
  }
  return lines.join("\n");
}

/**
 * What the destination's bikeshare lets the model do, or nothing at all.
 *
 * Returns "" when no system resolved, and that is the important case: an absent block means the
 * model plans exactly as it did before this existed. It must never be told "this city has no
 * bikeshare", because `bikeshare.ts` cannot tell an unmatched city from a bikeless one.
 *
 * The fare line is conditional for the same reason. GBFS rarely publishes a legible day pass —
 * Vélib' and BIXI publish no pricing feed at all, Citi Bike publishes only a per-minute e-bike
 * rate — so the usual instruction is to send the traveler to the operator rather than to invent a
 * number that would land in the budget.
 */
function formatBikeshare(system?: BikeshareSystem | null): string {
  if (!system) return "";
  const fare = system.dayPass
    ? `A day pass costs about ${system.dayPass.amount} ${system.dayPass.currency}; use that figure for any bike leg you add.`
    : `Its fare is not published in a form worth quoting, so don't state a price: put the cost at 0 and say in the note that passes are bought from the operator.`;
  return `\nGetting around: this city has a public bikeshare, ${system.name}, with roughly ${system.stationsNearby} docking stations near the centre. ${fare} Where two consecutive stops are between 1.5km and 8km apart, a shared bike is usually the pleasanter option and worth preferring over the metro, so say so in the stop's note. Don't force it: ignore the bike for a traveler whose profile says limited mobility or low energy, in heavy rain, or where the stops are walkable anyway.\n`;
}

const CONTEXT_USE_INSTRUCTION = `If a festival's dates overlap the trip, include it as a stop on the relevant day. Weigh the safety notes when choosing areas and timing. Include at least one shopping stop from the list if it fits the budget and tier.`;

/**
 * The one answer to "what wins when three valid rules disagree".
 *
 * The rules below (and in SKILL.md) each say "hard constraint", "authoritative", "priority" —
 * which is unambiguous one at a time and silent about a packed-pace traveler with low mobility, a
 * museum closing at 4pm and a 6pm reservation. Stating the order once is what makes the model
 * consistent across those, rather than picking a different winner each generation.
 *
 * Mirrored by SKILL.md §0. Move one, move both.
 */
export const PRECEDENCE_INSTRUCTION = `When two of these conflict, this is the order that decides it, highest first:
1. Fixed commitments and immutable facts: booked flights, trains, accommodation, timed tickets, anything the traveler says cannot move.
2. Safety and accessibility: stated accessibility needs, dietary and allergy requirements, destination safety notes.
3. Physical and temporal feasibility: opening hours, travel time, arrival and departure boundaries, daylight, realistic stop duration.
4. Explicit traveler requirements and exclusions: must-dos, do-not-includes, transport restrictions, the budget ceiling.
5. Traveler profile: pace, energy, crowd preference, group and family rules.
6. Primary (starred) interests.
7. Secondary interests and vibe.
8. Variety, aesthetics and optimization.
A lower item never silently overrides a higher one. When two hard constraints genuinely cannot both hold, keep the higher one and say plainly in the affected stop's note that the other could not be met.`;

function formatContextBlock(insight?: string): string {
  if (!insight) return "";
  return `\nDestination context:\n${insight}\n${CONTEXT_USE_INSTRUCTION}\n`;
}

function tierStyle(tierId: TierId): string {
  const tier = TIERS.find((t) => t.id === tierId) ?? TIERS[1];
  return `${tier.name} tier: ${tier.description}.`;
}

/** The two lines that replaced the old tag chips. Kept deliberately concrete: "one line" plus
 *  worked examples, because "short" alone produced a paragraph about half the time. */
/** The policy restated where the lines it most often breaks are specified. */
const CLAIMS_POLICY_REMINDER = `Neither line may claim anything you were not given: no weather, no light or time-of-day conditions, no claim about how busy or quiet a place is, no opening hours.`;

/**
 * **The examples here used to contradict the claims policy, and the examples won.**
 *
 * A measured run produced "arrive early to avoid crowds on the trails" — a claim about how busy
 * a place is, which §CLAIMS_POLICY forbids in plain words. It came from this instruction's own
 * model answer, which was "go before 10am to beat the crowds", and from "Quiet rock garden",
 * which asserts the same thing about a place nobody has measured. An instruction that says one
 * thing and demonstrates another teaches the demonstration; the emoji rule had the identical
 * failure before it was removed from its example.
 *
 * So both examples now show what a grounded practical line looks like: distance, sequence, a
 * physical property of the place. Nothing about conditions, crowds or times of day.
 */
const STOP_LINES_INSTRUCTION = `Each stop also needs exactly two one-line fields. "why": why THIS stop suits THIS traveler given their stated interests and how they travel: the reason it was chosen over alternatives, e.g. "Step-free rock garden, fits an easy-paced culture day". "note": one practical detail they'd act on, e.g. "10-minute walk from the last stop; tickets are sold at the north gate". Both must be a single line, under about 90 characters, and must not repeat the stop's name. ${CLAIMS_POLICY_REMINDER} ${NO_EM_DASH_RULE}`;

// Meals were coming back as a single committed restaurant every time, which reads
// like a booking and pins the day's route to one address. An area plus "what to look
// for" is both more honest and more usable — the specific venue is only worth naming
// when the venue itself is the reason to go there.
//
// **Tried and removed: "when you name a specific venue, the lat/lng must be that venue's own
// position, not the area's."** It is true, and it made things worse. A/B on the canonical
// Val d'Orcia trip, 2 runs per arm, each arm's prompt verified out of `generations` rather than
// from the file on disk: `scoreCoordinates` rose 31/33% to 45/41%, which reads as a win until
// you look at what moved. Named venues per plan fell 29/21 to 22/17 and the largest pile of
// stops on one coordinate GREW, 26 of 62 to 34 of 63 — over half the trip on the Pienza
// centroid. The model had swapped "Farewell dinner at La Grotta" and "Cantina Contucci" for
// "Dinner at local trattoria" and "Aperitivo at wine bar". Asked to give a named venue a real
// coordinate it does not know, the cheapest compliance is to name no venue.
//
// That is worse than the bug it targets, because **the repair path resolves stops by name**
// (`placeQuery` → Overpass here, `StopResolution` → MKLocalSearch on iOS). A wrong coordinate
// on "La Grotta" is fixable; "local trattoria" is not fixable by anything, ever. The prompt
// cannot carry this — it is a knowledge problem, and the model has no coordinates to give.
const FOOD_STOP_INSTRUCTION = `For "food" stops, prefer an AREA over a specific restaurant unless the place itself is the point (it's a landmark eatery, it needs a reservation, or a stated interest is the reason the day routes there). An area-level food stop uses the neighborhood/market as its "name" (e.g. "Dinner around Pike Place Market"), the area's approximate lat/lng, and a "why"/"note" that says what to look for there plus one or two example spots (e.g. "Seafood counters everywhere; e.g. Pike Place Chowder"). Never invent hours, wait times, or menu prices for an area-level stop. If a later meal returns to an area you already used for one, name the specific venue that time instead: a base in a small town otherwise yields four stops all called "Dinner in <that town>", which tells the traveler nothing about four different nights. The area must sit within or next to that part of the day's route; a meal should never pull the day across town.`;

/** The traveler's own places. The rule lives here, not in SKILL.md, because this legacy path never
 *  loads the skill — every rule it follows is a constant in this file. SKILL.md §15 carries the
 *  same rule for the edit loop, which does load it. Keep the two in step. */
const ANCHOR_INSTRUCTION = `Schedule every MUST place as a stop, on a day and at a time it is open, unless that is impossible: closed on every day the trip is near it, too far to reach and return within a day, or more MUST places than the days can hold. Fit WANT places where they suit a day's route; skipping one is fine. Use the traveler's name for the place in the stop's "name" so it can be recognised. For every MUST place you could not schedule, add an entry to the top-level "unplaced" array with a one-line, concrete reason (e.g. "Closed Tuesdays, the only day the plan is nearby"). Never drop a MUST place silently. Use "unplaced": [] when everything fits. Where a place's hours are given, they are OpenStreetMap data, so schedule it inside them; where none are given, do not state hours for it.`;

export function formatAnchors(anchors: Anchor[] | undefined): string {
  if (!anchors || anchors.length === 0) return "";
  const lines = anchors.map((a) => {
    const where = a.lat !== null && a.lng !== null ? `(${a.lat}, ${a.lng})` : "(location unknown)";
    // Raw OSM string always, plus "closed" only where the narrow parser is sure — "PH off" and
    // seasonal syntax pass through for the model to read rather than being guessed at here.
    const closed = a.closedDays && a.closedDays.length > 0 ? `; closed ${a.closedDays.join(", ")}` : "";
    const hours = a.openingHours ? `, open ${a.openingHours}${closed} (OpenStreetMap)` : "";
    return `- ${a.priority === "must" ? "MUST" : "WANT"}: ${a.name} ${where}${hours}`;
  });
  return `\nThe traveler's own places (they chose these before asking for a plan):\n${lines.join("\n")}\n${ANCHOR_INSTRUCTION}\n`;
}

// Lodging came back as the same mid-range city hotel every night regardless of who
// was travelling or where the days actually went. The type of stay is a real choice
// (hostel, B&B, apartment, camp, houseboat, farmstay) and often the memorable part of
// a trip — so pick the type from the traveler + destination first, and offer an
// alternative rather than presenting one property as settled.
/**
 * What the planner may assert about the world.
 *
 * Every item here is a real defect found on screen. The day badge carried an invented forecast;
 * a day narrative promised "catching sunset views" on a day whose solar times nobody had looked
 * up; a stop note explained how a café's queue currently works. Each reads as knowledge because
 * it is written in the same voice as the facts around it, and a reader has no way to tell them
 * apart.
 *
 * Stated as one rule rather than patched per string, because the failure is general: prose that
 * sounds travel-like is not evidence. The client enforces the same boundary from its side —
 * `weatherLine` will not render planner prose in the badge reserved for measured figures.
 */
const CLAIMS_POLICY = `Never state as fact anything you were not given. Specifically:
- No weather claim of any kind (conditions, temperatures, "pleasant", "mild", "rainy") unless daily weather was supplied above. If it was not, write nothing about weather anywhere, including in a day's summary or a stop's note.
- No sunrise, sunset, golden-hour or daylight claim ("catching sunset views", "before dark") unless sunrise/sunset times were supplied.
- No claim about how busy, quiet, crowded or queued a place is, and no operational advice about how it currently runs (which entrance, which counter, how to skip a line). You do not know these and they change.
- No opening or closing time unless it was supplied.
Describing why a place is worth going to, what it is, and how it fits the day is exactly what you are for. Asserting a fact about the world that nobody gave you is not.`;

const STOP_FIELD_INSTRUCTION = `Each stop needs: a realistic estimated cost in USD (what the WHOLE party pays there, never one person's share, so multiply a per-head price by the party size before writing it; 0 is fine for free attractions); a "time" (approximate start time, e.g. "9:00 AM"; times across a day's stops must be sequential and non-overlapping); a "durationLabel" (short human label, e.g. "1 hour", "45 minutes"); 1-2 short "tags" describing the stop (e.g. "Local Pick", "Reservation Needed", "Free", "Must-See"); and a "category": "food" for meals/cafes/restaurants, "entry" for paid attractions/tickets, "transit" for explicit transport legs (including a bikeshare hop, when the destination has one), "other" for everything else. Also two fields the checks read rather than the traveler: "outdoor", true where weather can spoil the stop (a garden, a viewpoint, a walking route), false where it cannot (a museum, a restaurant, a covered market). Judge the place, never the category: a rooftop bar and a basement one are both food. And "timeFlexibility": write "FIXED" ONLY for something the traveler has told you is already booked or ticketed for a specific time, quoting their own words back as the stop; everything you chose yourself is "PREFERRED". A FIXED stop is one the plan may not later move or drop, so inventing one takes a decision away from them permanently.`;

export function buildGeneratePrompt(params: {
  destination: string;
  startDate: string;
  endDate: string;
  budget: number;
  tier: TierId;
  weather: DayWeather[];
  preferences?: ItineraryPreferences | null;
  contextInsight?: string;
  resolvedFlags?: ResolvedFlags | null;
  dietary?: DietaryNeeds | null;
  logistics?: TripLogistics | null;
  bikeshare?: BikeshareSystem | null;
  answers?: UserAnswers | null;
  anchors?: Anchor[];
  sketch?: string;
}): string {
  return `Plan a day-by-day trip itinerary for ${params.destination}, from ${params.startDate} to ${params.endDate}, with a total budget of $${params.budget}.

${PRECEDENCE_INSTRUCTION}

Style: ${tierStyle(params.tier)}

${params.weather.length > 0 ? `Daily weather:\n${formatWeather(params.weather)}` : `No weather data is available for these dates.`}
${formatPreferences(params.preferences)}${formatTravelerProfile(params.resolvedFlags ?? null)}${formatTravelLegs(params.logistics ?? null)}${formatRequirements(params.answers ?? null)}${formatDietary(params.dietary ?? null)}${formatBikeshare(params.bikeshare)}${formatContextBlock(params.contextInsight)}${formatAnchors(params.anchors)}${params.sketch ?? ""}
${params.weather.length > 0 ? "Use the weather to favor indoor activities on days with high rain probability or extreme temperatures, and outdoor activities on good-weather days.\n" : ""}${CLAIMS_POLICY}
Every day except the last should include a "lodging" entry representing that night's stay, ${lodgingPricingBasis()}. Use the SAME hotel for every night in the same city. Repeat its name and nightly cost on each of those days. Only switch lodging when the trip actually relocates to a different city or region, and say so in that day's note. Do not invent a different hotel each night: it costs the traveler more, wastes time re-checking in, and no one moves hotels nightly in one city. Pick one well-located base and plan the days around it.
${lodgingInstruction()}
${STOP_FIELD_INSTRUCTION}
${STOP_LINES_INSTRUCTION}
${FOOD_STOP_INSTRUCTION}
${budgetInstruction()}
Include real, well-known places (or real, well-known areas, per the food-stop rule) for the destination with their real approximate latitude/longitude.
For each day, also write a short, elegant 1-2 sentence "summary" capturing that day's theme and flow, e.g. "A relaxing mix of historic sightseeing in Asakusa followed by local dining along the river." No emoji anywhere in the plan. The summary is prose about the shape of the day and may not smuggle in a claim either: no "dawn-lit", "sunset", "golden hour", "quiet" or "uncrowded" unless the data for it was supplied.

Respond with ONLY valid JSON, no markdown code fences, no commentary, in exactly this shape:
${shapeHint(params.weather.length > 0)}`;
}

export function buildRefinePrompt(params: {
  destination: string;
  startDate: string;
  endDate: string;
  budget: number;
  previousItinerary: Itinerary;
  feedback: string;
  contextInsight?: string;
  resolvedFlags?: ResolvedFlags | null;
  dietary?: DietaryNeeds | null;
  logistics?: TripLogistics | null;
  answers?: UserAnswers | null;
  anchors?: Anchor[];
}): string {
  return `Here is a trip itinerary for ${params.destination} (${params.startDate} to ${params.endDate}, budget $${params.budget}):

${JSON.stringify(params.previousItinerary)}

${PRECEDENCE_INSTRUCTION}

Style: ${tierStyle(params.previousItinerary.tier)}

The user's feedback on this itinerary: "${params.feedback}"
${formatTravelerProfile(params.resolvedFlags ?? null)}${formatTravelLegs(params.logistics ?? null)}${formatRequirements(params.answers ?? null)}${formatDietary(params.dietary ?? null)}${formatContextBlock(params.contextInsight)}${formatAnchors(params.anchors)}
Revise the itinerary to address this feedback. Keep real, well-known places with real approximate latitude/longitude, keep the lodging entries, and keep per-stop costs realistic.
${STOP_FIELD_INSTRUCTION}
${STOP_LINES_INSTRUCTION}
${FOOD_STOP_INSTRUCTION}
${lodgingInstruction()}
${budgetInstruction()}
For each day, also write (or rewrite, if the feedback changes its theme) a short, elegant 1-2 sentence "summary" capturing that day's theme and flow. No emoji anywhere in the plan.

Respond with ONLY valid JSON, no markdown code fences, no commentary, in exactly this shape:
${shapeHint(daysCarryWeather(params.previousItinerary.days))}`;
}

/**
 * Expands one stop the traveler tapped.
 *
 * `itineraryContext` is optional and read from the saved plan, never regenerated — it is the same
 * compacted view the edit loop shows, plus which slot was tapped. Without it this call knew only a
 * name and a coordinate, so it answered like a guidebook index: the same paragraph about Fushimi
 * Inari whether the traveler was arriving at dawn with a whole morning or squeezing it in after
 * dinner. With it, "best time" and "duration" can be judged against the slot the stop actually
 * occupies and the stops on either side of it.
 *
 * Still one-shot and still on the cheap tier — this reads an existing plan, it never changes one.
 * The output contract is unchanged, so `PlaceDetail` and every caller are untouched.
 */
export function buildPlaceDetailPrompt(params: {
  name: string;
  destination: string;
  lat: number;
  lng: number;
  itineraryContext?: string;
}): string {
  const context = params.itineraryContext
    ? `\n\n<their_itinerary>\n${params.itineraryContext}\n</their_itinerary>\n\nThis stop is part of the trip above. Judge "bestTime" and "duration" against the slot it actually occupies and the stops around it, and make at least one tip specific to this trip rather than generic: the weather that day, the stop before or after it, or the time they arrive. If the plan already puts them there at a poor time, say so plainly in a tip.`
    : "";

  return `Give a compact travel-guide entry for "${params.name}" in ${params.destination} (approx. coordinates ${params.lat}, ${params.lng}).${context}

Respond with ONLY valid JSON, no markdown code fences, no commentary, in exactly this shape:
{"history":"1-2 sentence history or significance","bestTime":"short best time of day or season to visit","tips":["practical tip 1","practical tip 2"],"duration":"suggested visit duration, e.g. '1-2 hours'","pros":["Short label: one sentence on what is genuinely good here","..."],"cons":["Short label: one sentence on what is genuinely worse here","..."]}

Two or three entries each for "pros" and "cons". Open each with a two-to-four word label, then a colon, then one sentence; the card renders the label in bold. Cons must be real drawbacks a visitor would want warned about (crowds, cost, a climb, a closure pattern), never a hedge or a compliment in disguise. If a place has no honest drawback worth a sentence, return fewer rather than padding. ${NO_EM_DASH_RULE}`;
}

export function buildRebalancePrompt(params: {
  destination: string;
  remainingDays: Itinerary["days"];
  remainingBudget: number;
  tier: TierId;
}): string {
  return `Here are the remaining days of a trip itinerary for ${params.destination}:

${JSON.stringify(params.remainingDays)}

Style: ${tierStyle(params.tier)}

The traveler overspent on an earlier day. Only $${params.remainingBudget} is left for these remaining days combined (lodging + stops). Revise these remaining days so their total cost fits within $${params.remainingBudget}, keeping the same dates, weather summaries, and style. Reduce or swap stops/lodging as needed rather than just noting the overage.
${STOP_FIELD_INSTRUCTION}
${STOP_LINES_INSTRUCTION}
${FOOD_STOP_INSTRUCTION}
${lodgingInstruction()}

Respond with ONLY valid JSON, no markdown code fences, no commentary, as a JSON array of day objects in this shape:
[${dayShape(daysCarryWeather(params.remainingDays))}]`;
}

/**
 * Shopping and trends only. Festivals and safety used to be recalled here too, but that was
 * pure invention shown to users as fact — see destinationSafety.ts and destinationFestivals.ts,
 * which fetch and ground those two instead. Shopping/trends stay recalled: lower-stakes and more
 * opinion-shaped, and grounding them didn't turn up a clean data source.
 */
export function buildContextPrompt(params: {
  destination: string;
  startDate: string;
  endDate: string;
}): string {
  return `Give background context useful for planning a trip to ${params.destination} between ${params.startDate} and ${params.endDate}.

Cover: notable shopping areas/districts, and any current travel trends (popular new spots, seasonal crowds, etc.). Leave a category's array empty if you don't have anything genuinely relevant; don't invent filler. ${NO_EM_DASH_RULE}

Respond with ONLY valid JSON, no markdown code fences, no commentary, in exactly this shape:
{"shopping":[{"name":"area/market name","area":"neighborhood","note":"short note"}],"trends":[{"note":"short trend note"}]}`;
}

export function buildCritiquePrompt(params: {
  itinerary: Itinerary;
  budget: number;
  /** Verified closures / access problems found by checking the plan against real place listings.
   *  Empty leaves this prompt byte-identical to before they were detected. */
  placeConflicts?: PlaceConflict[];
  /** Travel-feasibility findings computed against real route durations, already phrased. */
  travelFindings?: string[];
  contextInsight?: string;
  interestTags?: string[];
  resolvedFlags?: ResolvedFlags | null;
  dietary?: DietaryNeeds | null;
}): string {
  const interestLine =
    params.interestTags && params.interestTags.length > 0
      ? `\nThe traveler said they're especially interested in: ${params.interestTags.join(", ")}.\n`
      : "";
  return `Here is a generated trip itinerary with a total budget of $${params.budget}:

${JSON.stringify(params.itinerary)}
${formatContextBlock(params.contextInsight)}${interestLine}${formatTravelerProfile(params.resolvedFlags ?? null)}${formatDietary(params.dietary ?? null)}
Review it for: (1) total cost (lodging + stops) landing at or under the budget, with anything already paid for counted as 0 and every cost read as the party total it already is rather than a per-person price, (2) stop times being sequential, non-overlapping, and realistically spaced (no implausibly tight back-to-back stops), (3) reasonable use of the destination context above, if any was given, (4) whether the itinerary genuinely reflects the traveler's stated interests above, if any were given, not just generic sightseeing, (5) whether each day respects the traveler profile above, if one was given: the stops-per-day target and any mobility or family constraints, (6) whether every food stop actually fits the traveler's dietary needs above, if any were given (a stop they could not eat at is a defect even if the rest of the day is good), (7) whether any attraction, restaurant or area appears more than once across the whole trip, including under a second name or as a branch of the same chain, (8) whether the trip as a whole reflects the starred priorities in the order given, rather than one day carrying all of them.
${formatPlaceConflicts(params.placeConflicts ?? [], params.travelFindings ?? [])}
If it already looks good, respond with exactly: {"issues":[],"revisedDays":null}
Otherwise, respond with the specific issues found and a corrected "days" array in the same shape as the input, fixing those issues. ${NO_EM_DASH_RULE}

Respond with ONLY valid JSON, no markdown code fences, no commentary, in exactly this shape:
{"issues":["short issue description"],"revisedDays":[${dayShape(daysCarryWeather(params.itinerary.days))}]}`;
}
