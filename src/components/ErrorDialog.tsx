"use client";

import { useEffect, useId, useRef } from "react";
import { TriangleAlert } from "lucide-react";

type Choice = { label: string; onClick: () => void };

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A failure that blocks: carrying on would lose something, or there is nothing to carry on with
 * (canvas "Errors · 2 Modal"). Rare by rule — if it can be inline or a toast, it is.
 *
 * The title is the outcome as a sentence; **Why** is the cause and what was or wasn't lost; **Now**
 * is what the two buttons do. `primary` is the safe choice: it is in signal, it has focus, and Esc
 * and a backdrop click pick it.
 *
 * Built on the native `<dialog>` the way `ConfirmDialog` is, for the same reasons (focus trap, the
 * page going inert, top layer) and with the same `pointer-events` opt-in via `.confirm-dialog` —
 * see the comment there. Focus returns to whatever opened it: native `close()` does that itself,
 * and the unmount path (a caller rendering `{failure && <ErrorDialog open … />}`) does it by hand.
 */
export default function ErrorDialog({
  open,
  eyebrow,
  title,
  why,
  now,
  primary,
  secondary,
  detail,
}: {
  open: boolean;
  eyebrow?: string;
  title: string;
  why: React.ReactNode;
  now: React.ReactNode;
  primary: Choice;
  secondary: Choice;
  detail?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  // What React last asked for, read by `onClose` to tell a native close from our own.
  const wantOpen = useRef(open);
  const id = useId();

  // `open` is driven by React, but a modal `<dialog>` is imperative: the `open` attribute alone
  // renders it non-modally, so it goes through showModal()/close().
  useEffect(() => {
    const el = ref.current;
    wantOpen.current = open;
    if (!el) return;
    if (open && !el.open) {
      opener.current = document.activeElement as HTMLElement | null;
      el.showModal();
      // The native focusing steps would pick the first button, which is the secondary one.
      primaryRef.current?.focus();
    } else if (!open && el.open) {
      el.close();
      opener.current = null;
    }
  }, [open]);

  useEffect(
    () => () => {
      // Unmounted while open: no close() ran, so nothing restored focus.
      if (opener.current?.isConnected) opener.current.focus();
    },
    []
  );

  return (
    <dialog
      ref={ref}
      role="alertdialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-why`}
      // Esc fires `cancel`; the element must not close behind React's back, and the safe choice is
      // what Esc means here.
      onCancel={(e) => {
        e.preventDefault();
        primary.onClick();
      }}
      // A close React didn't ask for (Chrome's close watcher closes on a second Esc without a
      // cancellable `cancel`) is the safe choice too, so the parent's state can't stay open.
      onClose={() => {
        if (!wantOpen.current) return;
        opener.current = null;
        primary.onClick();
      }}
      onClick={(e) => {
        if (e.target === ref.current) primary.onClick();
      }}
      // A modal <dialog> lets Tab leave for the browser's own UI after the last control. Cycle
      // through everything focusable inside instead, links in `why` or `now` included.
      onKeyDown={(e) => {
        if (e.key !== "Tab" || !ref.current) return;
        const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (items.length === 0) return;
        e.preventDefault();
        const i = items.indexOf(document.activeElement as HTMLElement);
        const step = e.shiftKey ? -1 : 1;
        const next = i < 0 ? (e.shiftKey ? items.length - 1 : 0) : (i + step + items.length) % items.length;
        items[next].focus();
      }}
      className="confirm-dialog error-dialog"
    >
      <div className="error-dialog-body">
        <div className="error-dialog-head">
          <TriangleAlert aria-hidden="true" strokeWidth={1.6} />
          {eyebrow && <p className="err-eyebrow">{eyebrow}</p>}
        </div>
        <h2 id={`${id}-title`} className="error-dialog-title">
          {title}
        </h2>
        <dl className="error-dialog-reason">
          <dt className="err-eyebrow">Why</dt>
          <dd id={`${id}-why`}>{why}</dd>
          <dt className="err-eyebrow">Now</dt>
          <dd>{now}</dd>
        </dl>
        <div className="error-dialog-actions">
          <button type="button" className="err-btn err-btn-quiet" onClick={secondary.onClick}>
            {secondary.label}
          </button>
          <button ref={primaryRef} type="button" className="err-btn err-btn-signal" onClick={primary.onClick}>
            {primary.label}
          </button>
        </div>
        {detail && <p className="error-dialog-detail">{detail}</p>}
      </div>
    </dialog>
  );
}
