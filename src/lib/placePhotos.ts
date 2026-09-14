import { TTL, cached } from "./fetchCache";

/**
 * A photograph for a place that OpenStreetMap has tagged with a Wikidata item.
 *
 * **This exists because the photo route the app already has cannot serve most places.**
 * `/api/place-photo` resolves a Wikipedia *article title* from a name, and `passesContainment`
 * requires that title to be a substring of the name — which is right for landmarks and hopeless for
 * everything else. Measured against the live route: 2 of 8 Siena names resolved, and **0 of 4
 * museums**, even though 55% of museums, attractions and parks near Siena carry a `wikidata` tag.
 *
 * A Q-id skips the guessing entirely. `wbgetentities` returns the item's P18 claim — its image, on
 * Wikimedia Commons — and needs no key. Measured: 4 of 6 tested Q-ids had one.
 *
 * What this does **not** do is find a photograph of a café. Measured across 60 named Siena cafés:
 * `wikidata` 0%, `wikimedia_commons` 0%, `image` 1%. There is no free source, and the card is built
 * to look finished without one rather than to reserve a hole for one that never arrives.
 */

/** Wikidata accepts up to 50 pipe-separated ids in one call. Not batched today — a card asks for
 *  one place at a time — but the cap is why batching is the upgrade path rather than a rewrite. */
const ENDPOINT = "https://www.wikidata.org/w/api.php";
const TIMEOUT_MS = 8_000;

type Claim = { mainsnak?: { datavalue?: { value?: unknown } } };

interface WikidataResponse {
  entities?: Record<string, { claims?: Record<string, Claim[] | undefined> }>;
}

/** What one Wikidata item is worth to a place card. All three come off the *same* response —
 *  `props=claims` returns the whole claim set and this module used to read one string out of it. */
export interface WikidataPlace {
  /** P18, the item's image, as a Commons file name. */
  image: string | null;
  /** P373, the item's Commons *category* — the only free route to more than one photograph, and
   *  unlike a geosearch it is curated to the subject. Verified: `Category:Kunsthaus Zürich`
   *  returns exterior shots, the outdoor staircase and the garden-café fountain. */
  commonsCategory: string | null;
  /** P856, the official website. */
  website: string | null;
}

function claimString(claims: Record<string, Claim[] | undefined> | undefined, property: string) {
  const value = claims?.[property]?.[0]?.mainsnak?.datavalue?.value;
  return typeof value === "string" && value ? value : null;
}

/** `Special:FilePath` takes the file's *name* and 302s to the real bytes on upload.wikimedia.org,
 *  which is why the width is asked for here rather than guessed at: the original is routinely
 *  several megabytes and this lands in a card. */
export function commonsFileUrl(fileName: string, width: number): string {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName.replace(/ /g, "_"))}?width=${width}`;
}

/**
 * Everything one Q-id can tell a place card, in one cached request.
 *
 * Cached at `TTL.STATIC`: a museum's image, Commons category and official site are about as static
 * as anything this app fetches. `cached()` never writes a null, so a total miss is re-asked rather
 * than remembered forever — the behaviour worth having while Wikidata is still being edited.
 */
export async function wikidataPlace(qid: string): Promise<WikidataPlace | null> {
  // Re-checked here and not only at the tag reader: this value reaches a URL, and this is exported.
  if (!/^Q[1-9]\d*$/.test(qid)) return null;

  return cached(`wdplace:${qid}`, TTL.STATIC, async () => {
    const url = `${ENDPOINT}?action=wbgetentities&ids=${qid}&props=claims&format=json&origin=*`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      const data = (await res.json()) as WikidataResponse;
      const claims = data.entities?.[qid]?.claims;
      const place: WikidataPlace = {
        image: claimString(claims, "P18"),
        commonsCategory: claimString(claims, "P373"),
        website: claimString(claims, "P856"),
      };
      // Nothing useful is a miss, not a row worth keeping.
      return place.image || place.commonsCategory || place.website ? place : null;
    } catch {
      // A timeout or a network failure is a miss, not an error. The card simply has no photograph,
      // which is already its common case.
      return null;
    } finally {
      clearTimeout(timer);
    }
  });
}

/**
 * `Q869130` → a Commons image URL, or null.
 *
 * A wrapper over `wikidataPlace` since that call already carries P18 — kept as its own export
 * because `/api/place-photo-wikidata` and `SearchPinCard` want exactly one URL and nothing else.
 */
export async function wikidataPhoto(qid: string): Promise<string | null> {
  const place = await wikidataPlace(qid);
  return place?.image ? commonsFileUrl(place.image, 640) : null;
}

/** Enough to fill the mosaic's four small tiles after junk is dropped, without asking Commons for
 *  a category's whole contents — some run to hundreds of files. */
const CATEGORY_FETCH_LIMIT = 24;
/** Below this, a file is a logo, an icon or a map thumbnail rather than a photograph. */
const MIN_PHOTO_WIDTH = 800;

interface CommonsResponse {
  query?: {
    pages?: Record<
      string,
      { title?: string; imageinfo?: { thumburl?: string; url?: string; width?: number }[] }
    >;
  };
}

/**
 * Photographs from a Commons category, as thumbnail URLs.
 *
 * **A category is curated to its subject; a geosearch is not.** That distinction is the whole
 * reason this exists. Commons geosearch at a stop's coordinates was tried and returns whatever
 * happened to be photographed nearby — for a Saint-Germain lunch stop, four portraits of
 * strangers. `Category:Kunsthaus Zürich` returns the building.
 *
 * It is still not an edit: members come back in **alphabetical order** with no quality signal, so
 * `Category:Kunsthaus Zürich` includes a portrait of a person and `Category:Uetliberg` includes
 * ridge panoramas. Hence the filter below, and hence the rule at the call site that the *hero*
 * tile is always the curated P18 image and only the small tiles come from here.
 */
export async function commonsCategoryImages(category: string, limit: number): Promise<string[]> {
  const title = category.startsWith("Category:") ? category : `Category:${category}`;
  // OSM's `wikimedia_commons` tag legitimately holds a `File:` or a gallery page as well.
  if (!/^Category:.+/.test(title)) return [];

  const found = await cached(`commonscat:${title}`, TTL.STATIC, async () => {
    const url =
      "https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*" +
      `&generator=categorymembers&gcmtitle=${encodeURIComponent(title)}&gcmtype=file` +
      `&gcmlimit=${CATEGORY_FETCH_LIMIT}&prop=imageinfo&iiprop=url|size&iiurlwidth=640`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      const data = (await res.json()) as CommonsResponse;
      const urls = Object.values(data.query?.pages ?? {})
        // JPEG only, and big enough to be a photograph: that is what drops `Commons-logo.svg`,
        // the PNG locator maps and the icon sprites a category picks up.
        .filter((page) => /\.jpe?g$/i.test(page.title ?? ""))
        .map((page) => page.imageinfo?.[0])
        .filter((info) => info?.thumburl && (info.width ?? 0) >= MIN_PHOTO_WIDTH)
        .map((info) => info!.thumburl!);
      return urls.length > 0 ? { urls } : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  });

  return (found?.urls ?? []).slice(0, limit);
}
