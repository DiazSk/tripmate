import { NextRequest, NextResponse } from "next/server";
import { fetchReadyTrips } from "@/lib/readyTrips";
import { throttle } from "@/lib/ipThrottle";
import { limitResponse } from "@/lib/limitResponse";

/**
 * The ready-made trip catalogue for Home. `available: false` is "the catalogue could not be read"
 * (no `SANITY_API_READ_TOKEN`, or Sanity unreachable), distinct from `available: true` with no trips;
 * the client says the first as "can't load ideas right now" and never as "there are none".
 */
export async function GET(req: NextRequest) {
  const limit = throttle(req, "lookup");
  if (limit.limited) return limitResponse(limit, "lookup");
  const trips = await fetchReadyTrips();
  return NextResponse.json(trips === null ? { available: false, trips: [] } : { available: true, trips });
}
