import { notFound } from "next/navigation";
import BenchConsole from "@/components/bench/BenchConsole";

/**
 * Dev-only model benchmark. Server component purely so the environment check runs before anything
 * renders — the same gate `/backend/pipeline` uses. In production this is a 404, not a
 * hidden-but-reachable page, and `/api/bench` 404s independently so the route can't be driven
 * directly either.
 */
export default function BenchPage() {
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    // Same shell treatment as the sibling /backend pages: opt back into pointer events (AppShell
    // disables them so the globe stays draggable) and hide the map control stack.
    <main className="map-chrome-hidden pointer-events-auto min-h-full bg-stone-50 px-6 pt-16 pb-10 text-stone-900 sm:px-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <header>
          <h1 className="text-xl font-semibold">Model benchmark</h1>
          <p className="mt-1 max-w-3xl text-sm text-stone-500">
            Runs the real Step 6 generation path — same skill, same frozen trip-context, same
            generation prompt — across several Claude models on a fixed set of sample trips, and
            scores the output. Every model call here costs real tokens. Dev only.
          </p>
        </header>
        <BenchConsole />
      </div>
    </main>
  );
}
