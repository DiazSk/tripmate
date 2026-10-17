"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import "../PolarLanding.css";
import "./PlanningFlow.css";
import { DateRangeFields } from "../DateRangeFields";
import { TimeField, time12 } from "./TimeField";
import { INTEREST_TAGS } from "@/components/InterestPicker";
import { DIETARY_TAGS } from "@/components/DietaryPicker";
import type { SuggestOption } from "@/components/SuggestInput";
import { anchorKey } from "@/lib/anchors";
import { MAX_STARRED_PRIORITIES, PARTY_MAX_PER_BAND } from "@/lib/userAnswers";
import { MAX_TRIP_DAYS, TIERS, tripDays, type TierId } from "@/lib/tiers";
import { suggestDestinations, suggestionLabel, type GeoSuggestion } from "@/lib/weather";
import type { DietaryNeeds } from "@/lib/travelerProfile";
import type { CandidatePoi } from "@/lib/pois";
import type {
  AccessibilityNeeds,
  Anchor,
  CrowdPreference,
  DiscoveryPreference,
  EnergyLevel,
  GroupType,
  PacePreference,
  PartyCounts,
} from "@/lib/types";

/**
 * The planner, built from the MagicPath canvas design "TripMate Planning flow (web)": the landing's
 * vocabulary (PolarLanding.css) over the place being planned, its name set as the monument, the
 * questions in the closing form's frosted panel and the trip writing itself beside them.
 *
 * **Presentation only.** Every answer, the history entries, the draft restore, the profile prefill
 * and the request `generate()` sends stay in `HomeView`, which hands them over as one `PlannerModel`.
 * This file owns what the old form owned and nothing more: which suggestion list is open, the
 * basics step's field errors, and the saved-places import in flight.
 */

export type PlanStep = "basics" | "group" | "preferences" | "review";
const STEPS: { id: PlanStep; chip: string; kicker: string; title: string; lead: string }[] = [
  { id: "basics", chip: "Where and when", kicker: "Let’s make yours.", title: "Where are you going?", lead: "The place, your dates, and what you’re comfortable spending." },
  { id: "group", chip: "Who’s going", kicker: "Step two of four", title: "Who’s going?", lead: "This changes trip to trip, so we ask every time." },
  { id: "preferences", chip: "What you’re after", kicker: "Step three of four", title: "What are you after?", lead: "All optional, and only for this trip. Your saved profile stays as it is." },
  { id: "review", chip: "Review", kicker: "Last step", title: "Here’s your trip.", lead: "Everything we’ll plan with. Change anything before we start." },
];

// The design's copy over the planner's own ids (ExplorerStylePicker, ChoicePicker, GroupTypePicker).
const GROUPS: { id: GroupType; name: string; line: string }[] = [
  { id: "solo", name: "Solo", line: "Just you" },
  { id: "couple", name: "Couple", line: "Two of you" },
  { id: "family_with_kids", name: "Family with kids", line: "Grown-ups and children" },
  { id: "other", name: "Something else", line: "Friends, work, three generations" },
];
const PACES: { id: PacePreference; name: string; line: string; stops: number }[] = [
  { id: "relaxed", name: "Relaxed", line: "2 to 3 stops a day, room to breathe", stops: 3 },
  { id: "balanced", name: "Balanced", line: "4 stops a day", stops: 4 },
  { id: "packed", name: "Packed", line: "4 to 5 stops a day, a tight schedule", stops: 5 },
];
const DISCOVERY: { id: DiscoveryPreference; name: string; line: string }[] = [
  { id: "iconic", name: "Iconic", line: "The headline attractions" },
  { id: "local", name: "Off the beaten path", line: "Local spots over headline attractions" },
  { id: "mix", name: "A bit of both", line: "A balance of iconic and local" },
];
const WALKING: [EnergyLevel, string, string][] = [
  ["high", "All day", "High"],
  ["moderate", "Moderate", "Moderate"],
  ["low", "Easy", "Low"],
];
const CROWDS: [CrowdPreference, string, string][] = [
  ["love", "The buzz", "Love the buzz"],
  ["mixed", "Either", "A bit of both"],
  ["avoid", "Avoid", "Avoid crowds"],
];

/* The stage. The default frame is the landing footer's Wadi Rum, where "Plan a trip" sends you
   from; a destination the landing has a photograph of crossfades in, and one it has none of brings
   the night up over the default until it reads as texture, with its name carrying the page. */
const FRAMES: { id: string; src: string; match: RegExp | null }[] = [
  { id: "rum", src: "/scenes/wadi-rum-desert.webp", match: null },
  { id: "petra", src: "/scenes/petra-treasury.webp", match: /\bpetra\b/i },
  { id: "orcia", src: "/scenes/tuscany-cypress-road.webp", match: /\borcia\b|\btuscany\b/i },
  { id: "jaipur", src: "/scenes/jaipur-amber-fort-elephant.webp", match: /\bjaipur\b/i },
  { id: "sinaia", src: "/scenes/peles-castle-romania-snow.webp", match: /\bsinaia\b|\bpele[sș]\b/i },
  { id: "engadin", src: "/scenes/graubunden-autumn-valley.webp", match: /\bengadin\b|\bgraub[uü]nden\b/i },
];

