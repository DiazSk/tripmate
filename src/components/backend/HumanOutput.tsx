import { extractResultText } from "@/lib/compareRuns";
import { CritiqueResult, DayPlan, DestinationContext, Itinerary, PlaceDetail } from "@/lib/types";

/** Mirrors `parseJsonResponse` in `src/lib/claude.ts` (the app's own real parsing) — can't import
 *  that directly, since it pulls in `child_process` for the CLI spawn and this is a client
 *  component. The model is told not to wrap its answer in markdown fences and mostly complies,
 *  but not always; without stripping them first, a fenced response looks like invalid JSON here
 *  even though the app's own server-side parsing handles it fine. */
function stripCodeFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}

function isDayPlanArray(v: unknown): v is DayPlan[] {
  return Array.isArray(v) && v.every((d) => d && typeof d === "object" && "stops" in d);
}
function isItinerary(v: unknown): v is Pick<Itinerary, "days"> {
  return !!v && typeof v === "object" && Array.isArray((v as { days?: unknown }).days);
}
function isCritique(v: unknown): v is CritiqueResult {
  return !!v && typeof v === "object" && Array.isArray((v as { issues?: unknown }).issues);
}
function isContext(v: unknown): v is DestinationContext {
  return !!v && typeof v === "object" && Array.isArray((v as { festivals?: unknown }).festivals);
}
function isPlaceDetail(v: unknown): v is PlaceDetail {
  return !!v && typeof v === "object" && typeof (v as { history?: unknown }).history === "string";
}

function DayPlanView({ days }: { days: DayPlan[] }) {
  return (
    <div className="space-y-3">
      {days.map((day, i) => {
        const total =
          (day.lodging?.cost ?? 0) + day.stops.reduce((sum, s) => sum + (s.cost ?? 0), 0);
        return (
          <div key={i} className="rounded-lg border border-stone-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium text-stone-900">
                Day {i + 1} · {day.date}
              </div>
              <div className="text-xs font-medium text-stone-500">${total} total</div>
            </div>
            {day.weather && <div className="mt-0.5 text-xs text-stone-500">{day.weather}</div>}
            {day.summary && <div className="mt-1 text-sm text-stone-700 italic">{day.summary}</div>}
            {day.lodging && (
              <div className="mt-2 text-xs text-stone-600">
                🛏 {day.lodging.name} — ${day.lodging.cost} <span className="text-stone-400">({day.lodging.note})</span>
              </div>
            )}
            <ol className="mt-2 space-y-1 text-xs text-stone-700">
              {day.stops.map((stop, si) => (
                <li key={si} className="flex justify-between gap-2">
                  <span>
                    {si + 1}. {stop.time && <span className="text-stone-400">{stop.time} — </span>}
                    {stop.name}
                    {stop.durationLabel && <span className="text-stone-400"> ({stop.durationLabel})</span>}
                  </span>
                  <span className="shrink-0 font-medium text-stone-500">${stop.cost}</span>
                </li>
              ))}
            </ol>
          </div>
        );
      })}
    </div>
  );
}

function CritiqueView({ result }: { result: CritiqueResult }) {
  return (
    <div className="space-y-2 text-sm">
      {result.issues.length === 0 ? (
        <p className="text-green-700">✓ No issues found — the itinerary was left as-is.</p>
      ) : (
        <div>
          <div className="mb-1 font-medium text-stone-900">Issues found:</div>
          <ul className="list-disc space-y-0.5 pl-5 text-stone-700">
            {result.issues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        </div>
      )}
      {result.revisedDays && (
        <div>
          <div className="mb-1 mt-2 font-medium text-stone-900">
            Revised days ({result.revisedDays.length}) — these replaced the originals:
          </div>
          <DayPlanView days={result.revisedDays} />
        </div>
      )}
    </div>
  );
}

function ContextView({ context }: { context: DestinationContext }) {
  const sections: { label: string; lines: string[] }[] = [
    { label: "Festivals", lines: context.festivals.map((f) => `${f.name} (${f.dates}) — ${f.note}`) },
    { label: "Safety", lines: context.safety.map((s) => `[${s.severity}] ${s.note}`) },
    { label: "Shopping", lines: context.shopping.map((s) => `${s.name} (${s.area}) — ${s.note}`) },
    { label: "Trends", lines: context.trends.map((t) => t.note) },
  ];
  const anyContent = sections.some((s) => s.lines.length > 0);
  if (!anyContent) return <p className="text-sm text-stone-400">Nothing genuinely relevant found.</p>;
  return (
    <div className="space-y-2 text-sm">
      {sections
        .filter((s) => s.lines.length > 0)
        .map((s) => (
          <div key={s.label}>
            <div className="font-medium text-stone-900">{s.label}</div>
            <ul className="list-disc space-y-0.5 pl-5 text-stone-700">
              {s.lines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}

function PlaceDetailView({ detail }: { detail: PlaceDetail }) {
  return (
    <div className="space-y-2 text-sm text-stone-700">
      <p>{detail.history}</p>
      <p>
        <span className="font-medium text-stone-900">Best time to visit: </span>
        {detail.bestTime}
      </p>
      <p>
        <span className="font-medium text-stone-900">Suggested duration: </span>
        {detail.duration}
      </p>
      <div>
        <span className="font-medium text-stone-900">Tips:</span>
        <ul className="mt-0.5 list-disc space-y-0.5 pl-5">
          {detail.tips.map((tip, i) => (
            <li key={i}>{tip}</li>
          ))}
        </ul>
      </div>
      {/* Guarded, unlike `tips` above: these arrived after this view did, so a trace recorded
          before then has neither field and would render two headings over nothing. */}
      {(["pros", "cons"] as const).map((key) =>
        detail[key]?.length ? (
          <div key={key}>
            <span className="font-medium text-stone-900 capitalize">{key}:</span>
            <ul className="mt-0.5 list-disc space-y-0.5 pl-5">
              {detail[key].map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null
      )}
    </div>
  );
}

/**
 * The real output, read the way a human would rather than the way the Claude CLI's JSON envelope
 * stores it — `rawResponse` is the whole subprocess envelope (`is_error`, `duration_api_ms`,
 * token usage, session ids, the model's answer buried as an escaped JSON *string* inside
 * `.result`); this pulls that string out (`extractResultText`) and renders it by shape rather
 * than dumping it as one more blob of JSON.
 */
export default function HumanOutput({ rawResponse }: { rawResponse: string | null }) {
  const resultText = extractResultText(rawResponse);
  if (!resultText) return <p className="text-sm text-stone-400">(no response captured)</p>;

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(stripCodeFences(resultText));
  } catch {
    // Falls through to the plain-text branch below.
  }

  if (parsed == null) {
    return <p className="text-sm whitespace-pre-wrap text-stone-700">{resultText}</p>;
  }
  if (isItinerary(parsed)) return <DayPlanView days={parsed.days} />;
  if (isDayPlanArray(parsed)) return <DayPlanView days={parsed} />;
  if (isCritique(parsed)) return <CritiqueView result={parsed} />;
  if (isContext(parsed)) return <ContextView context={parsed} />;
  if (isPlaceDetail(parsed)) return <PlaceDetailView detail={parsed} />;

  // Recognized JSON but not one of the shapes above — still far more readable pretty-printed
  // than the raw envelope was.
  return (
    <pre className="max-h-72 overflow-auto rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs whitespace-pre-wrap text-stone-800">
      {JSON.stringify(parsed, null, 2)}
    </pre>
  );
}
