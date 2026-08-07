"use client";

import { useState } from "react";
import WeatherIcon from "./WeatherIcon";
import { DayWeather } from "@/lib/weather";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-stone-500">{label}</dt>
      <dd className="font-medium text-stone-800">{value}</dd>
    </div>
  );
}

export default function WeatherPopover({
  weather,
  fallbackText,
}: {
  weather?: DayWeather | null;
  fallbackText: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={fallbackText}
        className="flex items-center gap-1.5 rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-sm text-stone-600 transition-colors hover:bg-stone-100"
      >
        <WeatherIcon weather={weather} className="h-4 w-4" />
        {weather
          ? `${Math.round(weather.tempMinC)}–${Math.round(weather.tempMaxC)}°C`
          : fallbackText}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-stone-200 bg-white p-4 text-sm shadow-lg">
            {weather ? (
              <dl className="space-y-1.5">
                <Row
                  label="Low / High"
                  value={`${Math.round(weather.tempMinC)}° / ${Math.round(weather.tempMaxC)}°C`}
                />
                <Row
                  label="Humidity"
                  value={weather.humidity != null ? `${weather.humidity}%` : "—"}
                />
                <Row
                  label="Rain chance"
                  value={
                    weather.precipitationProbability != null
                      ? `${weather.precipitationProbability}%`
                      : "—"
                  }
                />
              </dl>
            ) : (
              <p className="text-stone-500">{fallbackText}</p>
            )}
            {weather?.historical && (
              <p className="mt-2 border-t border-stone-100 pt-2 text-xs text-stone-400">
                Typical weather for these dates — no live forecast available yet.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
