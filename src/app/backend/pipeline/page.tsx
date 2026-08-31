import { notFound } from "next/navigation";
import StagedPipelineConsole from "@/components/backend/StagedPipelineConsole";

/**
 * Dev-only test harness for the staged trip pipeline. Server component purely so the
 * environment check runs before anything renders — matching the `NODE_ENV === "development"`
 * gate already used by `devLabel` in devInspector.ts. In production this is a 404, not a
 * hidden-but-reachable page.
 */
export default function PipelineHarnessPage() {
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    // Same shell treatment as the sibling /backend dashboard: opt back into pointer events
    // (AppShell disables them so the globe stays draggable) and hide the map control stack.
    <main className="map-chrome-hidden pointer-events-auto min-h-full bg-stone-50 px-6 pt-16 pb-8 text-stone-900 sm:px-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <h1 className="text-xl font-semibold">Staged pipeline harness</h1>
          <p className="mt-1 text-sm text-stone-500">
            Drives the real routes end to end — real fetches, one real LLM call. Dev only.
          </p>
        </header>
        <StagedPipelineConsole />
      </div>
    </main>
  );
}
