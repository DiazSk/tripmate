/**
 * Precached by `public/sw.js` at install time and served when a navigation has no network and no
 * cached match for the requested page. Deliberately static — no DB read, no `force-dynamic` — so
 * it's servable from Cache Storage with nothing else needed.
 */
export default function OfflinePage() {
  return (
    <div className="content-overlay pointer-events-auto flex min-h-dvh items-center justify-center px-6 text-center">
      <div className="glass-control rounded-2xl px-8 py-10">
        <h1 className="font-display text-2xl font-semibold text-foreground">You&rsquo;re offline</h1>
        <p className="mt-2 text-sm text-white/70">
          This page needs a connection. Trips you&rsquo;ve already opened may still be available —
          try going back.
        </p>
      </div>
    </div>
  );
}
