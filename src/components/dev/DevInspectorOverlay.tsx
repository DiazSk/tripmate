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
    // Coalesced to one `closest()` walk per frame. Unthrottled, this ran an ancestor walk to
    // the document root plus a setState on every `mousemove` — 120-1000Hz on a high-polling
    // mouse — on top of a page that is already sharing its frame budget with the globe. The
    // badge only has to be right once per painted frame, so the last target of the frame wins.
    let pendingTarget: Element | null = null;
    let frame = 0;
    function flush() {
      frame = 0;
      const tagged = pendingTarget?.closest(`[${DEV_NAME_ATTR}]`);
      setHovered(tagged?.getAttribute(DEV_NAME_ATTR) ?? null);
    }
    function handleMove(e: MouseEvent) {
      pendingTarget = e.target as Element | null;
      if (!frame) frame = requestAnimationFrame(flush);
    }
    document.addEventListener("mousemove", handleMove, { passive: true });
    return () => {
      document.removeEventListener("mousemove", handleMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div className="pointer-events-none absolute top-[calc(var(--nav-h)+0.5rem)] left-5 z-50 rounded border border-black/10 bg-white/90 px-2 py-1 text-xs font-medium text-slate-900 shadow-md sm:left-6 print:hidden">
      {hovered ?? "—"}
    </div>
  );
}
