"use client";

import { useState } from "react";

/**
 * The right-docked content column, and the one place its geometry is written. Every
 * "content over the globe" surface uses it: the home page's result view, /trips, and
 * /trip/[id].
 *
 * Top offset reads `--nav-h` (the fixed glass navbar's height, set in globals.css) plus
 * the page's own gutter, at both breakpoints — a full-width fixed nav sits above a
 * right-docked panel too, not just a full-bleed one, unlike the small top-left wordmark
 * this replaced.
 *
 * **The collapse is not a nicety.** Below `sm` this panel covers the entire viewport,
 * which means the globe — the product's one piece of real imagery, and the thing the
 * route, the stems and the marker cards are all drawn on — is invisible on a phone,
 * and the map controls have nowhere to sit. `collapsible` shrinks the panel to a
 * bottom sheet on a phone, and the control stack appears in the revealed area (see
 * `.app-shell:has(.docked-panel-collapsed)` in globals.css). Above `sm` there is
 * nothing to collapse and the affordance is not rendered.
 */
export default function DockedPanel({
  collapsible = false,
  className = "space-y-6",
  /** True while a request is replacing this panel's content. Stops the stale content
   *  being clicked while the loader is over it, and says so to assistive tech. */
  busy = false,
  /** Widens the panel to fit two real panes (e.g. Focus Mode's chat + preview split)
   *  instead of the single-column summary width. */
  wide = false,
  children,
}: {
  collapsible?: boolean;
  className?: string;
  busy?: boolean;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const isCollapsed = collapsible && collapsed;
  const widthClass = wide ? "sm:w-[62%] sm:max-w-[880px]" : "sm:w-[40%] sm:max-w-[520px]";

  return (
    <div
      aria-busy={busy || undefined}
      className={`docked-panel fixed inset-x-0 bottom-0 z-10 m-0 overflow-y-auto sm:right-6 sm:bottom-6 sm:left-auto sm:h-auto sm:min-w-[360px] ${widthClass} ${
        busy ? "pointer-events-none" : "pointer-events-auto"
      } ${
        isCollapsed
          ? "docked-panel-collapsed top-auto h-[var(--mobile-sheet-h)] sm:top-[calc(var(--nav-h)+1.5rem)]"
          : "top-[calc(var(--nav-h)+1.25rem)] sm:top-[calc(var(--nav-h)+1.5rem)]"
      } ${className}`}
    >
      {collapsible && (
        // Sticky so it survives the panel's own scrolling, and `sm:hidden` because
        // above that breakpoint the globe is already beside the panel, not under it.
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          // `.glass-control`'s own box-shadow is plain unlayered CSS, which cascade layers
          // rank above any `@layer`-emitted rule regardless of specificity — including
          // Tailwind's `ring-*` utility, which composes onto `box-shadow`. Combined with
          // `outline-none` here, keyboard focus on this button was completely invisible.
          // `outline` is a separate property, so it doesn't fight the control's own shadow.
          className="glass-control sticky top-0 z-20 -mt-1 mb-1 flex min-h-11 w-full items-center justify-center gap-2 rounded-full text-sm font-medium text-white/90 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 sm:hidden"
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
            className={`h-3.5 w-3.5 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
              collapsed ? "" : "rotate-180"
            }`}
          >
            <path
              d="M5 12l5-5 5 5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {collapsed ? "Show the plan" : "Show the map"}
        </button>
      )}
      {children}
    </div>
  );
}
