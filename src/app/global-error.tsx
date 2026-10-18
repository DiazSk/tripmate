"use client";

import { useEffect } from "react";

/**
 * The last boundary: the root layout itself failed (copy row G-18). It replaces the layout, so it
 * brings its own document and none of the app's styles, fonts or providers can be assumed. That is
 * why it is plain inline markup rather than `PageError`/`InlineNote`: it has to render when the
 * thing that failed is the shell the others stand in. It copies the section note's shape (a dashed
 * frame, a "Couldn't load" tag, the cause, one way forward) in the app's night colours, and
 * "Reload" is a full page load because there is no layout left to re-render into.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="en">
      <head>
        <title>TripMate couldn’t start</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          padding: "1.25rem",
          background: "#090b10",
          color: "#ffffff",
          font: "16px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif",
        }}
      >
        <main
          style={{
            width: "100%",
            maxWidth: "36rem",
            display: "grid",
            justifyItems: "start",
            gap: "0.75rem",
            padding: "1.25rem 1.375rem",
            border: "1px dashed rgba(255,255,255,0.28)",
            borderRadius: "0.25rem",
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem" }}>
            <h1 style={{ margin: 0, fontSize: "1.0625rem", fontWeight: 600 }}>TripMate couldn’t start.</h1>
            <span
              style={{
                fontSize: "0.6875rem",
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: "#ffb3b3",
                border: "1px solid rgba(255,179,179,0.45)",
                borderRadius: 2,
                padding: "3px 7px",
              }}
            >
              Couldn’t load
            </span>
          </div>
          <p style={{ margin: 0, fontSize: "0.9375rem", color: "rgba(255,255,255,0.86)" }}>
            The app failed while loading, so nothing could be shown. Your saved trips are safe.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              height: "2.5rem",
              padding: "0 1.125rem",
              border: 0,
              borderRadius: 2,
              background: "#ff7e15",
              color: "#1f2a44",
              fontFamily: "inherit",
              fontSize: "0.9rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