export type PlannerModel = {
  step: PlanStep;
  /** Jump to a step, through HomeView's history entry so browser Back walks it too. */
  onJump: (step: PlanStep) => void;
  /** Forward: HomeView's own submit, which warms the fetches after basics and generates after review. */
  onNext: () => void;
  onBack: () => void;
  /** A failure the traveller has to act on, from HomeView (a generation that did not finish). */
  error: string | null;

  destination: string;
  setDestination: (s: string) => void;
  onDestinationPick: (s: GeoSuggestion) => void;
  onDestinationBlur: () => void;
  destinationMissed: boolean;
  coords: { lat: number; lon: number } | null;
  startDate: string;
  endDate: string;
  setDates: (start: string, end: string) => void;
  budget: number;
  setBudget: (n: number) => void;
  budgetBasis: "per_person" | "whole_party";
  setBudgetBasis: (b: "per_person" | "whole_party") => void;
  /** The tier generation will actually be priced against (HomeView's `tier`). */
  tier: TierId;
  party: PartyCounts;
  setParty: (p: PartyCounts) => void;
  arrivalTime: string;
  setArrivalTime: (s: string) => void;
  arrivalPoint: string;
  setArrivalPoint: (s: string) => void;
  departureTime: string;
  setDepartureTime: (s: string) => void;
  departurePoint: string;
  setDeparturePoint: (s: string) => void;
  arrivalOptions: SuggestOption[];
  stayBooked: string;
  setStayBooked: (s: string) => void;
  anchors: Anchor[];
  setAnchors: (update: (prev: Anchor[]) => Anchor[]) => void;

  group: GroupType;
  pickGroup: (g: GroupType) => void;
  groupOther: string;
  setGroupOther: (s: string) => void;
  dietary: DietaryNeeds;
  setDietary: (d: DietaryNeeds) => void;

  interests: string[];
  toggleInterest: (tag: string) => void;
  starredInterests: string[];
  toggleInterestStar: (tag: string) => void;
  pace: PacePreference;
  setPace: (p: PacePreference) => void;
  discovery: DiscoveryPreference;
  setDiscovery: (d: DiscoveryPreference) => void;
  energy: EnergyLevel;
  setEnergy: (e: EnergyLevel) => void;
  crowds: CrowdPreference;
  setCrowds: (c: CrowdPreference) => void;
  accessibility: AccessibilityNeeds | null;
  setAccess: (patch: Partial<AccessibilityNeeds>) => void;
  purpose: string;
  setPurpose: (s: string) => void;
  mustInclude: string;
  setMustInclude: (s: string) => void;
  avoid: string;
  setAvoid: (s: string) => void;
  constraintsNote: string;
  setConstraintsNote: (s: string) => void;

  pois: CandidatePoi[];
  poisAvailable: boolean;
  poisLoading: boolean;
  selectedPois: CandidatePoi[];
  togglePoi: (p: CandidatePoi) => void;
  customPois: string[];
  addCustomPoi: (name: string) => void;
  removeCustomPoi: (name: string) => void;
  notify: boolean;
  onNotifyToggle: (checked: boolean) => void;
  notifyBlocked: boolean;
};

/* ───────────────────────── helpers ───────────────────────── */

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const partyLine = (p: PartyCounts) =>
  [plural(p.adults, "adult"), p.children ? plural(p.children, "child", "children") : "", p.infants ? plural(p.infants, "infant") : ""]
    .filter(Boolean)
    .join(", ");
const fmtDate = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", ...o });
const rangeLine = (s: string, e: string) => `${fmtDate(s, { day: "numeric", month: "short" })} to ${fmtDate(e, { day: "numeric", month: "short", year: "numeric" })}`;
function dms(v: number, pos: string, neg: string) {
  const a = Math.abs(v);
  const d = Math.floor(a);
  const m = Math.floor((a - d) * 60);
  const s = Math.round(((a - d) * 60 - m) * 60);
  return `${d}º ${String(m).padStart(2, "0")}’ ${String(s).padStart(2, "0")}” ${v >= 0 ? pos : neg}`;
}
const cityOf = (destination: string) => destination.split(",")[0]?.trim() ?? "";

/** The trip as it is answered, shared by the card and the strip. */
export type TripFacts = {
  where: string;
  coords: { lat: number; lon: number } | null;
  startDate: string;
  endDate: string;
  days: number;
  party: PartyCounts;
  budget: number;
  basis: "per_person" | "whole_party";
  perDay: number;
  tierName: string | null;
  pace: PacePreference;
  interests: string[];
  starred: string[];
  musts: number;
};
function factsOf(m: PlannerModel): TripFacts {
  const days = m.startDate && m.endDate ? tripDays(m.startDate, m.endDate) : 0;
  const people = m.party.adults + m.party.children + m.party.infants;
  // Per person per day, whichever way the budget was given.
  const perPerson = m.budget ? (m.budgetBasis === "whole_party" ? m.budget / Math.max(people, 1) : m.budget) : 0;
  return {
    where: m.destination.trim(),
    coords: m.coords,
    startDate: m.startDate,
    endDate: m.endDate,
    days,
    party: m.party,
    budget: m.budget,
    basis: m.budgetBasis,
    perDay: days && perPerson ? perPerson / days : 0,
    tierName: days ? TIERS.find((t) => t.id === m.tier)?.name ?? null : null,
    pace: m.pace,
    interests: m.interests,
    starred: m.starredInterests,
    musts: m.anchors.filter((a) => a.priority === "must").length + m.selectedPois.length + m.customPois.length,
  };
}

/* ───────────────────────── page ───────────────────────── */

