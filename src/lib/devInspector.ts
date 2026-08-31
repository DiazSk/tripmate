export const DEV_NAME_ATTR = "data-dev-name";

/**
 * Spread onto any element to name it in the DOM — `<div {...devLabel("ItineraryCard")}>` — so a
 * devtools inspection or a browser-automation probe can say which component owns a given box.
 * A no-op object outside development, so the attribute never ships to production markup.
 *
 * There *was* a hover badge under the wordmark that read these back and named whatever the pointer
 * was over (`DevInspectorOverlay`). It is gone: that corner now carries the Map/Satellite toggle,
 * which is worth more than a debugging aid on a surface whose whole argument is the imagery. The
 * attributes stay because they cost nothing in production and are still the fastest way to find a
 * component from a rendered pixel.
 */
export function devLabel(name: string): Record<string, string> {
  if (process.env.NODE_ENV !== "development") return {};
  return { [DEV_NAME_ATTR]: name };
}
