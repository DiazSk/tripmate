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
    return NextResponse.json({
      thumbnailUrl: data.thumbnail?.source ?? null,
      imageUrl: data.originalimage?.source ?? data.thumbnail?.source ?? null,
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