export default function PlanningFlow({ model: m }: { model: PlannerModel }) {
  const index = STEPS.findIndex((s) => s.id === m.step);
  const facts = factsOf(m);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const clearErr = (k: string) =>
    setErrors((prev) => {
      const next = { ...prev };
      delete next[k];
      return next;
    });
  const title = useRef<HTMLHeadingElement>(null);

  // Each step opens at its title, for a screen reader as much as the eye.
  useEffect(() => {
    title.current?.focus({ preventScroll: true });
  }, [m.step]);

  function validateBasics() {
    const e: Record<string, string> = {};
    if (!m.destination.trim()) e.where = "Where are you going? A city, a region or a country.";
    if (!m.startDate) e.start = "When do you arrive?";
    else if (!m.endDate) e.end = "When do you leave?";
    else if (m.endDate < m.startDate) e.end = "Leave on or after the day you arrive.";
    else if (facts.days > MAX_TRIP_DAYS) e.end = `Trips can be up to ${MAX_TRIP_DAYS} days.`;
    if (!m.budget) e.budget = "Roughly what do you want to spend? A total is fine.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }
  function next() {
    if (m.step === "basics" && !validateBasics()) return;
    setErrors({});
    m.onNext();
  }

  const frame = FRAMES.find((f) => f.match?.test(m.destination)) ?? null;
  const named = !!facts.where;

  return (
    <div className="tm pp">
      <div className="pp-stage" aria-hidden="true">
        {FRAMES.map((f) => (
          // eslint-disable-next-line @next/next/no-img-element -- full-bleed crossfade frames, the landing's own pattern
          <img key={f.id} src={f.src} alt="" className={`tm-hero-img${f.id === (frame?.id ?? "rum") ? " is-on" : ""}`} />
        ))}
        <div className="pp-veil" style={{ opacity: named && !frame ? 0.72 : 0 }} />
        <div className="pp-scrim" />
      </div>
      <div className="pp-page">
        <>
            <ol className="pp-steps" aria-label="Steps">
              {STEPS.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => i < index && m.onJump(s.id)}
                    disabled={i >= index}
                    aria-current={i === index ? "step" : undefined}
                    className={`pp-step${i < index ? " is-done" : ""}`}
                  >
                    <span className="pp-step-n">{i < index ? "✓" : String(i + 1).padStart(2, "0")}</span>
                    {s.chip}
                  </button>
                </li>
              ))}
            </ol>
            <TripStrip {...facts} />
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                next();
              }}
              className="flex flex-1 flex-col"
            >
              <div className="pp-main">
                <div key={m.step} className="pp-swap min-w-0">
                  <div className="pp-head">
                    <p className="tm-kicker">{STEPS[index].kicker}</p>
                    <h1 ref={title} tabIndex={-1} className="pp-title outline-none">
                      {STEPS[index].title}
                    </h1>
                    <p className="pp-lead">{STEPS[index].lead}</p>
                  </div>
                  <div className="pp-panel">
                    {m.step === "basics" && <Basics m={m} facts={facts} errors={errors} clearErr={clearErr} />}
                    {m.step === "group" && <Group m={m} />}
                    {m.step === "preferences" && <Preferences m={m} />}
                    {m.step === "review" && <Review m={m} facts={facts} />}
                  </div>
                </div>
                <TripCard {...facts} />
              </div>

              {m.error && (
                <p role="alert" className="pp-alert">
                  {m.error}
                </p>
              )}
              <div className="pp-bar">
                {index > 0 ? (
                  <button type="button" onClick={m.onBack} className="tm-glass">
                    ← Back
                  </button>
                ) : (
                  <span className="tm-caption">Free · no account needed · drafts until you keep them</span>
                )}
                <button type="submit" className="tm-signal tm-signal-lg">
                  {m.step === "review" ? "Plan my trip" : "Next"}
                </button>
              </div>
            </form>
        </>
        <div className="pp-monument" aria-hidden="true">
          <p className="tm-monument" key={cityOf(m.destination) || "Anywhere"}>
            {cityOf(m.destination) || "Anywhere"}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── pieces ───────────────────────── */

