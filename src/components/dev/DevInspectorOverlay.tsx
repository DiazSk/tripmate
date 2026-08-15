"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { DEV_NAME_ATTR } from "@/lib/devInspector";

/** Routes where the hover inspector stays off — /backend is its own dashboard with its own
 *  labeled sections (Past searches, Run detail, …) already visible in the page itself, so a
 *  second "what am I hovering" badge just repeats what's already on screen. */
const DISABLED_PATH_PREFIXES = ["/backend"];

/**
 * Fixed badge under the TripMate wordmark that names whichever `devLabel`-tagged container the
 * cursor is currently over — hover the UI to see which component/section owns that pixel instead
 * of guessing from the rendered output. `closest()` walks up from the exact element under the
 * pointer, so hovering a small tagged region inside a larger tagged one reports the smaller,
 * more specific name. Dev-only: renders nothing and attaches no listener in production.
 */
export default function DevInspectorOverlay() {
  const [hovered, setHovered] = useState<string | null>(null);
  const pathname = usePathname();
  const enabled =
    process.env.NODE_ENV === "development" &&
    !DISABLED_PATH_PREFIXES.some((prefix) => pathname?.startsWith(prefix));

  useEffect(() => {
    if (!enabled) return;
    function handleMove(e: MouseEvent) {
      const target = e.target as Element | null;
      const tagged = target?.closest(`[${DEV_NAME_ATTR}]`);
      setHovered(tagged?.getAttribute(DEV_NAME_ATTR) ?? null);
    }
    document.addEventListener("mousemove", handleMove);
    return () => document.removeEventListener("mousemove", handleMove);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div className="pointer-events-none absolute top-14 left-5 z-50 rounded border border-black/10 bg-white/90 px-2 py-1 text-xs font-medium text-slate-900 shadow-md sm:top-16 sm:left-6">
      {hovered ?? "—"}
    </div>
  );
}
