"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { MapCameraProvider } from "@/lib/mapCamera";

const GlobeBackground = dynamic(() => import("@/components/GlobeBackground"), {
  ssr: false,
});

const HeroLayoutContext = createContext<(active: boolean) => void>(() => {});

/**
 * Home page only: swaps the shell from split panes to the hero band. Hero is the *default*
 * so `/` paints correctly on the very first frame — React doesn't guarantee passive effects
 * flush before paint, so a false default would show one frame of split pane before flipping.
 * The page only ever turns it off, once an itinerary exists.
 */
export function useHeroLayout(active: boolean) {
  const setHero = useContext(HeroLayoutContext);
  useEffect(() => {
    setHero(active);
    return () => setHero(true);
  }, [active, setHero]);
}

export default function AppShell({ children }: { children: ReactNode }) {
  const [heroRequested, setHeroRequested] = useState(true);
  const hero = usePathname() === "/" && heroRequested;

  return (
    <MapCameraProvider>
      <HeroLayoutContext.Provider value={setHeroRequested}>
        <div className="relative flex h-dvh flex-col overflow-hidden md:flex-row">
          <div
            className={
              hero
                ? "absolute inset-x-0 top-0 h-1/2 sm:h-[56%]"
                : "relative h-[40vh] w-full shrink-0 md:h-full md:w-[55%]"
            }
          >
            {/* GlobeBackground must stay the first child in BOTH branches — only the
                className above may change. Giving it a varying key, wrapping it in a
                conditional element, or moving it into a ternary branch all destroy and
                rebuild the Cesium viewer, which loses the camera wherever the user flew to
                and re-fetches the Google 3D tiles. */}
            <GlobeBackground
              // In hero mode the form card overlaps the band's bottom edge, so pane-relative
              // credits would sit on top of the form; pin them to the page corner instead.
              creditClassName={hero ? "fixed bottom-1 left-3" : "absolute bottom-1 left-3"}
            />
            {hero && (
              <>
                <div
                  aria-hidden="true"
                  className="hero-scrim pointer-events-none absolute inset-x-0 top-0 h-44"
                />
                <div
                  aria-hidden="true"
                  className="hero-seam pointer-events-none absolute inset-x-0 bottom-0 h-28"
                />
              </>
            )}
          </div>
          <div
            className={
              hero
                ? "absolute inset-0 z-10 overflow-y-auto"
                : "w-full flex-1 overflow-y-auto md:h-full md:w-[45%]"
            }
          >
            {children}
          </div>
        </div>
      </HeroLayoutContext.Provider>
    </MapCameraProvider>
  );
}
