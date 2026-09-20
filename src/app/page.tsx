import { readProfile } from "@/lib/db";
import { currentOwnerId } from "@/lib/ownerRequest";
import HomeView from "./HomeView";

/**
 * Server half of `/`: reads the saved traveler profile so the wizard is already seeded with it.
 *
 * The view is `"use client"` from top to bottom — it owns the landing scroll story, the whole
 * plan wizard, generation, and the camera — so this file does nothing but the read, matching the
 * split `/trip/[id]` already uses.
 *
 * The profile supplies defaults; the wizard always wins. Nothing is locked — a solo traveler who
 * usually goes with kids just changes it on the screen, and that trip's answers are what
 * generation sees. A missing profile leaves the hardcoded defaults in place, which is exactly the
 * first-visit experience.
 */
export const dynamic = "force-dynamic";

export default async function HomePage() {
  return <HomeView initialProfile={readProfile(await currentOwnerId())} />;
}
