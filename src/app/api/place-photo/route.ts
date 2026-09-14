import { NextRequest, NextResponse } from "next/server";
import { fetchSummary, resolveTitle } from "@/lib/wikiTitle";

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name");
  if (!name) {
    return NextResponse.json({ error: "Missing name" }, { status: 400 });
  }

  try {
    const title = await resolveTitle(name);
    if (!title) {
      // A genuine miss (no matching page) — 200 so the client caches it rather than retrying.
      return NextResponse.json({ thumbnailUrl: null, imageUrl: null, extract: null });
    }

    const data = await fetchSummary(title);
    /**
     * A photograph is only offered for an article about **somewhere on Earth**.
     *
     * `resolveTitle`'s containment check stops most nonsense, and it is not enough: it asks
     * whether the article's title appears in the stop name, so a stop called "Taxi to departure"
     * legitimately matches the article **Taxi** and came back with a stock photograph of a cab,
     * and "Galeries Lafayette" matched the retail chain and came back with its **logo**. Both
     * were being drawn as though they were the place. Measured across a 20-stop Paris trip, they
     * were 2 of the 5 apparent hits.
     *
     * `coordinates` is the cheap discriminator and it is exact on the cases that matter: the
     * concept articles (Taxi, Galeries Lafayette the chain) carry none, while Sainte-Chapelle,
     * the Louvre and Jardin du Luxembourg all do. It costs no extra request — the summary this
     * reads was already being fetched.
     *
     * The extract is kept either way. It is prose about whatever the traveller named, which is
     * useful even when the subject is not a location, and the generation loader reads it for
     * destination facts rather than for places.
     */
    const isPlace = !!data.coordinates;
    return NextResponse.json({
      thumbnailUrl: isPlace ? (data.thumbnail?.source ?? null) : null,
      imageUrl: isPlace ? (data.originalimage?.source ?? data.thumbnail?.source ?? null) : null,
      // The same summary response the photo comes from already carries a one-paragraph
      // description, so returning it costs nothing — this request was being made either way.
      // The generation loader uses its first sentence as a destination fact.
      extract: typeof data.extract === "string" ? data.extract : null,
    });
  } catch {
    // 503 (not a 200 with a null photo) so the client treats this as retryable and doesn't
    // cache a transient outage as "no photo exists".
    return NextResponse.json({ error: "Lookup failed" }, { status: 503 });
  }
}
