"use client";

import { useEffect, useState } from "react";

const DISMISSED_KEY = "tripmate:install-dismissed";

/** Not in lib.dom.d.ts — Chromium-only, no standard type exists for it. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => void;
}

/**
 * `beforeinstallprompt` has zero support on iOS Safari — there is no programmatic install
 * prompt there at all, ever. `ios` distinguishes that case so the caller can render manual
 * "Share → Add to Home Screen" instructions instead of a button that would never fire.
 */
function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

// Starts as "nothing to show" so nothing flashes on the server-rendered pass, before the effect
// below has read the real client-only values (navigator/matchMedia/localStorage don't exist
// during SSR).
const INITIAL_CLIENT_STATE = { ios: false, standalone: true, dismissed: true };

export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [clientState, setClientState] = useState(INITIAL_CLIENT_STATE);

  // A lazy `useState(() => …)` initializer is the usual fix for "read real values before first
  // paint" — not safe here, same reasoning as HomeView.tsx's plan-draft restore: this hook backs
  // a client component that still renders once on the server, where navigator/matchMedia/
  // localStorage don't exist, and once on the client for hydration, which must match. Reading
  // real values in the initializer would make hydration diverge from the server-rendered HTML.
  /* eslint-disable react-hooks/set-state-in-effect -- see the note above */
  useEffect(() => {
    setClientState({
      ios: isIos(),
      standalone: isStandalone(),
      dismissed: localStorage.getItem(DISMISSED_KEY) === "1",
    });

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    setDeferredPrompt(null);
  };

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setClientState((state) => ({ ...state, dismissed: true }));
  };

  const { ios, standalone, dismissed } = clientState;
  const visible = !standalone && !dismissed && (ios || deferredPrompt !== null);

  return { visible, ios, install, dismiss };
}
