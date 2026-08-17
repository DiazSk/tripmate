"use client";

import { useEffect, useRef } from "react";

/**
 * The app's one confirmation dialog, for actions that can't be undone.
 *
 * Built on the native `<dialog>` element rather than a hand-rolled overlay, which is what
 * buys the four things a modal has to get right and is easy to get subtly wrong: a focus
 * trap, Esc-to-close, the rest of the page going `inert`, and top-layer rendering.
 *
 * Top-layer promotion only changes *paint* order, not the DOM tree or the CSS cascade —
 * this component still renders as a child of AppShell's `pointer-events-none` content
 * overlay, and `pointer-events` is an inherited property, so without an explicit override
 * the dialog inherits `none` and every button inside it becomes unclickable by a real
 * pointer (`HTMLElement.click()` skips hit-testing entirely, so this doesn't show up
 * under a programmatic click — only a real mouse/touch one). `.confirm-dialog` in
 * globals.css sets `pointer-events: auto` for exactly this reason — the Pointer-Events
 * Opt-In Rule applies here too, top layer or not.
 */
export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  /** Disables both buttons and relabels confirm while the action is in flight. */
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  // `open` is driven by React, but `<dialog>`'s modal state is imperative — setting the
  // `open` *attribute* renders it non-modally (no top layer, no focus trap, no backdrop),
  // so it has to go through showModal()/close() instead.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      // Esc fires `cancel` rather than a click on any button, so the parent's state would
      // otherwise stay `open` while the element itself closed — leaving a dialog that can
      // never be reopened. Routing it through onCancel keeps the two in sync.
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onCancel();
      }}
      // Clicking the ::backdrop targets the dialog element itself (the padding-box is the
      // panel, so a hit on <dialog> is a hit outside the content). Same dismissal as Esc.
      onClick={(e) => {
        if (e.target === ref.current && !pending) onCancel();
      }}
      aria-labelledby="confirm-dialog-title"
      className="confirm-dialog glass-itinerary w-[calc(100vw-2.5rem)] max-w-md rounded-2xl p-5 sm:p-6"
    >
      <h2 id="confirm-dialog-title" className="font-display text-lg font-semibold text-foreground">
        {title}
      </h2>
      <div className="mt-2 text-sm text-muted">{body}</div>
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-full px-4 py-2 text-sm font-medium text-muted transition-colors hover:bg-white/10 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none"
        >
          Cancel
        </button>
        {/* The system's one solid destructive-adjacent button (DESIGN.md's Alert Red note),
            not a new variant — red is reserved for failure and destruction, and this is the
            only place in the app that spends it on a button the user presses on purpose. */}
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className="rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:outline-none"
        >
          {pending ? "Deleting…" : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
