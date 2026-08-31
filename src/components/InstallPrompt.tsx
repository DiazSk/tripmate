"use client";

import { useInstallPrompt } from "@/lib/useInstallPrompt";

/**
 * `beforeinstallprompt` never fires on iOS, so there's no button that can trigger a prompt
 * there — the iOS branch is static instructions instead of a dead button.
 */
export default function InstallPrompt() {
  const { visible, ios, install, dismiss } = useInstallPrompt();
  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-20 flex justify-center px-4">
      <div className="glass-control pointer-events-auto flex items-center gap-4 rounded-full py-2.5 pr-2.5 pl-5">
        {ios ? (
          <p className="text-xs text-white/90">
            Install TripMate: tap <span className="font-semibold">Share</span>, then{" "}
            <span className="font-semibold">Add to Home Screen</span>.
          </p>
        ) : (
          <>
            <p className="text-xs text-white/90">Install TripMate for quicker access.</p>
            <button
              type="button"
              onClick={install}
              className="rounded-full bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent-hover"
            >
              Install
            </button>
          </>
        )}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white/90"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M1 1l10 10M11 1L1 11"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
