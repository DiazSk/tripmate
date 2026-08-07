import { NextRequest, NextResponse } from "next/server";
import { geocodeDestination } from "@/lib/weather";

export async function GET(req: NextRequest) {
  const destination = req.nextUrl.searchParams.get("destination");
  if (!destination) {
    return NextResponse.json({ error: "Missing destination" }, { status: 400 });
  }

  try {
    const geo = await geocodeDestination(destination);
    if (!geo) {
      return NextResponse.json({ error: "Couldn't find that destination" }, { status: 404 });
    }
    return NextResponse.json({ lat: geo.lat, lng: geo.lon, name: geo.name });
  } catch {
    return NextResponse.json({ error: "Geocoding failed" }, { status: 500 });
  }
}
