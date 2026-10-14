"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';

// A time of day, picked the way the dates are: a trigger in the form's own field and a small panel
// of our own on <body>, rather than the system's spinner. Shown in 12-hour time with AM/PM; the value
// stays 'HH:MM' (24-hour) so nothing downstream has to parse a meridiem. '' means any time.
//
// Any minute is reachable: the grid steps in fives for the common case, and the readout at the top
// is a text box that takes an exact time ("12:07 pm", "1207p", "19:40").
type Period = 'AM' | 'PM';
const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = Array.from({
  length: 12
}, (_, i) => i * 5);
const pad = (n: number) => String(n).padStart(2, '0');
const split = (v: string) => {
  const [h, m] = v.split(':').map(Number);
  return {
    hour: h % 12 || 12,
    minute: m,
    period: (h < 12 ? 'AM' : 'PM') as Period
  };
};
const join = (hour: number, minute: number, period: Period) => `${pad(hour % 12 + (period === 'PM' ? 12 : 0))}:${pad(minute)}`;
export const time12 = (v: string) => {
  if (!v) return '';
  const t = split(v);
  return `${t.hour}:${pad(t.minute)} ${t.period}`;
};
/** What someone typed, as 'HH:MM', or null. No AM/PM and an hour of 1-12 keeps `fallback`'s. */
export function parseTime(text: string, fallback: Period = 'AM'): string | null {
  const m = text.trim().toLowerCase().match(/^(\d{1,2})(?:[:.\s]?(\d{2}))?\s*(a|p)?\.?\s*m?\.?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (min > 59) return null;
  if (m[3]) return h >= 1 && h <= 12 ? join(h, min, m[3] === 'p' ? 'PM' : 'AM') : null;
  if (h === 0 || h > 12) return h <= 23 ? `${pad(h)}:${pad(min)}` : null;
  return join(h, min, fallback);
}
const partOfDay = (v: string) => {
  const h = Number(v.slice(0, 2));
  return h < 5 ? 'at night' : h < 12 ? 'in the morning' : h < 17 ? 'in the afternoon' : h < 21 ? 'in the evening' : 'at night';
};
export function TimeField({
  label,
  verb,
  value,
  onChange
}: {
  label: string;
  /** How the note under the panel reads: "Lands", "Leaves". */
  verb: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = label.toLowerCase().replace(/\W+/g, '-');
  return <div className="tm-fb-field">
      <span id={`pp-${id}-label`}>{label}</span>
      <button ref={trigger} type="button" className={`tm-fb-input tm-fb-time${open ? ' is-open' : ''}`} aria-haspopup="dialog" aria-expanded={open} aria-labelledby={`pp-${id}-label pp-${id}-value`} onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M8 4.5V8l2.4 1.6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <span id={`pp-${id}-value`} className={value ? '' : 'tm-fb-placeholder'}>{value ? time12(value) : 'Any time'}</span>
      </button>
      {open && <TimePanel anchor={trigger} label={label} verb={verb} value={value} onChange={onChange} onClose={(refocus = true) => {
      setOpen(false);
      if (refocus) trigger.current?.focus();
    }} />}
    </div>;
}
function TimePanel({
  anchor,
  label,
  verb,
  value,
  onChange,
  onClose
}: {
  anchor: RefObject<HTMLButtonElement | null>;
  label: string;
  verb: string;
  value: string;
  onChange: (v: string) => void;
  onClose: (refocus?: boolean) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const typed = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [draft, setDraft] = useState(time12(value));
  const [bad, setBad] = useState(false);
  // A pick from the grids rewrites the text box (React's "adjust state when a prop changes").
  const [shownValue, setShownValue] = useState(value);
  if (shownValue !== value) {
    setShownValue(value);
    setDraft(time12(value));
    setBad(false);
  }
  // Nothing chosen yet: the first press of any part fills the rest from 9:00 AM.
  const t = value ? split(value) : {
    hour: 9,
    minute: 0,
    period: 'AM' as Period
  };
  const set = (p: Partial<typeof t>) => {
    const n = {
      ...t,
      ...p
    };
    onChange(join(n.hour, n.minute, n.period));
  };
  const commit = () => {
    if (!draft.trim()) return value && onChange('');
    const v = parseTime(draft, t.period);
    if (v) onChange(v);
    setBad(!v);
  };
  const WIDTH = 320;
  useLayoutEffect(() => {
    const place = () => {
      const el = anchor.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const h = panel.current?.offsetHeight ?? 360;
      const below = r.bottom + 10;
      const top = below + h <= window.innerHeight - 8 ? below : Math.max(8, r.top - h - 10);
      setPos({
        left: Math.min(Math.max(12, r.left), window.innerWidth - WIDTH - 12),
        top
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor]);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panel.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose(false);
    };
    document.addEventListener('pointerdown', down);
    return () => document.removeEventListener('pointerdown', down);
  }, [anchor, onClose]);
  useEffect(() => {
    typed.current?.focus();
    typed.current?.select();
  }, []);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    onClose();
  };
  const chosen = !!value;
  // Into a `.tm-layer` like the range calendar: above the navbar, outside any clipping ancestor,
  // and under a `.tm` so the panel reads the landing's tokens.
  return createPortal(<div className="tm tm-layer" data-appearance="light"><div ref={panel} role="dialog" aria-modal="false" aria-label={`Choose ${label.toLowerCase()}`} onKeyDown={onKey} className="drp tmp" style={{
    left: pos?.left ?? -9999,
    top: pos?.top ?? 0,
    width: WIDTH
  }}>
      <div className="tmp-top">
        <label className={`tmp-read${bad ? ' is-bad' : ''}`}>
          <span className="drp-edge-k">{label}</span>
          <input ref={typed} value={draft} placeholder="Type a time, like 12:05 PM" aria-invalid={bad} aria-describedby="tmp-note" onChange={e => {
          setDraft(e.target.value);
          setBad(false);
        }} onBlur={commit} onKeyDown={e => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          commit();
        }} />
        </label>
        <div className="tmp-period" role="group" aria-label="AM or PM">
          {(['AM', 'PM'] as Period[]).map(p => <button key={p} type="button" className="tmp-cell" aria-pressed={chosen && t.period === p} onClick={() => set({
          period: p
        })}>
              {p}
            </button>)}
        </div>
      </div>

      <p className="tmp-k" id="tmp-hour">Hour</p>
      <div className="tmp-grid" role="group" aria-labelledby="tmp-hour">
        {HOURS.map(h => <button key={h} type="button" className="tmp-cell" aria-pressed={chosen && t.hour === h} onClick={() => set({
        hour: h
      })}>
            {h}
          </button>)}
      </div>

      <p className="tmp-k" id="tmp-min">Minutes</p>
      <div className="tmp-grid" role="group" aria-labelledby="tmp-min">
        {MINUTES.map(m => <button key={m} type="button" className="tmp-cell" aria-pressed={chosen && t.minute === m} onClick={() => set({
        minute: m
      })}>
            :{pad(m)}
          </button>)}
      </div>

      <div className="drp-foot">
        <p className="drp-note" id="tmp-note" aria-live="polite">
          {bad ? 'Try a time like 12:05 PM' : chosen ? `${verb} ${partOfDay(value)}` : 'No set time'}
        </p>
        <button type="button" className="drp-clear" disabled={!chosen} onClick={() => onChange('')}>
          Clear
        </button>
        <button type="button" className="drp-done" onClick={() => onClose()}>
          Done
        </button>
      </div>
    </div></div>, document.body);
}