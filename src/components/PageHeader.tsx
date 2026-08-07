import Link from "next/link";

export default function PageHeader({
  title,
  navLabel,
  navHref,
  variant = "light",
  isDark = true,
}: {
  title: string;
  navLabel: string;
  navHref: string;
  /** "adaptive" is for headers floating over live imagery (e.g. the home
   *  page's Cesium globe) where no single text color reads well everywhere. */
  variant?: "light" | "adaptive";
  /** Only consulted when variant="adaptive" — whatever's directly behind the
   *  header right now, light or dark. */
  isDark?: boolean;
}) {
  if (variant === "light") {
    return (
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">{title}</h1>
        <div className="flex items-center gap-4">
          <Link
            href={navHref}
            className="text-sm font-medium text-orange-700 transition-colors hover:text-orange-800"
          >
            {navLabel}
          </Link>
        </div>
      </div>
    );
  }

  const content = (
    <div className="flex items-center justify-between">
      <h1
        className={`text-2xl font-bold tracking-tight ${isDark ? "text-white" : "text-slate-900"}`}
        style={isDark ? { textShadow: "0 2px 10px rgba(0,0,0,0.5)" } : undefined}
      >
        {title}
      </h1>
      <div className="flex items-center gap-4">
        <Link
          href={navHref}
          className={`text-sm font-medium transition-colors ${
            isDark ? "text-orange-300 hover:text-orange-200" : "text-orange-700 hover:text-orange-800"
          }`}
        >
          {navLabel}
        </Link>
      </div>
    </div>
  );

  if (isDark) return content;

  // Light background beneath (e.g. bright terrain): dark text needs a scrim
  // to stay readable, since there's no shadow trick that works both ways.
  return (
    <div className="rounded-full border border-white/40 bg-white/70 px-5 py-2.5 shadow-lg backdrop-blur-md">
      {content}
    </div>
  );
}
