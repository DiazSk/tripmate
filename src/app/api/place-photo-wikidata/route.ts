import { NextRequest, NextResponse } from "next/server";

import { wikidataPhoto } from "@/lib/placePhotos";

/**
 * `GET /api/place-photo-wikidata?qid=Q869130` → `{ url }`, or `{ url: null }`.
 *
 * A sibling of `/api/place-photo` rather than a branch inside it, because they answer different
 * questions: that one guesses a Wikipedia article from a *name* and is right for landmarks, this
 * one follows an id OpenStreetMap already gave us and is right for everything with a Wikidata item.
 * Merging them would mean one route with two lookup strategies and a name-or-id parameter, which is
 * two routes wearing a coat.
 *
 * **Always 200.** A miss is the ordinary outcome — most places have no photograph and that is a
 * fact about the world, not a failure — so it is `{ url: null }` and the card simply renders
 * without a frame. Only the server being unreachable is an error, and the client treats that the
 * same way.
 */
export async function GET(req: NextRequest) {
  const qid = req.nextUrl.searchParams.get("qid");
  if (!qid) return NextResponse.json({ error: "qid is required" }, { status: 400 });
  return NextResponse.json({ url: await wikidataPhoto(qid) });
}
