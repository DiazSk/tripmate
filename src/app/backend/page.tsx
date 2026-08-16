"use client";

import { Terminal } from "lucide-react";
import PipelineConsole from "@/components/backend/PipelineConsole";
import PerfDashboard from "@/components/backend/PerfDashboard";
import CompareRuns from "@/components/backend/CompareRuns";
import { devLabel } from "@/lib/devInspector";

export default function BackendDashboardPage() {
  return (
    // `pointer-events-auto`: AppShell's content wrapper is `pointer-events-none` so the Cesium
    // canvas beneath stays draggable everywhere else — this page has no canvas to protect and is
    // fully opaque, so it needs to opt back in for any of its buttons/inputs/rows to be clickable.
    // `map-chrome-hidden` hides the globe's zoom/tilt control stack, which has nothing to control
    // on a page that hides the globe entirely under a solid background.
    <main className="map-chrome-hidden pointer-events-auto min-h-full bg-stone-50 px-6 pt-16 pb-8 text-stone-900 sm:px-10 sm:pt-16">
      <div className="mx-auto max-w-6xl space-y-8" {...devLabel("BackendDashboard")}>
        <header className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-stone-900 text-white">
            <Terminal className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-stone-900">TripMate backend</h1>
            <p className="text-sm text-stone-500">
              The LLM agent architecture, live — invoke any pipeline and see exactly what data
              moves through it. Not linked from the traveler-facing app.
            </p>
          </div>
        </header>

        <PipelineConsole />

        <PerfDashboard />

        <CompareRuns />
      </div>
    </main>
  );
}
