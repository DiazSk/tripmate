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

interface WikidataResponse {
  entities?: Record<
    string,
    { claims?: { P18?: { mainsnak?: { datavalue?: { value?: unknown } } }[] } }
  >;
}

/**
 * `Q869130` → a Commons image URL, or null.
 *
 * Cached at `TTL.STATIC`: the photograph a museum's Wikidata item points at is about as static as
 * anything this app fetches. `cached()` never writes a null, so a miss is re-asked rather than
 * remembered forever — which is the behaviour worth having while Wikidata is still being edited.
 */
export async function wikidataPhoto(qid: string): Promise<string | null> {
  // Re-checked here and not only at the tag reader: this value reaches a URL, and this function is
  // exported.
  if (!/^Q[1-9]\d*$/.test(qid)) return null;

  const found = await cached(`wdphoto:${qid}`, TTL.STATIC, async () => {
    const url = `${ENDPOINT}?action=wbgetentities&ids=${qid}&props=claims&format=json&origin=*`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      const data = (await res.json()) as WikidataResponse;
      const claim = data.entities?.[qid]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      if (typeof claim !== "string" || !claim) return null;
      // `Special:FilePath` takes the file's *name* and 302s to the real bytes on
      // upload.wikimedia.org, which is why the width is asked for here rather than guessed at:
      // the original is routinely several megabytes and this lands in a 336px card.
      return { url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(claim.replace(/ /g, "_"))}?width=640` };
    } catch {
      // A timeout or a network failure is a miss, not an error. The card simply has no photograph,
      // which is already its common case.
      return null;
    } finally {
      clearTimeout(timer);
    }
  });

  return found?.url ?? null;
}
