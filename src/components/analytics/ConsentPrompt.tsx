"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import InlineNote from "@/components/InlineNote";

/**
 * The one question every tester is asked, once, before anything is captured (copy rows AN-01, AN-02).
 *
 * A card at the foot of the page rather than a dialog: it never blocks the app, and an unanswered
 * prompt is simply a No. Yes and No are the same size and tone on purpose, since a bundled answer
 * that nudges one way is not a free one. If the server does not take the answer the prompt stays,
 * says so, and nothing starts.
 */
export default function ConsentPrompt({ onAnswer }: { onAnswer: (yes: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const card = useRef<HTMLElement>(null);

  // **It sits over the foot of the page, so it says how much.** At phone width the card spans the
  // screen's bottom ~170px, which is exactly where the planner's sticky Next / Plan my trip bar
  // lives: the bar was under it, unreachable until the question was answered. Its height plus its
  // own offset goes on <html> as `--consent-inset`, and a bottom-pinned control adds it (see
  // `.pp-bar`). Cleared when the card goes, so nothing stays lifted after an answer.
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    const root = document.documentElement;
    const set = () => root.style.setProperty("--consent-inset", `${Math.ceil(innerHeight - el.getBoundingClientRect().top)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    addEventListener("resize", set);
    return () => {
      ro.disconnect();
      removeEventListener("resize", set);
      root.style.removeProperty("--consent-inset");
    };
  }, []);

  async function answer(yes: boolean) {
    setBusy(true);
    setFailed(false);
    try {
      await onAnswer(yes);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <section
      ref={card}
      aria-label="Help improve TripMate"
      className="glass-itinerary is-opaque pointer-events-auto fixed inset-x-4 bottom-4 z-40 rounded-md p-4 sm:right-auto sm:max-w-md"
    >
      <p className="text-sm font-medium text-foreground">Help improve TripMate?</p>
      <p className="mt-1 text-sm text-muted">
        Share how you use it, including screen recordings. What you type is never recorded.{" "}
        <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
          How this works
        </Link>
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="err-btn err-btn-quiet" disabled={busy} onClick={() => answer(true)}>
          Yes
        </button>
        <button type="button" className="err-btn err-btn-quiet" disabled={busy} onClick={() => answer(false)}>
          No
        </button>
        {/* Kept mounted, empty, so the sentence is read when it arrives. */}
        <InlineNote size="item" tone="error">
          {failed ? "Couldn’t save your answer. Try again." : ""}
        </InlineNote>
      </div>
    </section>
  );
}
