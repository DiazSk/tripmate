export const DEV_NAME_ATTR = "data-dev-name";

/**
 * Spread onto any element to tag it with a name for the dev hover-inspector
 * (`DevInspectorOverlay`, mounted once in AppShell) — e.g.
 * `<div {...devLabel("ItineraryCard")}>`. A no-op object outside development, so the attribute
 * never ships to production markup.
 */
export function devLabel(name: string): Record<string, string> {
  if (process.env.NODE_ENV !== "development") return {};
  return { [DEV_NAME_ATTR]: name };
}
