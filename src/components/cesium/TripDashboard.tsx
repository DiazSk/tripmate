"use client";

import { motion } from "framer-motion";
import BudgetBar from "@/components/BudgetBar";
import DayList from "@/components/DayList";
import FeedbackLoop from "@/components/FeedbackLoop";
import { useLlmTraceWidget } from "@/components/LlmTraceFab";
import { Itinerary } from "@/lib/types";

export default function TripDashboard({
  itinerary,
  traceId,
  budget,
  hoveredStop,
  onHoverStop,
  onBack,
  onSave,
  onRefine,
  saving,
  refining,
}: {
  itinerary: Itinerary;
  traceId: string | null;
  budget: number;
  hoveredStop: string | null;
  onHoverStop: (key: string | null) => void;
  onBack: () => void;
  onSave: () => void;
  onRefine: (feedback: string) => void;
  saving: boolean;
  refining: boolean;
}) {
  const spent = itinerary.days.reduce(
    (sum, day) => sum + day.stops.reduce((s, stop) => s + (stop.cost || 0), 0),
    0
  );
  const over = spent > budget;
  const traceWidget = useLlmTraceWidget();

  return (
    <div className="pointer-events-none absolute inset-0 flex">
      {/* Left half is intentionally empty — the globe underneath shows through and stays interactive (no pointer-events here). */}
      <div className="w-full md:w-1/2" />

      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: "0%" }}
        transition={{ type: "spring", stiffness: 220, damping: 28 }}
        className="pointer-events-auto flex w-full flex-col overflow-y-auto bg-stone-950/50 p-6 pt-24 backdrop-blur-md md:w-1/2"
      >
        {traceId && (
          <button
            onClick={() => traceWidget.openItem(traceId)}
            className="mb-4 inline-block self-start text-sm font-medium text-white/60 transition-colors hover:text-white/90"
          >
            View LLM trace for this call →
          </button>
        )}

        <div className="space-y-6 rounded-2xl bg-white p-6 shadow-xl">
          <BudgetBar days={itinerary.days} budget={budget} />
          <DayList
            days={itinerary.days}
            budget={budget}
            hoveredStop={hoveredStop}
            onHoverStop={onHoverStop}
          />
          <FeedbackLoop
            onSave={onSave}
            onRefine={onRefine}
            saving={saving}
            refining={refining}
          />
        </div>
      </motion.div>

      {/* Floating top capsule: reset action + at-a-glance budget, elevated above both halves so it reads over map or list either side. */}
      <div className="pointer-events-auto absolute left-1/2 top-24 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full border border-white/20 bg-slate-900/70 px-4 py-2 shadow-lg backdrop-blur-lg">
        <button
          onClick={onBack}
          className="text-sm font-medium text-white transition-colors hover:text-orange-300"
        >
          ← New search
        </button>
        <div className="h-4 w-px bg-white/20" />
        <span className={`text-sm font-medium ${over ? "text-red-300" : "text-white/90"}`}>
          ${spent.toFixed(0)} / ${budget.toFixed(0)}
        </span>
      </div>
    </div>
  );
}
