"use client";

import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

/**
 * A textarea that is always exactly as tall as its content.
 *
 * It exists because the inline editor has to hold a stop's description *in the place the
 * description already is*, and a fixed-height box cannot do that: two lines of prose in a
 * three-row textarea leaves a hole under the text, and four lines in a two-row one hides the
 * end behind an inner scrollbar. Either way the row's height stops matching the read-only row it
 * replaced, which is the one thing the edit mode is not allowed to do.
 *
 * The measurement is the standard one and the order matters: `height` has to be cleared before
 * `scrollHeight` is read, or the value returned is the *current* height whenever the content has
 * shrunk, and the box can then only ever grow. Reading `scrollHeight` forces layout, so this runs
 * in `useLayoutEffect` — in a passive effect the browser would paint the un-resized box first and
 * every keystroke that changed the line count would flash.
 *
 * `rows={1}` rather than a `min-height`: it gives the element a one-line floor in the same units
 * the font is in, so it stays right through a font-size change without a second number to keep
 * in step.
 */
export default function AutoTextarea({
  value,
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      // `resize-none` because the height is owned above — a drag handle would fight the effect,
      // which would win on the next keystroke. `overflow-hidden` suppresses the scrollbar that
      // flickers in during the frame between a paste and the resize.
      className={`resize-none overflow-hidden ${className}`}
      {...props}
    />
  );
}
