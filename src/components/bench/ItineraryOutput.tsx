"use client";

import { useState } from "react";
import { diffWords } from "diff";
import type { BenchDayJson, BenchItineraryJson, BenchStopJson } from "@/lib/bench/itineraryJson";

/**
 * One model's output, in the three forms a developer actually needs:
 *
 * - **Readable** — the plan rendered the way the app renders a trip: day cards, slot groupings,
 *   times and durations as fields rather than prose. Built from the structured JSON below, so the
 *   two views can never disagree.
 * - **JSON** — the machine-readable payload, the same object the API returns per cell.
 * - **Diff** — word-level diff against the baseline model, for spotting what actually changed.
 *
 * The markdown the model literally wrote is reachable from the Readable tab's disclosure, so
 * nothing is hidden behind a transformation.
 */

type Tab = "readable" | "json" | "diff";

const SLOT_ORDER = ["Morning", "Afternoon", "Evening"] as const;

const CATEGORY_STYLE: Record<string, string> = {
  food: "bg-orange-100 text-orange-800",
  entry: "bg-blue-100 text-blue-800",
  transit: "bg-stone-200 text-stone-700",
  other: "bg-stone-100 text-stone-600",
};

function StopRow({ stop }: { stop: BenchStopJson }) {
  return (
    <li className="border-l-2 border-stone-200 py-1 pl-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-xs font-medium text-stone-900">{stop.name}</span>
        {stop.areaLevel && (
          <span className="rounded bg-stone-100 px-1 text-[10px] text-stone-500">area</span>
        )}
        <span className={`rounded px-1 text-[10px] ${CATEGORY_STYLE[stop.category] ?? CATEGORY_STYLE.other}`}>
          {stop.category}
        </span>
        {stop.matchedPoi && (
          <span className="text-[10px] text-stone-400" title={`Matched context POI: ${stop.matchedPoi}`}>
            ✓ in context
          </span>
        )}
      </div>
      <div className="text-[11px] text-stone-500">
        {stop.time ?? <span className="text-red-500">no time window</span>}
        {stop.durationLabel && ` · ${stop.durationLabel}`}
        {!stop.durationLabel && !stop.areaLevel && (
          <span className="text-red-500"> · no duration</span>
        )}
        {stop.transportToNext && (
          <>
            {" · → "}
            {stop.transportToNext.minutes !== null
              ? `${stop.transportToNext.minutes} min `
              : ""}
            {stop.transportToNext.mode}
          </>
        )}
      </div>
    </li>
  );
}

function DayCard({ day, index }: { day: BenchDayJson; index: number }) {
  return (
    <article className="rounded border border-stone-200 p-2">
      <header className="mb-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-xs font-semibold text-stone-900">
            Day {index + 1} · {day.date ?? "no date"}
            {day.dayOfWeek ? ` (${day.dayOfWeek})` : ""}
          </span>
          {day.weather && (
            <span className="text-[10px] text-stone-500">
              {Math.round(day.weather.tempMinC)}–{Math.round(day.weather.tempMaxC)}°C
              {day.weather.precipitationProbability !== null &&
                `, ${day.weather.precipitationProbability}% rain`}
              {day.weather.sunset && `, sunset ${day.weather.sunset}`}
              {day.weather.estimated && " (est)"}
            </span>
          )}
        </div>
        {day.theme && <p className="text-[11px] italic text-stone-600">{day.theme}</p>}
      </header>

      {SLOT_ORDER.map((slot) => {
        const stops = day.stops.filter((s) => s.slot === slot);
        if (stops.length === 0) {
          return (
            <p key={slot} className="text-[11px] text-red-500">
              {slot}: <span className="text-stone-400">— empty —</span>
            </p>
          );
        }
        return (
          <div key={slot} className="mt-1">
            <p className="text-[11px] font-medium text-stone-500">{slot}</p>
            <ul>
              {stops.map((s, i) => (
                <StopRow key={i} stop={s} />
              ))}
            </ul>
          </div>
        );
      })}

      <footer className="mt-1 space-y-0.5 text-[11px]">
        {day.stayNear ? (
          <p className="text-stone-600">
            <span className="font-medium">Stay near:</span> {day.stayNear}
          </p>
        ) : (
          <p className="text-red-500">no &ldquo;Stay near&rdquo; line</p>
        )}
        {day.note && (
          <p className="text-stone-500">
            <span className="font-medium">Note:</span> {day.note}
          </p>
        )}
      </footer>
    </article>
  );
}

export default function ItineraryOutput({
  json,
  markdown,
  baselineMarkdown,
  isBaseline,
  failed,
  errorMessage,
}: {
  json: BenchItineraryJson;
  markdown: string;
  baselineMarkdown: string;
  isBaseline: boolean;
  failed: boolean;
  errorMessage: string | null;
}) {
  const [tab, setTab] = useState<Tab>("readable");
  const [copied, setCopied] = useState(false);

  if (failed) {
    return (
      <p className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
        Generation failed: {errorMessage}
      </p>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "readable", label: "Readable" },
    { id: "json", label: "JSON" },
    ...(isBaseline ? [] : [{ id: "diff" as Tab, label: "Diff" }]),
  ];

  const copyJson = async () => {
    await navigator.clipboard.writeText(JSON.stringify(json, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded px-1.5 py-0.5 text-[11px] ${
              tab === t.id ? "bg-stone-900 text-white" : "border border-stone-300 text-stone-600"
            }`}
          >
            {t.label}
          </button>
        ))}
        {tab === "json" && (
          <button
            onClick={copyJson}
            className="ml-auto rounded border border-stone-300 px-1.5 py-0.5 text-[11px] text-stone-600"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>

      {tab === "readable" && (
        <div className="max-h-[32rem] space-y-2 overflow-auto pr-1">
          {json.preamble && (
            <p className="rounded bg-stone-100 p-2 text-[11px] text-stone-600">{json.preamble}</p>
          )}
          {json.days.length === 0 ? (
            <p className="text-xs text-red-600">Nothing parsed as a day — the model ignored the format.</p>
          ) : (
            json.days.map((d, i) => <DayCard key={i} day={d} index={i} />)
          )}
          <details className="text-[11px] text-stone-500">
            <summary className="cursor-pointer">Raw markdown the model wrote</summary>
            <pre className="mt-1 whitespace-pre-wrap rounded border border-stone-200 bg-stone-50 p-2 font-mono text-[10px] text-stone-600">
              {markdown}
            </pre>
          </details>
        </div>
      )}

      {tab === "json" && (
        <pre className="max-h-[32rem] overflow-auto whitespace-pre rounded border border-stone-200 bg-stone-50 p-2 font-mono text-[10px] leading-relaxed text-stone-700">
          {JSON.stringify(json, null, 2)}
        </pre>
      )}

      {tab === "diff" && (
        <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded border border-stone-200 bg-stone-50 p-2 font-mono text-[11px] leading-relaxed text-stone-700">
          {diffWords(baselineMarkdown, markdown)
            .filter((part) => !part.removed)
            .map((part, i) => (
              <span key={i} className={part.added ? "bg-amber-200 text-stone-900" : undefined}>
                {part.value}
              </span>
            ))}
        </pre>
      )}
    </div>
  );
}
