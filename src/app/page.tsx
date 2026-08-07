"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import PreferenceStep from "@/components/PreferenceStep";
import TripSearchForm from "@/components/cesium/TripSearchForm";
import TripDashboard from "@/components/cesium/TripDashboard";
import UnboxingContainer from "@/components/cesium/UnboxingContainer";
import { useTripState } from "@/hooks/useTripState";
import { useAdaptiveContrast } from "@/hooks/useAdaptiveContrast";
import type { CesiumGlobeControls } from "@/components/cesium/CesiumGlobe";

const CesiumGlobe = dynamic(() => import("@/components/cesium/CesiumGlobe"), {
  ssr: false,
});

const NOOP_GLOBE_CONTROLS: CesiumGlobeControls = {
  ready: false,
  stopRotating: () => {},
  flyTo: async () => {},
  panTo: async () => 0,
  resetToGlobalView: async () => {},
  setPois: () => {},
  setHoveredPoi: () => {},
  clearPois: () => {},
  sampleAverageColor: () => null,
};

export default function Home() {
  const router = useRouter();
  const [globe, setGlobe] = useState<CesiumGlobeControls | null>(null);
  const trip = useTripState(globe ?? NOOP_GLOBE_CONTROLS);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const headerIsDark = useAdaptiveContrast(globe ?? NOOP_GLOBE_CONTROLS, headerRef);

  async function handleSave() {
    const id = await trip.save();
    if (id) router.push(`/trip/${id}`);
  }

  const dashboardActive = trip.status === "DASHBOARD_ACTIVE" && trip.itinerary;
  const giftBoxState =
    trip.status === "SEARCHING" || trip.status === "PREFERENCES"
      ? "open"
      : trip.status === "GENERATING"
        ? "closed"
        : "hidden";

  return (
    <main className="relative min-h-screen overflow-hidden bg-stone-950">
      <div className="absolute inset-0">
        <CesiumGlobe onReady={setGlobe} />
      </div>

      <UnboxingContainer state={giftBoxState} theme={trip.containerTheme} />

      <div ref={headerRef} className="relative z-20 mx-auto max-w-3xl px-4 py-6">
        <PageHeader
          title="TripMate"
          navLabel="My memories"
          navHref="/trips"
          variant="adaptive"
          isDark={headerIsDark}
        />
      </div>

      <AnimatePresence mode="wait">
        {dashboardActive ? (
          <motion.div
            key="dashboard"
            className="absolute inset-0 z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            {trip.itinerary && (
              <TripDashboard
                itinerary={trip.itinerary}
                traceId={trip.traceId}
                budget={trip.form.budget}
                hoveredStop={trip.hoveredStop}
                onHoverStop={trip.setHoveredStop}
                onBack={trip.reset}
                onSave={handleSave}
                onRefine={trip.refine}
                saving={trip.saving}
                refining={trip.refining}
              />
            )}
          </motion.div>
        ) : (
          <motion.div
            key="search"
            className="relative z-10 flex flex-col items-center gap-4 px-4 pt-2 md:pt-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4 }}
          >
            <AnimatePresence mode="wait">
              {trip.status === "IDLE" ? (
                <motion.div
                  key="form"
                  exit={{ scale: 0, opacity: 0 }}
                  transition={{ duration: 0.5 }}
                >
                  <TripSearchForm onSubmit={trip.submitDestination} disabled={!globe} />
                </motion.div>
              ) : trip.status === "SEARCHING" ? (
                <motion.div
                  key="searching"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="glass-panel rounded-full px-5 py-2.5 text-sm font-medium text-white"
                >
                  Finding {trip.form.destination}…
                </motion.div>
              ) : trip.status === "PREFERENCES" ? (
                <motion.div
                  key="preferences"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <PreferenceStep
                    onBack={trip.reset}
                    onSkip={() => trip.generate(null)}
                    onContinue={(preferences) => trip.generate(preferences)}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="generating"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="glass-panel rounded-full px-5 py-2.5 text-sm font-medium text-white"
                >
                  Preparing your itinerary…
                </motion.div>
              )}
            </AnimatePresence>

            {trip.error && (
              <div className="glass-panel rounded-lg px-4 py-3 text-sm text-red-100">
                {trip.error}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
