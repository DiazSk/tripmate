import type { Metadata } from "next";
import OfflineView from "./OfflineView";

export const metadata: Metadata = { title: "Offline · TripMate" };

/**
 * Precached by `public/sw.js` at install time, with the static files its HTML references, and served
 * when a navigation has no network and no cached match for the requested page. Deliberately static —
 * no DB read, no `force-dynamic` — so it's servable from Cache Storage with nothing else needed. Every
 * live part (the trips this device kept, the reconnect) runs in the browser; see `OfflineView`.
 */
export default function OfflinePage() {
  return <OfflineView />;
}
