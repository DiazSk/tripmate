"use client";

import { useEffect, useState } from "react";

/**
 * Letter-by-letter reveal with a blinking cyan cursor, for the "AI is writing this live"
 * effect during itinerary-generation reveal. The cursor disappears once the text has
 * fully printed.
 *
 * Assumes `text` is stable for this component's lifetime — pass a `key` at the call site
 * (e.g. keyed by day index) to get an independent restart for new text, rather than
 * relying on this component to detect a text change on an already-mounted instance.
 */
export default function Typewriter({
  text,
  speed = 22,
  className,
}: {
  text: string;
  /** Milliseconds per character. */
  speed?: number;
  className?: string;
}) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!text) return;
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setCount(i);
      if (i >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);

  const done = count >= text.length;

  return (
    <span className={className}>
      {text.slice(0, count)}
      {!done && (
        <span
          aria-hidden="true"
          className="ml-0.5 inline-block h-[0.9em] w-[2px] animate-pulse align-middle"
          style={{ background: "#06B6D4", boxShadow: "0 0 6px rgba(6, 182, 212, 0.8)" }}
        />
      )}
    </span>
  );
}
