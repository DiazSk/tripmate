import { NextRequest, NextResponse } from "next/server";
import { fetchMajorHighways } from "@/lib/roads";
import { throttle } from "@/lib/ipThrottle";
import { limitResponse } from "@/lib/limitResponse";

export async function GET(req: NextRequest) {
  const limit = throttle(req, "lookup");
  if (limit.limited) return limitResponse(limit, "lookup");
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
  }

  try {
    const segments = await fetchMajorHighways(lat, lng);
    return NextResponse.json({ segments });
  } catch {
    return NextResponse.json({ error: "Failed to load highways" }, { status: 502 });
  }
}
