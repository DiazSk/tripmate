"use client";

import { useId } from "react";
import { Check, CircleAlert, RotateCw } from "lucide-react";

type Action = { label: string; onClick: () => void; busy?: boolean };

/**
 * A failure that belongs to something on screen, written on that thing (canvas "Errors · 3 Inline").
 * The default: a toast or a dialog needs a reason not to be this.
 *
 * - `field` sits under its control. Give it an `id` and point the control's `aria-describedby` at it.
 * - `item` rides on a row or chip, with its own way forward as a text action.
 * - `section` stands in for a block that couldn't load: a dashed frame in the block's place (so
 *   nothing below jumps), a "Couldn't load" tag, the why, and a retry.
 *
 * Polite and never focus-moving. **Keep it mounted and change its children**: a live region
 * announces changes inside a region it already knows, so a field/item note that mounts at the same
 * moment as its text is often never read. Render it empty (or with the ok/muted copy) and swap the
 * words in. On a light surface (`data-appearance="light"`) the alert tone re-points to
 * `--wd-alert-text`; a dark island inside one (`data-appearance="dark"`) gets the night colour back.
 */
export default function InlineNote({
  size,
  tone,
  id,
  title,
  action,
  children,
}: {
  size: "field" | "item" | "section";
  tone: "error" | "ok" | "muted";
  id?: string;
  /** Section only: the block's name ("Weather for these dates"). */
  title?: string;
  action?: Action;
  children: React.ReactNode;
}) {
  const titleId = useId();
  const glyph = tone === "error" ? <CircleAlert aria-hidden="true" /> : tone === "ok" ? <Check aria-hidden="true" /> : null;
  const cls = `inline-note is-${size} is-${tone}`;

  if (size === "section") {
    return (
      <div id={id} className={cls} role="group" aria-labelledby={title ? titleId : undefined}>
        <div className="inline-note-head">
          {title && (
            <p id={titleId} className="inline-note-title">
              {title}
            </p>
          )}
          {tone === "error" && <span className="inline-note-tag">Couldn&rsquo;t load</span>}
        </div>
        <p className="inline-note-why">{children}</p>
        {action && (
          <button
            type="button"
            className="err-btn err-btn-quiet"
            onClick={action.onClick}
            disabled={action.busy}
            aria-busy={action.busy || undefined}
          >
            <RotateCw aria-hidden="true" />
            {action.label}
          </button>
        )}
      </div>
    );
  }

  if (size === "field") {
    return (
      <p id={id} className={cls} aria-live="polite">
        {glyph}
        <span>{children}</span>
      </p>
    );
  }

  return (
    <span id={id} className={cls} aria-live="polite">
      <span className="inline-note-status">
        {glyph}
        {children}
      </span>
      {action && (
        <button
          type="button"
          className="err-btn err-btn-text"
          onClick={action.onClick}
          disabled={action.busy}
          aria-busy={action.busy || undefined}
        >
          {action.label}
        </button>
      )}
    </span>
  );
}
