import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Archivo reaches the app through `next/font/google`, which self-hosts at build time and leaves
 * no readable file on disk — so the export's copy is committed under `public/fonts/`.
 *
 * Worth the ~30KB against ~420KB of photos: every tracking value in DESIGN.md (-0.078em display,
 * -0.06em node labels) was tuned for this face, and the transit-diagram rendition leans on that
 * tightness. A null return degrades to the system stack rather than failing the export.
 */
let cached: string | null | undefined;

export async function loadExportFont(): Promise<string | null> {
  if (cached !== undefined) return cached;
  try {
    const file = path.join(process.cwd(), "public", "fonts", "archivo-latin-var.woff2");
    cached = `data:font/woff2;base64,${(await readFile(file)).toString("base64")}`;
  } catch {
    cached = null;
  }
  return cached;
}