function Section({ title, hint, optional, children }: { title: string; hint?: string; optional?: boolean; children: ReactNode }) {
  return (
    <section className="pp-section">
      <div className="pp-section-head">
        <h2 className="tm-eyebrow">{title}</h2>
        {optional && <span className="pp-optional">optional</span>}
      </div>
      {hint && <p className="pp-hint -mt-1">{hint}</p>}
      {children}
    </section>
  );
}
function Count({ label, hint, value, min, max, onChange }: { label: string; hint?: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="pp-count">
      <div>
        <p className="tm-ui">{label}</p>
        {hint && <p className="pp-hint">{hint}</p>}
      </div>
      <div className="tm-stepper" role="group" aria-label={label}>
        <button type="button" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label={`One fewer: ${label.toLowerCase()}`}>
          −
        </button>
        <output aria-live="polite">{value}</output>
        <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label={`One more: ${label.toLowerCase()}`}>
          +
        </button>
      </div>
    </div>
  );
}
function More({ title, hint, open: startOpen = false, children }: { title: string; hint: string; open?: boolean; children: ReactNode }) {
  // Opens on its own when something inside is already answered (a restored draft, a prefill), so a
  // filled-in field is never hidden behind a closed fold.
  const [open, setOpen] = useState(startOpen);
  return (
    <section className="pp-more">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="pp-more-head">
        <span>
          <span className="tm-eyebrow block text-[0.78em]">
            {title} <span className="pp-optional ml-2 normal-case tracking-normal">optional</span>
          </span>
          <span className="pp-hint mt-1 block">{hint}</span>
        </span>
        <span aria-hidden className="pp-more-sign">
          +
        </span>
      </button>
      <div className={`pp-reveal ${open ? "is-open" : ""}`} inert={!open}>
        <div>
          <div className="grid gap-4 pt-5">{children}</div>
        </div>
      </div>
    </section>
  );
}
function Field({ label, children, error, id }: { label: string; children: ReactNode; error?: string; id?: string }) {
  return (
    <label className={`tm-fb-field${error ? " has-err" : ""}`} htmlFor={id}>
      <span>{label}</span>
      {children}
      {error && <em>{error}</em>}
    </label>
  );
}
function Seg<T extends string>({ label, id, value, options, onChange }: { label: string; id: string; value: T; options: [T, string, string?][]; onChange: (v: T) => void }) {
  return (
    <div className="tm-fb-field">
      <span id={id}>{label}</span>
      <div className="tm-seg" role="radiogroup" aria-labelledby={id}>
        {options.map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────── step 1: where and when ───────────────────────── */

const SUGGEST_DEBOUNCE_MS = 300;

function Basics({ m, facts, errors, clearErr }: { m: PlannerModel; facts: TripFacts; errors: Record<string, string>; clearErr: (k: string) => void }) {
  const [matches, setMatches] = useState<GeoSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const request = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  // Open-Meteo's own suggestions, debounced, the newest request winning (DestinationSearch's rule).
  function search(q: string) {
    if (timer.current) clearTimeout(timer.current);
    const id = ++request.current;
    if (q.trim().length < 2) {
      setMatches([]);
      return;
    }
    timer.current = setTimeout(() => {
      suggestDestinations(q.trim())
        .then((s) => id === request.current && setMatches(s))
        .catch(() => id === request.current && setMatches([]));
    }, SUGGEST_DEBOUNCE_MS);
  }
  function choose(s: GeoSuggestion) {
    request.current++;
    m.setDestination(suggestionLabel(s));
    m.onDestinationPick(s);
    setOpen(false);
    setMatches([]);
    clearErr("where");
  }
  const shown = open ? matches : [];
  const people = m.party.adults + m.party.children + m.party.infants;
  const anyLegs = !!(m.arrivalTime || m.arrivalPoint || m.departureTime || m.departurePoint || m.stayBooked);

  return (
    <>
      <Section title="The place">
        <div className="relative">
          <Field label="Where to?" error={errors.where} id="pp-where">
            <input
              id="pp-where"
              role="combobox"
              aria-expanded={shown.length > 0}
              aria-controls="pp-where-list"
              aria-autocomplete="list"
              aria-activedescendant={shown[active] ? `pp-opt-${active}` : undefined}
              aria-invalid={!!errors.where}
              value={m.destination}
              placeholder="Kyoto, Lisbon, the Dolomites…"
              autoComplete="off"
              onChange={(e) => {
                m.setDestination(e.target.value);
                search(e.target.value);
                setOpen(true);
                setActive(0);
                clearErr("where");
              }}
              onKeyDown={(e) => {
                if (!shown.length) return;
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => (a + 1) % shown.length);
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => (a - 1 + shown.length) % shown.length);
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  choose(shown[active]);
                }
                if (e.key === "Escape") setOpen(false);
              }}
              onBlur={() => {
                // After a pick has had its chance to land (the option takes mousedown).
                window.setTimeout(() => setOpen(false), 120);
                m.onDestinationBlur();
              }}
              className="tm-fb-input text-[1.05em]"
            />
          </Field>
          {shown.length > 0 && (
            <ul id="pp-where-list" role="listbox" className="pp-options">
              {shown.map((x, i) => (
                <li
                  key={`${x.lat},${x.lon}`}
                  id={`pp-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(x);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className="pp-option"
                >
                  <span>
                    <span className="tm-ui block">{x.name}</span>
                    <span className="pp-hint block">{[x.admin1, x.country].filter(Boolean).join(", ")}</span>
                  </span>
                  <span className="tm-coord tm-on-dark-2">{x.countryCode}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {m.destinationMissed && !errors.where && (
          <p className="pp-hint" aria-live="polite">
            Couldn’t find that on the map, but we’ll still plan it.
          </p>
        )}
      </Section>

      <Section title="The dates" hint={`Up to ${MAX_TRIP_DAYS} days. We plan against the real forecast for them.`}>
        <div className="pp-grid-2">
          <DateRangeFields
            value={{ start: m.startDate, end: m.endDate }}
            onChange={(d) => {
              m.setDates(d.start, d.end);
              if (d.start) clearErr("start");
              if (d.end) clearErr("end");
            }}
            errors={{ start: errors.start, end: errors.end }}
          />
        </div>
      </Section>

      <Section title="The budget" hint="A target, not a ceiling. Every day is priced against it.">
        <div className="pp-grid-2 items-start">
          <Field label="How much, roughly?" error={errors.budget} id="pp-budget">
            <span className={`pp-money${m.budget ? " has-value" : ""}`}>
              <span aria-hidden className="pp-money-sign">
                $
              </span>
              <input
                id="pp-budget"
                inputMode="numeric"
                value={m.budget ? m.budget.toLocaleString("en-US") : ""}
                onChange={(e) => {
                  m.setBudget(Number(e.target.value.replace(/[^\d]/g, "")) || 0);
                  clearErr("budget");
                }}
                placeholder="3,000"
                aria-invalid={!!errors.budget}
                className="tm-fb-input"
                style={{ paddingLeft: "1.9em", fontVariantNumeric: "tabular-nums" }}
              />
            </span>
          </Field>
          <Seg
            label="Is that"
            id="pp-basis"
            value={m.budgetBasis}
            onChange={m.setBudgetBasis}
            options={[
              ["whole_party", "For everyone"],
              ["per_person", "Per person"],
            ]}
          />
        </div>
        <Count
          label="Travellers"
          hint={people > m.party.adults ? `${partyLine(m.party)}; children are on the next step` : "Adults; children are on the next step"}
          value={m.party.adults}
          min={1}
          max={PARTY_MAX_PER_BAND}
          onChange={(n) => m.setParty({ ...m.party, adults: n })}
        />
        {facts.perDay > 0 && facts.tierName && (
          <p className="pp-swap tm-body" style={{ fontVariantNumeric: "tabular-nums" }}>
            About <strong>{money(facts.perDay)} a day</strong> for each of you. Closest match: <strong>{facts.tierName}</strong>
            <span className="tm-on-dark-2">, {TIERS.find((t) => t.id === m.tier)?.description.toLowerCase()}.</span>
          </p>
        )}
      </Section>

      <More title="Arriving and leaving" hint="Times and where you land, so the first and last days fit around them." open={anyLegs}>
        {(["Arriving", "Leaving"] as const).map((k) => {
          const arriving = k === "Arriving";
          const time = arriving ? m.arrivalTime : m.departureTime;
          const where = arriving ? m.arrivalPoint : m.departurePoint;
          return (
            <div key={k} className="grid gap-4 sm:grid-cols-[10em_1fr]">
              <TimeField label={arriving ? "Arriving at" : "Leaving at"} verb={arriving ? "Lands" : "Leaves"} value={time} onChange={arriving ? m.setArrivalTime : m.setDepartureTime} />
              <Field label={arriving ? "Landing at" : "Leaving from"}>
                <input
                  list={`pp-points-${k}`}
                  value={where}
                  onChange={(e) => (arriving ? m.setArrivalPoint : m.setDeparturePoint)(e.target.value)}
                  placeholder={m.arrivalOptions.length ? "Pick or type a place" : "Anywhere you like"}
                  className="tm-fb-input"
                />
                <datalist id={`pp-points-${k}`}>
                  {m.arrivalOptions.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.hint ? `${a.label} · ${a.hint}` : a.label}
                    </option>
                  ))}
                </datalist>
              </Field>
            </div>
          );
        })}
        <Field label="Already booked somewhere to stay?">
          <input value={m.stayBooked} onChange={(e) => m.setStayBooked(e.target.value)} placeholder="The hotel or neighbourhood, if it’s booked" className="tm-fb-input" />
        </Field>
      </More>

      <SavedPlaces m={m} />
    </>
  );
}

/* Saved places: what ImportDropZone did, in the design's markup. Screenshots are downscaled to the
   long edge the model reads at full fidelity; links and notes go as text; POST /api/import reads
   them all into anchors, merged by name so a later read can fill in coordinates. */
const LONG_EDGE_PX = 1568;
type Pending = { kind: "image"; mediaType: "image/jpeg"; data: string; preview: string } | { kind: "url"; url: string } | { kind: "text"; text: string };
async function downscale(file: File): Promise<Pending> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, LONG_EDGE_PX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const preview = canvas.toDataURL("image/jpeg", 0.85);
  return { kind: "image", mediaType: "image/jpeg", data: preview.split(",")[1], preview };
}
/** One pasted blob of text → a link per URL line, and the rest as one note. */
function splitText(text: string): Pending[] {
  const lines = text.split(/\s*\n\s*/).map((l) => l.trim()).filter(Boolean);
  const urls = lines.filter((l) => /^https?:\/\/\S+$/.test(l));
  const rest = lines.filter((l) => !urls.includes(l)).join("\n");
  return [...urls.map((url) => ({ kind: "url" as const, url })), ...(rest ? [{ kind: "text" as const, text: rest }] : [])];
}
type SavedPlace = { id: string; name: string; lat: number | null; lng: number | null; city: string | null; source: string };

function SavedPlaces({ m }: { m: PlannerModel }) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [saved, setSaved] = useState<SavedPlace[]>([]);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/saved-places")
      .then((r) => (r.ok ? r.json() : { places: [] }))
      .then((j) => setSaved((j.places ?? []).filter((p: SavedPlace) => p.source !== "instagram")))
      .catch(() => setSaved([]));
  }, []);

  async function take(files: File[]) {
    const read = await Promise.all(files.filter((f) => f.type.startsWith("image/")).map(downscale));
    setImages((prev) => [...prev, ...read]);
  }
  async function read() {
    const items = [...images, ...(text.trim() ? splitText(text) : [])];
    if (items.length === 0) {
      setNotes(["Paste a link, a list or a note first, or add a screenshot."]);
      return;
    }
    setBusy(true);
    setNotes([]);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          destination: m.destination,
          items: items.map((p) => (p.kind === "image" ? { kind: "image", mediaType: p.mediaType, data: p.data } : p)),
        }),
      });
      const json = (await res.json()) as { error?: string; destinationGuess?: string | null; places?: Anchor[]; unread?: { index: number; reason: string }[] };
      if (!res.ok) {
        setNotes([json.error ?? "Couldn't read these right now."]);
        return;
      }
      const incoming = json.places ?? [];
      m.setAnchors((prev) => {
        const byKey = new Map(prev.map((a) => [anchorKey(a.name), a] as const));
        for (const place of incoming) {
          const key = anchorKey(place.name);
          const existing = byKey.get(key);
          if (!existing) byKey.set(key, place);
          else if (existing.lat === null && place.lat !== null) byKey.set(key, { ...existing, lat: place.lat, lng: place.lng });
        }
        return Array.from(byKey.values());
      });
      if (json.destinationGuess && !m.destination.trim()) m.setDestination(json.destinationGuess);
      setNotes((json.unread ?? []).map((u) => u.reason));
      setImages([]);
      setText("");
    } catch {
      setNotes(["Couldn't read these right now."]);
    } finally {
      setBusy(false);
    }
  }
  const chosen = new Set(m.anchors.map((a) => anchorKey(a.name)));

  return (
    <More title="Places you’ve saved" hint="Screenshots, links or a list. We find the places in them and plan around them." open={m.anchors.length > 0}>
      {saved.length > 0 && (
        <div className="grid gap-2">
          <p className="pp-hint">Your saved places</p>
          <div className="pp-chips" role="group" aria-label="Your saved places">
            {saved.map((p) => {
              const on = chosen.has(anchorKey(p.name));
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    m.setAnchors((prev) =>
                      on ? prev.filter((a) => anchorKey(a.name) !== anchorKey(p.name)) : [...prev, { name: p.name, lat: p.lat, lng: p.lng, priority: "want", source: "import" }]
                    )
                  }
                  className="pp-chip"
                >
                  {p.name}
                  {p.city ? <span className="tm-on-dark-2"> · {p.city.split(",")[0]}</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div
        className={`pp-drop${dragging ? " is-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void take(Array.from(e.dataTransfer.files));
          const dropped = e.dataTransfer.getData("text/plain");
          if (dropped) setText((t) => (t ? `${t}\n${dropped}` : dropped));
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            if (e.clipboardData.files.length) void take(Array.from(e.clipboardData.files));
          }}
          placeholder="Paste links, a list of places, or notes"
          aria-label="Saved places to read"
        />
        {images.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {images.map((p, i) =>
              p.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element -- a local data URL, not an optimisable asset
                <img key={i} src={p.preview} alt="" className="h-12 w-12 rounded-[var(--wd-radius-sm)] object-cover" />
              ) : null
            )}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <button type="button" className="pp-hint underline-offset-4 hover:underline" onClick={() => file.current?.click()}>
            Or drop screenshots here
          </button>
          <input ref={file} type="file" accept="image/*" multiple className="sr-only" tabIndex={-1} onChange={(e) => void take(Array.from(e.target.files ?? []))} />
          <button type="button" onClick={() => void read()} disabled={busy} className="tm-fb-quiet">
            {busy ? <span className="pp-pulse">Reading…</span> : "Find the places"}
          </button>
        </div>
      </div>
      {notes.length > 0 && (
        <ul className="pp-hint grid gap-1" aria-live="polite">
          {notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
      {m.anchors.length > 0 && (
        <>
          <ul className="pp-chips" aria-label="Places to plan around">
            {m.anchors.map((a) => (
              <li key={a.name} className="pp-anchor">
                <button
                  type="button"
                  aria-pressed={a.priority === "must"}
                  aria-label={a.priority === "must" ? `${a.name}: must see` : `${a.name}: nice to have`}
                  onClick={() => m.setAnchors((prev) => prev.map((x) => (x.name === a.name ? { ...x, priority: x.priority === "must" ? "want" : "must" } : x)))}
                  className={a.priority === "must" ? "is-star" : ""}
                >
                  {a.priority === "must" ? "★" : "☆"}
                </button>
                <span>
                  {a.name}
                  {a.lat === null && <span className="tm-on-dark-2"> · couldn’t place it, type it or skip</span>}
                </span>
                <button type="button" aria-label={`Remove ${a.name}`} onClick={() => m.setAnchors((prev) => prev.filter((x) => x.name !== a.name))}>
                  ×
                </button>
              </li>
            ))}
          </ul>
          <p className="pp-hint">★ means must see. The rest we fit in where they suit the day.</p>
        </>
      )}
    </More>
  );
}

/* ───────────────────────── step 2: who ───────────────────────── */

function Group({ m }: { m: PlannerModel }) {
  const setBand = (band: keyof PartyCounts) => (n: number) => m.setParty({ ...m.party, [band]: n });
  return (
    <>
      <Section title="Travelling as">
        <div role="radiogroup" aria-label="Travelling as" className="pp-cards is-2">
          {GROUPS.map((g) => (
            <button key={g.id} type="button" role="radio" aria-checked={m.group === g.id} onClick={() => m.pickGroup(g.id)} className="pp-card">
              <span className="pp-card-name">{g.name}</span>
              <span className="pp-card-line">{g.line}</span>
            </button>
          ))}
        </div>
        <div className={`pp-reveal ${m.group === "other" ? "is-open" : ""}`} inert={m.group !== "other"}>
          <div>
            <div className="pt-2">
              <Field label="Tell us a little">
                <input value={m.groupOther} onChange={(e) => m.setGroupOther(e.target.value)} placeholder="Five college friends, a work offsite, three generations" className="tm-fb-input" />
              </Field>
            </div>
          </div>
        </div>
      </Section>
      <Section title="How many of you">
        <div>
          <Count label="Adults" value={m.party.adults} min={1} max={PARTY_MAX_PER_BAND} onChange={setBand("adults")} />
          <Count label="Children" hint="Aged 2 to 11" value={m.party.children} min={0} max={PARTY_MAX_PER_BAND} onChange={setBand("children")} />
          <Count label="Infants" hint="Under 2" value={m.party.infants} min={0} max={PARTY_MAX_PER_BAND} onChange={setBand("infants")} />
        </div>
      </Section>
      <Section title="Food" hint="Every place we suggest to eat works for everyone at the table." optional>
        <div className="pp-chips" role="group" aria-label="Dietary needs">
          {DIETARY_TAGS.map((d) => {
            const on = m.dietary.tags.includes(d);
            return (
              <button key={d} type="button" aria-pressed={on} onClick={() => m.setDietary({ ...m.dietary, tags: on ? m.dietary.tags.filter((x) => x !== d) : [...m.dietary.tags, d] })} className="pp-chip">
                {d}
              </button>
            );
          })}
        </div>
        <input value={m.dietary.note} onChange={(e) => m.setDietary({ ...m.dietary, note: e.target.value })} placeholder="Anything else, like no shellfish or low salt" aria-label="Other dietary notes" className="tm-fb-input" />
      </Section>
    </>
  );
}

/* ───────────────────────── step 3: what ───────────────────────── */

// The day as the plan's own rhythm bar draws it: blocks of time with air between them.
function PaceBar({ stops }: { stops: number }) {
  return (
    <span className="pp-pace" aria-hidden>
      {Array.from({ length: stops }, (_, i) => (
        <span key={i} style={{ left: `${4 + (i * 92) / stops}%`, width: `${(92 / stops) * 0.62}%` }} />
      ))}
    </span>
  );
}

function Preferences({ m }: { m: PlannerModel }) {
  const left = MAX_STARRED_PRIORITIES - m.starredInterests.length;
  const access = m.accessibility;
  const anySpecifics = !!(m.purpose || m.mustInclude || m.avoid || m.constraintsNote);
  return (
    <>
      <Section title="What matters most" hint={`Pick any. Star up to ${MAX_STARRED_PRIORITIES === 3 ? "three" : MAX_STARRED_PRIORITIES}; those drive the plan.`}>
        <div className="pp-chips">
          {INTEREST_TAGS.map((i) => {
            const on = m.interests.includes(i);
            const star = m.starredInterests.includes(i);
            return (
              <span key={i} className="inline-flex">
                <button type="button" aria-pressed={on} onClick={() => m.toggleInterest(i)} className="pp-chip">
                  {i}
                </button>
                {on && (
                  <button type="button" aria-pressed={star} aria-label={star ? `Unstar ${i}` : `Star ${i}`} disabled={!star && left === 0} onClick={() => m.toggleInterestStar(i)} className="pp-star">
                    {star ? "★" : "☆"}
                  </button>
                )}
              </span>
            );
          })}
        </div>
        <p className="pp-hint" aria-live="polite" style={{ fontVariantNumeric: "tabular-nums" }}>
          {m.starredInterests.length
            ? `${m.starredInterests.join(" > ")} · ${left === 0 ? "top three set" : `${plural(left, "star")} left`}`
            : "No stars yet, so everything you pick counts the same."}
        </p>
      </Section>

      <Section title="How full a day">
        <div role="radiogroup" aria-label="How full a day" className="pp-cards is-3">
          {PACES.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={m.pace === x.id} onClick={() => m.setPace(x.id)} className="pp-card">
              <span className="pp-card-name">{x.name}</span>
              <span className="pp-card-line">{x.line}</span>
              <PaceBar stops={x.stops} />
            </button>
          ))}
        </div>
      </Section>

      <Section title="What to see">
        <div role="radiogroup" aria-label="What to see" className="pp-cards is-3">
          {DISCOVERY.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={m.discovery === x.id} onClick={() => m.setDiscovery(x.id)} className="pp-card">
              <span className="pp-card-name">{x.name}</span>
              <span className="pp-card-line">{x.line}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Walking and crowds">
        <div className="pp-grid-2">
          <Seg label="How much walking suits you" id="pp-walk" value={m.energy} onChange={m.setEnergy} options={WALKING} />
          <Seg label="Crowds" id="pp-crowds" value={m.crowds} onChange={m.setCrowds} options={CROWDS} />
        </div>
      </Section>

      <More title="Getting around" hint="Step-free routes, stairs, anything we should plan around." open={!!access && (access.stepFreeRequired || access.limitStairs || !!access.note)}>
        <label className="pp-check">
          <input type="checkbox" checked={access?.stepFreeRequired ?? false} onChange={(e) => m.setAccess({ stepFreeRequired: e.target.checked })} />I need step-free routes throughout
        </label>
        <label className="pp-check">
          <input type="checkbox" checked={access?.limitStairs ?? false} onChange={(e) => m.setAccess({ limitStairs: e.target.checked })} />
          Avoid stairs and steep climbs where possible
        </label>
        <input value={access?.note ?? ""} onChange={(e) => m.setAccess({ note: e.target.value })} placeholder="Anything else we should plan around" aria-label="Other access needs" className="tm-fb-input" />
      </More>
      <More title="The specifics" hint="An occasion, places you must see, things to leave out." open={anySpecifics}>
        <Field label="What’s the occasion?">
          <input value={m.purpose} onChange={(e) => m.setPurpose(e.target.value)} placeholder="An anniversary, a first time in Japan, work and play" className="tm-fb-input" />
        </Field>
        <div className="pp-grid-2">
          <Field label="Anything you must see">
            <input value={m.mustInclude} onChange={(e) => m.setMustInclude(e.target.value)} placeholder="The Louvre, Versailles" className="tm-fb-input" />
          </Field>
          <Field label="Anything to leave out">
            <input value={m.avoid} onChange={(e) => m.setAvoid(e.target.value)} placeholder="Nightclubs, seafood" className="tm-fb-input" />
          </Field>
        </div>
        <Field label="Already booked or off-limits">
          <input value={m.constraintsNote} onChange={(e) => m.setConstraintsNote(e.target.value)} placeholder="No rental car; dinner booked Thursday 8pm" className="tm-fb-input" />
        </Field>
      </More>
    </>
  );
}

/* ───────────────────────── step 4: review ───────────────────────── */

function Review({ m, facts }: { m: PlannerModel; facts: TripFacts }) {
  const [add, setAdd] = useState("");
  const addOne = () => {
    if (!add.trim()) return;
    m.addCustomPoi(add.trim());
    setAdd("");
  };
  const groupName = m.group === "other" && m.groupOther.trim() ? m.groupOther.trim() : GROUPS.find((g) => g.id === m.group)!.name;
  const legs = [
    m.arrivalTime || m.arrivalPoint ? `In ${[time12(m.arrivalTime), m.arrivalPoint].filter(Boolean).join(" at ")}` : "",
    m.departureTime || m.departurePoint ? `out ${[time12(m.departureTime), m.departurePoint].filter(Boolean).join(" from ")}` : "",
    m.stayBooked ? `staying at ${m.stayBooked}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const rows: { label: string; value: string; edit: PlanStep }[] = [
    { label: "Where", value: facts.where, edit: "basics" },
    { label: "When", value: facts.days ? `${rangeLine(facts.startDate, facts.endDate)} · ${plural(facts.days, "day")}, ${plural(facts.days - 1, "night")}` : "", edit: "basics" },
    {
      label: "Budget",
      value: m.budget ? `${money(m.budget)} ${m.budgetBasis === "whole_party" ? "for everyone" : "per person"} · about ${money(facts.perDay)} a day each${facts.tierName ? ` · ${facts.tierName}` : ""}` : "",
      edit: "basics",
    },
    { label: "Arriving, leaving", value: legs, edit: "basics" },
    { label: "Saved places", value: m.anchors.map((a) => `${a.priority === "must" ? "★ " : ""}${a.name}`).join(", "), edit: "basics" },
    { label: "Who", value: `${groupName} · ${partyLine(m.party)}`, edit: "group" },
    { label: "Food", value: [...m.dietary.tags, m.dietary.note.trim()].filter(Boolean).join(", "), edit: "group" },
    {
      label: "The days",
      value: `${PACES.find((x) => x.id === m.pace)?.name} · ${DISCOVERY.find((x) => x.id === m.discovery)?.name} · walking ${WALKING.find((w) => w[0] === m.energy)?.[2].toLowerCase()} · crowds: ${CROWDS.find((c) => c[0] === m.crowds)?.[2].toLowerCase()}`,
      edit: "preferences",
    },
    { label: "What matters", value: m.interests.map((i) => (m.starredInterests.includes(i) ? `★ ${i}` : i)).join(", "), edit: "preferences" },
    { label: "Occasion", value: m.purpose.trim(), edit: "preferences" },
    {
      label: "See, skip, booked",
      value: [m.mustInclude.trim() && `See ${m.mustInclude.trim()}`, m.avoid.trim() && `skip ${m.avoid.trim()}`, m.constraintsNote.trim() && `booked: ${m.constraintsNote.trim()}`].filter(Boolean).join(" · "),
      edit: "preferences",
    },
    {
      label: "Getting around",
      value: [m.accessibility?.stepFreeRequired && "Step-free routes", m.accessibility?.limitStairs && "avoid stairs", m.accessibility?.note.trim()].filter(Boolean).join(", "),
      edit: "preferences",
    },
  ];
  return (
    <>
      <dl className="pp-review">
        {rows.map((r) => (
          <div key={r.label} className="pp-review-row">
            <dt>{r.label}</dt>
            <dd className={r.value ? "" : "is-empty"}>{r.value || "Not set"}</dd>
            <button type="button" onClick={() => m.onJump(r.edit)} className="pp-edit" aria-label={`Edit ${r.label.toLowerCase()}`}>
              Edit
            </button>
          </div>
        ))}
      </dl>

      <Section title="Stops picked ahead of time" hint="Notable places we found for these dates. Add any; we fit the rest around them." optional>
        {m.poisLoading ? (
          <div className="pp-chips" aria-busy="true" aria-label="Finding notable spots">
            {[8, 10, 6, 9, 7].map((w, i) => (
              <span key={i} className="pp-pulse pp-ghost-line" style={{ width: `${w}em`, height: "2.6em" }} />
            ))}
            <span className="pp-hint w-full">Finding notable spots…</span>
          </div>
        ) : m.poisAvailable && m.pois.length > 0 ? (
          <div className="pp-chips">
            {m.pois.map((c) => (
              <button key={c.name} type="button" aria-pressed={m.selectedPois.some((p) => p.name === c.name)} onClick={() => m.togglePoi(c)} className="pp-chip">
                {c.name}
              </button>
            ))}
          </div>
        ) : (
          <p className="pp-hint">We’ll pick every stop for you. Add any must-sees below.</p>
        )}
        <div className="flex gap-2">
          <input
            value={add}
            onChange={(e) => setAdd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addOne();
              }
            }}
            placeholder="Add a place you already know about"
            aria-label="Add a place you already know about"
            className="tm-fb-input"
          />
          <button type="button" aria-label="Add place" disabled={!add.trim()} onClick={addOne} className="tm-fb-quiet shrink-0" style={{ height: "2.9em", width: "2.9em", padding: 0, fontSize: "1.1em" }}>
            +
          </button>
        </div>
        {m.customPois.length > 0 && (
          <ul className="pp-chips">
            {m.customPois.map((c) => (
              <li key={c} className="pp-anchor pl-3">
                {c}
                <button type="button" aria-label={`Remove ${c}`} onClick={() => m.removeCustomPoi(c)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Before we start">
        <p className="tm-body">Takes about five minutes. You can cancel any time, and change the plan in plain language afterwards.</p>
        <label className="pp-check">
          <input type="checkbox" checked={m.notify} onChange={(e) => m.onNotifyToggle(e.target.checked)} />
          Tell me when it’s ready
        </label>
        {m.notifyBlocked && <p className="pp-hint">Notifications are blocked for this site, so we can’t tell you. The tab’s title still changes when it’s ready.</p>}
      </Section>
    </>
  );
}

/* ───────────────────────── the trip ───────────────────────── */

function tripRows(f: TripFacts): [string, string][] {
  const rows: [string, string][] = [];
  if (f.days) rows.push(["When", `${rangeLine(f.startDate, f.endDate)} · ${plural(f.days, "day")}`]);
  rows.push(["Who", partyLine(f.party)]);
  if (f.budget && f.perDay) rows.push(["Budget", `${money(f.budget)} ${f.basis === "whole_party" ? "in all" : "each"} · ${money(f.perDay)} a day each${f.tierName ? ` · ${f.tierName}` : ""}`]);
  rows.push(["Days", PACES.find((p) => p.id === f.pace)!.line]);
  if (f.interests.length) rows.push(["Drawn to", (f.starred.length ? f.starred : f.interests).slice(0, 3).join(", ")]);
  if (f.musts) rows.push(["Must see", plural(f.musts, "place")]);
  return rows;
}

// The trip, written as it is answered: the night map's panel glass beside the questions.
function TripCard(f: TripFacts) {
  const pace = PACES.find((p) => p.id === f.pace)!;
  return (
    <aside className="pp-trip hidden min-[1100px]:grid" aria-label="Your trip so far">
      <div>
        <p className="tm-kicker tm-on-dark-2">Your trip so far</p>
        <p key={f.where} className="pp-trip-name pp-swap mt-2">
          {cityOf(f.where) || "Somewhere new"}
        </p>
        <p className="tm-coord tm-on-dark-2 mt-2 block">
          {f.coords ? `[ ${dms(f.coords.lat, "N", "S")}, ${dms(f.coords.lon, "E", "W")} ]` : f.where ? "We’ll find it on the map" : "Start with the place"}
        </p>
      </div>
      <dl>
        {tripRows(f).map(([k, v]) => (
          <div key={k} className="pp-trip-row">
            <dt>{k}</dt>
            <dd className="m-0">{v}</dd>
          </div>
        ))}
      </dl>
      {f.days > 0 && (
        <div>
          <p className="tm-eyebrow tm-on-dark-2 text-[0.7em]">A day, at this pace</p>
          <div className="pp-rhythm mt-3">
            {Array.from({ length: pace.stops }, (_, i) => (
              <span key={`${pace.id}${i}`} style={{ left: `${6 + (i * 88) / pace.stops}%`, width: `${(88 / pace.stops) * 0.6}%`, animationDelay: `${i * 70}ms` }} />
            ))}
          </div>
          <div className="tm-caption tm-on-dark-2 mt-2 flex justify-between" style={{ fontVariantNumeric: "tabular-nums" }}>
            <span>8 AM</span>
            <span>1 PM</span>
            <span>6 PM</span>
            <span>10 PM</span>
          </div>
        </div>
      )}
      <p className="tm-caption tm-on-dark-2">
        Nothing is planned until you press Plan my trip. Then the forecast, holidays and opening hours for these dates go in first, before a word is written.
      </p>
    </aside>
  );
}

// Below the wide layout the trip rides as one glass line under the steps.
function TripStrip(f: TripFacts) {
  const rows = tripRows(f)
    .filter(([k]) => k !== "Days")
    .slice(0, 3);
  return (
    <div className="pp-trip-strip" aria-label="Your trip so far">
      <span className="tm-ui">{cityOf(f.where) || "Somewhere new"}</span>
      {rows.map(([k, v]) => (
        <span key={k} className="tm-on-dark-2">
          · {v}
        </span>
      ))}
    </div>
  );
}
