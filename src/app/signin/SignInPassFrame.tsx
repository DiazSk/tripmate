import Image from "next/image";
import type { ReactNode } from "react";

import "@/components/polar/PolarLanding.css";
import "@/components/polar/SignInPass.css";

/**
 * The ground every state of `/signin` stands on: Wadi Rum at night, full bleed, behind the pass. The
 * form, the Suspense fallback and the "accounts aren't set up" page all render inside it, so the
 * route never flashes a different background while the client half arrives.
 *
 * `data-nav-theme="photo"` puts the app's own Polar nav in white over the photograph.
 * `map-chrome-hidden` stands the globe's controls down: there is no map being read here.
 */
export function SignInPassFrame({ children }: { children: ReactNode }) {
  return (
    <main className="tm sp map-chrome-hidden" data-nav-theme="photo">
      <div className="sp-bg" aria-hidden="true">
        <Image src="/scenes/wadi-rum-desert.webp" alt="" fill priority sizes="100vw" />
      </div>
      <div className="sp-veil" aria-hidden="true" />
      <div className="sp-stage">{children}</div>
      <footer className="sp-foot">
        <p className="tm-coord tm-on-dark-2">Wadi Rum, Jordan · [ 29º 35’ 00” N, 35º 25’ 00” E ]</p>
      </footer>
    </main>
  );
}
