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
import { Check, CircleAlert, Clock, X } from "lucide-react";
import { formatWait, heldUntil, secondsLeft as secondsLeftNow, useHold } from "./actionHolds";
import type { Bucket } from "./ipThrottle";
import {
  autoDismissMs,
  currentCopy,
  formatClockTime,
  holdSentence,
  pushToast,
  WAIT,
  type Toast,
  type ToastCopy,
} from "./toastQueue";

/**
 * The toast stack: confirmations, and errors that don't block.
 *
 * **Success** — "Bar Luce added to Day 3" — is for an action that landed somewhere the traveller
 * cannot currently see, and fades after 3.2s. A state a row can show belongs on the row, and a
 * process still running is a spinner.
 *
 * **Error** is news that doesn't block: the traveller can carry on and the thing that failed is not
 * on screen (or is everywhere, like being offline). It stays until dismissed or resolved, carries at
 * most one action as text, and for a limit it counts down the hold and swaps to its `resolved` copy
 * when the wait ends. A failure that belongs to something on screen is `InlineNote`; one that blocks
 * is `ErrorDialog`.
 */

export type { Toast } from "./toastQueue";

export interface ErrorToast extends ToastCopy {
  action?: { label: string; onClick: () => void };
  /** Count down this bucket's hold. Call `holdFromFailure` first, or the toast resolves at once. A
   *  second hold toast for the same bucket replaces the first. */
  hold?: Bucket;
  resolved?: ToastCopy;
}

interface ToastContextValue {
  /** Show a success toast. Returns its id, so a caller that wants to replace its own can dismiss it. */
  show: (message: string, detail?: string) => number;
  /** Show an error toast. It stays until dismissed, or until its hold ends. */
  showError: (toast: ErrorToast) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

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

  const add = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = nextId.current++;
      const full = { ...toast, id };
      setToasts((current) => pushToast(current, full));
      const ms = autoDismissMs(full);
      if (ms !== null) timers.current.set(id, setTimeout(() => dismiss(id), ms));
      return id;
    },
    [dismiss]
  );

  const show = useCallback(
    (message: string, detail?: string) => add({ kind: "success", title: message, detail }),
    [add]
  );
  const showError = useCallback((toast: ErrorToast) => add({ kind: "error", ...toast }), [add]);

  // Every pending timer cleared on unmount. Without this a navigation away mid-toast leaves a
  // setState scheduled against a provider that no longer exists.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  const value = useMemo(() => ({ show, showError, dismiss }), [show, showError, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Polite, never assertive, and never focus-stealing: an error toast is news the traveller
          can read at the next pause, not an interruption. The region is always in the DOM — an
          element that appears at the same moment its text does is frequently missed by the
          live-region implementations, which watch for *changes* inside a region they already know
          about. Top centre under the navbar, clear of the trip page's search sheet and board. */}
      <div role="status" aria-live="polite" aria-atomic="false" className="toast-stack print:hidden">
        {toasts.map((toast) =>
          toast.kind === "success" ? (
            <div
              key={toast.id}
              className="glass-control pointer-events-auto flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 shadow-lg motion-safe:animate-[toast-in_180ms_ease-out]"
            >
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent">
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug text-foreground">{toast.title}</p>
                {toast.detail && <p className="mt-0.5 text-xs text-muted">{toast.detail}</p>}
              </div>
              <DismissButton onClick={() => dismiss(toast.id)} className="toast-x -mr-1 rounded-md p-1 text-muted hover:bg-white/10 hover:text-foreground" />
            </div>
          ) : toast.hold ? (
            <HoldToast key={toast.id} toast={toast} hold={toast.hold} dismiss={dismiss} />
          ) : (
            <ErrorToastView key={toast.id} toast={toast} copy={toast} dismiss={dismiss} />
          )
        )}
      </div>
    </ToastContext.Provider>
  );
}

function DismissButton({ onClick, className }: { onClick: () => void; className: string }) {
  return (
    <button type="button" onClick={onClick} aria-label="Dismiss" className={`shrink-0 transition-colors ${className}`}>
      <X className="h-3.5 w-3.5" />
    </button>
  );
}

function ErrorToastView({
  toast,
  copy,
  dismiss,
  wait,
}: {
  toast: Toast;
  copy: ToastCopy;
  dismiss: (id: number) => void;
  /** A hold toast still counting: the live wait, the end as a clock time, and how much is left. */
  wait?: { now: number; clockTime: string; progress: number };
}) {
  const { action } = toast;
  return (
    <div className={`toast-error${toast.hold ? " is-hold" : ""}`}>
      <span className="toast-error-glyph">
        {toast.hold ? <Clock aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
      </span>
      <div className="min-w-0">
        <p className="toast-error-title">{copy.title}</p>
        {copy.detail &&
          (wait ? (
            <p className="toast-error-detail">
              {/* The ticking countdown is for eyes only. A screen reader hears the sentence once,
                  with the end as a clock time (copy row P-37a), and again when it resolves. */}
              <span aria-hidden="true">
                {copy.detail.split(WAIT).map((part, i) => (
                  <span key={i}>
                    {i > 0 && <strong>{formatWait(wait.now)}</strong>}
                    {part}
                  </span>
                ))}
              </span>
              <span className="sr-only">{holdSentence(copy.detail, wait.clockTime)}</span>
            </p>
          ) : (
            <p className="toast-error-detail">{copy.detail}</p>
          ))}
        {toast.hold && (
          <div className="toast-error-bar" aria-hidden="true">
            <span style={{ transform: `scaleX(${wait?.progress ?? 0})` }} />
          </div>
        )}
      </div>
      {action && (
        <button
          type="button"
          className="err-btn err-btn-text toast-error-action"
          onClick={() => {
            dismiss(toast.id);
            action.onClick();
          }}
        >
          {action.label}
        </button>
      )}
      <DismissButton onClick={() => dismiss(toast.id)} className="toast-error-x" />
    </div>
  );
}

function HoldToast({ toast, hold, dismiss }: { toast: Toast; hold: Bucket; dismiss: (id: number) => void }) {
  const { secondsLeft } = useHold(hold);
  // Frozen at first render: the bar's full length, and the end time the screen reader is told.
  const [atShow] = useState(() => secondsLeftNow(hold) ?? 0);
  const [clockTime] = useState(() => formatClockTime(heldUntil(hold) ?? Date.now()));
  const copy = currentCopy(toast, secondsLeft);
  const done = copy === null;

  useEffect(() => {
    if (done) dismiss(toast.id);
  }, [done, dismiss, toast.id]);

  if (copy === null) return null;
  const wait =
    secondsLeft === null ? undefined : { now: secondsLeft, clockTime, progress: atShow > 0 ? secondsLeft / atShow : 0 };
  return <ErrorToastView toast={toast} copy={copy} dismiss={dismiss} wait={wait} />;
}

/**
 * Raise a toast.
 *
 * Returns a no-op outside the provider rather than throwing. A component rendered in a test, a
 * story or a print route should not fail to mount because its message has nowhere to go.
 */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  return (
    ctx ?? {
      show: () => 0,
      showError: () => 0,
      dismiss: () => {},
    }
  );
}
