"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useState, useSyncExternalStore } from "react";

import { prefersReducedData, subscribeReducedData } from "@/lib/reducedData";
import { prefersReducedMotion, subscribeReducedMotion } from "@/lib/reducedMotion";
import HeroSearch from "./HeroSearch";
import { HERO_SEQUENCE } from "./heroSequence";
import type { PlanPrefill } from "./planExamples";

/** Lazy and `ssr: false` so a visitor who asked for reduced motion never downloads the engine at
 *  all — the gate below decides before this is ever referenced. */
const HeroFrames = dynamic(() => import("./HeroFrames"), { ssr: false });

/** Split editorial cover. The film keeps its existing sticky scroll track; the form
 * remains in the adjacent reading column throughout playback. */
export default function Hero({ onPlan }: { onPlan: (prefill?: PlanPrefill) => void }) {
  // `useSyncExternalStore` rather than a read in an effect: the *rendered output* depends on these
  // answers, so they belong in render. Both server snapshots say "do not play", so the server emits
  // the same one-viewport hero that shipped before this feature — with the poster as its LCP
  // element — and the client upgrades on hydration. Both also track their setting changing
  // mid-session, which an effect that reads once cannot.
  //
  // Two stores rather than one combined predicate: motion and bandwidth are separate questions
  // that happen to gate the same element, and each subscribes to its own sources.
  const motionOk = useSyncExternalStore(
    subscribeReducedMotion,
    () => !prefersReducedMotion(),
    () => false,
  );
  // The film is 9.76MB and decorative. Somebody on a metered plan should not pay for it to look
  // nice, and declining costs nothing because the poster hero is already the fallback.
  const dataOk = useSyncExternalStore(
    subscribeReducedData,
    () => !prefersReducedData(),
    () => false,
  );
  const [live, setLive] = useState(false);

  /** `undefined` → one viewport, no canvas. `"on"` → track grown, canvas mounted but transparent.
   *  `"live"` → enough frames decoded to scrub, canvas opaque. */
  const seq = !(motionOk && dataOk) ? undefined : live ? "live" : "on";

  return (
    <div className="hero-track editorial-hero relative" data-seq={seq}>
      <section className="hero-section hero-stage editorial-hero-stage pointer-events-auto sticky top-0">
        <div className="hero-block editorial-hero-copy">
          <p className="editorial-eyebrow hero-rise">Your next chapter</p>
          <h1 className="hero-rise font-scene-hero">
            A journey,{" "}<br />thoughtfully composed.
          </h1>
          <p className="editorial-standfirst hero-rise" style={{ animationDelay: "150ms" }}>
            A day-by-day trip shaped around your dates, your budget, and the way you like to travel.
          </p>
          <HeroSearch onPlan={onPlan} />
          <p className="editorial-hero-note">Real places. Considered routes. A budget that adds up.</p>
        </div>
        <div className="editorial-hero-media">
          <div aria-hidden className="hero-poster absolute inset-0">
            <Image src={HERO_SEQUENCE.poster} alt="" fill priority
              sizes="(min-width: 1024px) 50vw, 100vw" className="object-cover" />
          </div>
          {seq && <HeroFrames onLive={() => setLive(true)} />}
          <div className="editorial-photo-caption"><span>Petra, Jordan</span><span>A different perspective</span></div>
        </div>
      </section>
    </div>
  );
}
