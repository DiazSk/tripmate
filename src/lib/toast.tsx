"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Check, X } from "lucide-react";

/**
 * Transient confirmations — "Bar Luce added to Day 3".
 *
 * **Only for things the traveler just did, and only where the result is off screen.** A toast is a
 * message that interrupts and then disappears, which makes it the wrong shape for almost
 * everything: an error the traveler has to act on must not evaporate (that is `ErrorNote`), a
 * state a row can show must be shown on the row (the search list's own "Added" badge), and a
 * process still running is a spinner. What is left, and what this exists for, is the acknowledgement
 * that an action landed somewhere the traveler cannot currently see — adding a place to a day while
 * the itinerary panel is scrolled elsewhere, or covered by the map.
 *
 * Deliberately not a general notification centre: no queue history, no severity levels beyond the
 * one, no actions inside the toast. Something that needs a button needs a dialog.
 */

export interface Toast {
  id: number;
  message: string;
  /** Optional second line — the detail that makes the first line checkable ("Day 3 · 4 stops"). */
  detail?: string;
}

interface ToastContextValue {
  /** Show a toast. Returns its id, so a caller that wants to replace its own can dismiss it. */
  show: (message: string, detail?: string) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** How long a toast stays up. Long enough to read two short lines without hurrying, short enough
 *  that adding three places in a row does not stack a wall of them. */
const TOAST_MS = 3200;

/** Above this many at once the oldest is dropped rather than growing the stack down the screen.
 *  Three is what fits comfortably above the fold on a laptop. */
const MAX_VISIBLE = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Monotonic, and a ref rather than state: two toasts raised in the same tick must not collide on
  // a key, and bumping a counter must not itself schedule a render.
  const nextId = useRef(1);
  // Keyed by toast id so a dismissal clears exactly its own timer. A single shared timer was the
  // obvious first shape and is wrong: the second toast's timer would replace the first's, and the
  // first would then sit on screen forever.
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, detail?: string) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, message, detail }].slice(-MAX_VISIBLE));
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id);
          setToasts((current) => current.filter((t) => t.id !== id));
        }, TOAST_MS)
      );
      return id;
    },
    []
  );

  // Every pending timer cleared on unmount. Without this a navigation away mid-toast leaves a
  // setState scheduled against a provider that no longer exists.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* `aria-live="polite"` rather than `assertive`: this is a confirmation of something the
          traveler just did on purpose, so it should be read at the next natural pause rather than
          interrupt whatever the screen reader is in the middle of. The region is always in the
          DOM — an element that appears at the same moment its text does is frequently missed by
          the live-region implementations, which watch for *changes* inside a region they already
          know about. */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex w-[min(24rem,calc(100vw-3rem))] -translate-x-1/2 flex-col gap-2 print:hidden"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="glass-control pointer-events-auto flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 shadow-lg motion-safe:animate-[toast-in_180ms_ease-out]"
          >
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent">
              <Check className="h-3 w-3" strokeWidth={3} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-snug text-foreground">{toast.message}</p>
              {toast.detail && <p className="mt-0.5 text-xs text-muted">{toast.detail}</p>}
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss"
              className="-mr-1 shrink-0 rounded-md p-1 text-muted transition-colors hover:bg-white/10 hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Raise a toast.
 *
 * Returns a no-op outside the provider rather than throwing. A toast is an embellishment on an
 * action that has already succeeded, and a component rendered in a test, a story or a print route
 * should not fail to mount because the confirmation it would have shown has nowhere to go.
 */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  return (
    ctx ?? {
      show: () => 0,
      dismiss: () => {},
    }
  );
}
