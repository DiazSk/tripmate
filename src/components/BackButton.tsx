"use client";

/**
 * The app's one "step back out of here" control. Extracted from PlaceDetailPanel, which
 * owned this markup inline until the profile page needed the same affordance — three
 * copies of a chevron plus the ghost-button class list is where a shared component earns
 * its keep.
 *
 * Renders a `button`, never a `Link`, on purpose: two of the three call sites reverse
 * in-page state (closing a stop detail) rather than navigating, and the third pops history.
 * A link would be wrong markup for both.
 */
export default function BackButton({
  onClick,
  children,
  className = "",
}: {
  onClick: () => void;
  children: React.ReactNode;
  /** For call-site spacing only (e.g. the detail panel's own `mb-4`). */
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-ml-3 flex min-h-11 items-center gap-1.5 self-start rounded-full px-3 text-sm font-medium text-muted transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${className}`}
    >
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
        <path
          d="M12 5l-5 5 5 5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {children}
    </button>
  );
}
