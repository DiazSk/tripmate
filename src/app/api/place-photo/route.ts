import { NextRequest, NextResponse } from "next/server";

const HEADERS = { "User-Agent": "TripMate/1.0 (personal project)" };

// Strip diacritics so romanization variants match (e.g. "Tenryū-ji" vs. "Tenryu-ji").
function foldDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

async function searchTitle(query: string): Promise<string | null> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
    query
  )}&format=json&srlimit=1`;
  const res = await fetch(url, { headers: HEADERS });
  // Upstream failure (commonly a rate limit) — throw rather than returning null, so the caller
  // can tell "lookup failed, retry later" apart from "this place genuinely has no photo".
  if (!res.ok) throw new Error(`wikipedia search ${res.status}`);
  const data = await res.json();
  return data.query?.search?.[0]?.title ?? null;
}

// Full-text search can surface an unrelated top hit for generic phrases (e.g. "Lunch
// at Kyoto Station area"). Only trust it when the resolved title is actually contained
// in the stop name — real landmark names pass this easily, unrelated matches don't.
function passesContainment(title: string, name: string): boolean {
  const bareTitle = foldDiacritics(title.replace(/\s*\([^)]*\)$/, "").toLowerCase());
  return foldDiacritics(name.toLowerCase()).includes(bareTitle);
}

// The model's stop names are often a real landmark plus marketing/descriptive suffixes
// ("Colosseum & Roman Forum (Skip-the-Line Tour)"), which as a single search query dilute
// Wikipedia's full-text ranking away from the landmark's own article. Retry with
// progressively stripped-down queries — cheap, since each extra request only fires when
// the previous one already missed — before giving up. Containment is always checked
// against the full original name, not the stripped candidate, so a match on a shortened
// query still counts.
function candidateQueries(name: string): string[] {
  const candidates = [name];
  const noParenthetical = name.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (noParenthetical !== name) candidates.push(noParenthetical);
  const beforeConjunction = noParenthetical.split(/\s+(?:&|and)\s+/i)[0].trim();
  if (beforeConjunction && beforeConjunction !== noParenthetical) candidates.push(beforeConjunction);
  return candidates;
}

async function resolveTitle(name: string): Promise<string | null> {
  for (const query of candidateQueries(name)) {
    const title = await searchTitle(query);
    if (title && passesContainment(title, name)) return title;
  }
  return null;
}

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

    const summaryRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { headers: HEADERS }
    );
    if (!summaryRes.ok) {
      throw new Error(`wikipedia summary ${summaryRes.status}`);
    }

    const data = await summaryRes.json();
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
