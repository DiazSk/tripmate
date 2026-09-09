import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The export's own copy of the app's two faces, inlined as data URIs.
 *
 * `next/font/local` reads these same files at build time and leaves nothing addressable at
 * runtime, so the export reads them off disk itself — which is also why they are committed under
 * `public/fonts/` rather than fetched.
 *
 * **Both faces, not one.** This file used to inline Archivo alone, the face the app dropped, and
 * kept its own nine-size five-weight ramp with a 900 in it. The export is the one artifact a
 * traveler keeps and forwards; it looking like a different product than the one that made it is
 * the worst place for that drift. Melodrama sets the destination the way it sets every heading in
 * the app, Switzer sets everything else, and the ramp below now uses the app's tracking steps.
 *
 * ~84KB of woff2 against ~420KB of photographs in the same file. Either face returning null
 * degrades that role to the system stack rather than failing the export.
 */
export type ExportFonts = { text: string | null; display: string | null };

let cached: ExportFonts | undefined;

async function inline(file: string): Promise<string | null> {
  try {
    const buf = await readFile(path.join(process.cwd(), "public", "fonts", file));
    return `data:font/woff2;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function loadExportFont(): Promise<ExportFonts> {
  if (cached !== undefined) return cached;
  const [text, display] = await Promise.all([
    inline("switzer-variable.woff2"),
    inline("melodrama-variable.woff2"),
  ]);
  cached = { text, display };
  return cached;
}
