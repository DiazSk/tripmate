"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import InlineNote from "@/components/InlineNote";
import { analyticsConfigured, CONSENT_EVENT, readStoredConsent, setConsent } from "@/lib/analytics/client";

/**
 * Profile's "Help improve TripMate" switch (copy rows AN-03, AN-04): the same single answer the
 * prompt asks, changeable at any time. Off asks PostHog to delete what was sent. Absent when
 * analytics is not configured, and disabled until the stored answer has been read, so a failed
 * read can never show, or flip, an answer nobody gave.
 */
export default function AnalyticsSwitch() {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!analyticsConfigured) return;
    let live = true;
    void readStoredConsent().then((s) => live && s && setOn(s.consent === true));
    // The prompt can be answered while this page is open.
    const heard = (e: Event) => setOn((e as CustomEvent<boolean>).detail);
    window.addEventListener(CONSENT_EVENT, heard);
    return () => {
      live = false;
      window.removeEventListener(CONSENT_EVENT, heard);
    };
  }, []);

  if (!analyticsConfigured) return null;

  async function flip() {
    setBusy(true);
    setFailed(false);
    try {
      await setConsent(!on);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="pb-analytics" className="pb-field" aria-labelledby="pb-analytics-t">
      <h2 id="pb-analytics-t" className="pb-field-title">
        Help improve TripMate
      </h2>
      <p className="pf-hint">
        Share how you use it, including screen recordings. What you type is never recorded.{" "}
        <Link href="/privacy" className="underline underline-offset-2">
          How this works
        </Link>
      </p>
      <div className="pb-field-control">
        <button
          type="button"
          role="switch"
          aria-checked={on === true}
          aria-labelledby="pb-analytics-t"
          disabled={on === null || busy}
          className={`pf-chip pf-chip-plain${on ? " is-on" : ""}`}
          onClick={flip}
        >
          {on ? "On" : "Off"}
        </button>
        <InlineNote size="item" tone="error">
          {failed ? "Couldn’t save that. Try again." : ""}
        </InlineNote>
      </div>
    </section>
  );
}
