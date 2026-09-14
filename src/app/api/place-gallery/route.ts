import { NextRequest, NextResponse } from "next/server";
import { fetchSummary, resolveTitle } from "@/lib/wikiTitle";
import { commonsCategoryImages, commonsFileUrl, wikidataPlace } from "@/lib/placePhotos";
import { fetchPoiOsmTags } from "@/lib/poiDetails";

/**
 * Everything a place card can say about one stop, from free sources, in one request.
 *
 * **One route rather than four** because the panel opens on a tap and every extra round trip is a
 * skeleton the traveller watches. The four upstreams behind it — Overpass, Wikipedia, Wikidata,
 * Commons — are each independently cached (`fetchCache`), so a second visit to the same stop is a
 * few table reads.
 *
 * **The order the photographs come back in is the design.** `hero` is the *curated* image: the one
 * Wikipedia chose as the article's lead, or Wikidata's P18. `more` is a Commons category, which is
 * alphabetical and unranked. Category members are genuinely on-subject — that is what separates a
 * category from a geosearch, which returned four portraits of strangers for a Saint-Germain lunch
 * stop — but they are not *chosen*, so a category can open on a fountain in the garden or a
 * panorama of the next ridge. Putting the curated one in the mosaic's large tile means the picture
 * carrying the place's identity is never left to alphabetical order.
 *
 * **Every field is independently optional and the card is built for that.** Coverage measured on
 * 60 named Siena cafés: street 90%, phone 52%, hours 36%, website 14%; `wikidata` 0% on cafés
 * against 55% on museums, attractions and parks. So a museum fills this and a lunch stop returns
 * almost an empty object — which is a fact about the world, not a failure, and never a 500.
 */

/** The mosaic is one large tile and four small ones. */
const MAX_EXTRA_IMAGES = 4;
/**
 * How long Overpass gets before the card goes without an address.
 *
 * Measured: a stop that matches nothing took **36 seconds** to say so on the batch default, which
 * for a panel that opens on a tap is a skeleton nobody waits out. Address, phone and hours are the
 * least valuable third of this response — the photographs and the website come from Wikipedia,
 * Wikidata and Commons, which are fast and are not behind this.
 */
const OSM_BUDGET_MS = 6_000;

export interface PlaceGallery {
  hero: string | null;
  more: string[];
  extract: string | null;
  address: string | null;
  website: string | null;
  phone: string | null;
  openingHours: string | null;
  wheelchair: "yes" | "limited" | "no" | null;
}

const EMPTY: PlaceGallery = {
  hero: null,
  more: [],
  extract: null,
  address: null,
  website: null,
  phone: null,
  openingHours: null,
  wheelchair: null,
};

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name");
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });

  try {
    // Overpass and Wikipedia know nothing about each other and neither gates the other, so they go
    // out together. `fetchPoiOsmTags` takes a batch; a batch of one is the whole reuse.
    const [osm, title] = await Promise.all([
      Number.isFinite(lat) && Number.isFinite(lng)
        ? fetchPoiOsmTags([{ name, lat, lon: lng }], OSM_BUDGET_MS).catch(() => null)
        : Promise.resolve(null),
      resolveTitle(name).catch(() => null),
    ]);

    // The first value, not `osm[name]`: `fetchPoiOsmTags` keys its result by the **OSM** `name`
    // tag, which is the venue's own spelling — "Kunsthaus Zürich" for a stop the planner wrote as
    // "Kunsthaus Zurich (art museum, free galleries)". Looking it up by the name we asked with
    // misses every time the two differ, which is most of the time. A batch of one has one answer.
    const tags = Object.values(osm ?? {})[0];
    const summary = title ? await fetchSummary(title).catch(() => null) : null;

    // Same gate `/api/place-photo` applies, and for the same reason: `resolveTitle` asks whether
    // the article's title appears in the stop name, which is not the question "is this a place".
    // Without this, "Taxi to departure" matches the article *Taxi* and the card leads with a stock
    // photograph of a cab.
    const isPlace = !!summary?.coordinates;

    // OSM's tag first — it is about *this* venue, where the Wikipedia title is a guess that
    // survived a substring check.
    const qid = tags?.wikidataId ?? (isPlace ? summary?.wikibase_item : undefined);
    const wikidata = qid ? await wikidataPlace(qid).catch(() => null) : null;

    const category = tags?.commonsCategory ?? wikidata?.commonsCategory ?? null;
    const more = category
      ? await commonsCategoryImages(category, MAX_EXTRA_IMAGES + 1).catch(() => [])
      : [];

    const hero =
      (isPlace ? (summary?.originalimage?.source ?? summary?.thumbnail?.source) : null) ??
      (wikidata?.image ? commonsFileUrl(wikidata.image, 960) : null) ??
      // No curated image but a category with photographs in it: promote its first rather than
      // leave a mosaic with a hole where its subject should be.
      more[0] ??
      null;

    return NextResponse.json({
      ...EMPTY,
      hero,
      // Never repeat the hero in a small tile — when it was promoted out of the category, the
      // second member becomes the first small tile.
      more: more.filter((url) => url !== hero).slice(0, MAX_EXTRA_IMAGES),
      extract: summary?.extract ?? null,
      address: tags?.address ?? null,
      website: tags?.website ?? wikidata?.website ?? null,
      phone: tags?.phone ?? null,
      openingHours: tags?.openingHours ?? null,
      wheelchair: tags?.wheelchair ?? null,
    } satisfies PlaceGallery);
  } catch {
    // 200 with an empty dossier, not a 500. Every field here is already optional and the card
    // renders fine without any of them; an error status would only make the client invent a
    // failure state for something that looks identical to a place nobody has documented.
    return NextResponse.json(EMPTY);
  }
}
