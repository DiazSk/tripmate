/**
 * The app's one error surface. Soft failures that don't block anything — a geocoder
 * miss, say — stay as muted text where they happened; this is for a request that
 * didn't complete, on every route.
 *
 * `pointer-events-auto` because it can land inside AppShell's `pointer-events-none`
 * overlay, and a `role="alert"` nobody can select text in is a dead end.
 */
export default function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="value-in pointer-events-auto rounded-xl border border-alert/30 bg-alert-soft p-3 text-sm text-alert"
    >
      {children}
    </div>
  );
}
