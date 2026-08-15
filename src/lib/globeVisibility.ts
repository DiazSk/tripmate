/** Routes with nothing to show through the globe at all — fully opaque, never draggable, no map
 *  chrome to control. Shared between `GlobeBackground` (skips booting Cesium entirely here) and
 *  `MapControls` (skips its own independent `import("cesium")`, so no part of the map stack loads
 *  the ~multi-MB Cesium bundle on these routes). */
export const GLOBE_HIDDEN_PATH_PREFIXES = ["/backend"];

export function isGlobeHiddenRoute(pathname: string | null): boolean {
  return GLOBE_HIDDEN_PATH_PREFIXES.some((prefix) => pathname?.startsWith(prefix));
}
