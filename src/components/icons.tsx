function IconBase({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      className={className ?? "h-4 w-4"}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function LodgingIcon({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path
        d="M3 15.5V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v3.5M3 15.5h14M3 15.5V12a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v3.5M7 8.5h5a2 2 0 0 1 2 2V11H7V8.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconBase>
  );
}

export function FoodIcon({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path
        d="M6 2.5v6a1.5 1.5 0 0 0 3 0v-6M7.5 2.5v15M4 2.5v4M14.5 2.5v15M14.5 2.5c1.5 0 2.5 1.5 2.5 4s-1 4-2.5 4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconBase>
  );
}

export function EntryIcon({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path
        d="M3 7.5a1.5 1.5 0 0 0 0-3V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v.5a1.5 1.5 0 0 0 0 3v1a1.5 1.5 0 0 0 0 3v.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-.5a1.5 1.5 0 0 0 0-3v-1Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M11 3v14" stroke="currentColor" strokeWidth="1.3" strokeDasharray="1.5 1.5" />
    </IconBase>
  );
}

export function TransitIcon({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path
        d="M3 12.5V6a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v6.5M3 12.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1M3 12.5v1a1 1 0 0 0 1 1M17 12.5v1a1 1 0 0 1-1 1M6 15.5v1M14 15.5v1M3 8.5h14"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconBase>
  );
}

export function PinIcon({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path
        d="M10 17.5s6-5.5 6-9.5a6 6 0 0 0-12 0c0 4 6 9.5 6 9.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="8" r="1.8" stroke="currentColor" strokeWidth="1.3" />
    </IconBase>
  );
}
