import { NextRequest, NextResponse } from "next/server";

const HEADERS = { "User-Agent": "TripMate/1.0 (personal project)" };

// Strip diacritics so romanization variants match (e.g. "Tenryū-ji" vs. "Tenryu-ji").
function foldDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

async function resolveTitle(name: string): Promise<string | null> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
    name
  )}&format=json&srlimit=1`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return null;
  const data = await res.json();
  const title: string | undefined = data.query?.search?.[0]?.title;
  if (!title) return null;

  // Full-text search can surface an unrelated top hit for generic phrases (e.g. "Lunch
  // at Kyoto Station area"). Only trust it when the resolved title is actually contained
  // in the stop name — real landmark names pass this easily, unrelated matches don't.
  const bareTitle = foldDiacritics(title.replace(/\s*\([^)]*\)$/, "").toLowerCase());
  if (!foldDiacritics(name.toLowerCase()).includes(bareTitle)) return null;

  return title;
}

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name");
  if (!name) {
    return NextResponse.json({ error: "Missing name" }, { status: 400 });
  }

  try {
    const title = await resolveTitle(name);
    if (!title) {
      return NextResponse.json({ thumbnailUrl: null });
    }

    const summaryRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { headers: HEADERS }
    );
    if (!summaryRes.ok) {
      return NextResponse.json({ thumbnailUrl: null });
    }

    const data = await summaryRes.json();
    return NextResponse.json({ thumbnailUrl: data.thumbnail?.source ?? null });
  } catch {
    return NextResponse.json({ thumbnailUrl: null });
  }
}
