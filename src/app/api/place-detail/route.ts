import { NextRequest, NextResponse } from "next/server";
import { parseJsonResponse, runClaude } from "@/lib/claude";
import { buildPlaceDetailPrompt } from "@/lib/itineraryPrompt";
import { PlaceDetail } from "@/lib/types";

export async function POST(req: NextRequest) {
  const { name, destination, lat, lng } = await req.json();

  if (!name || !destination || typeof lat !== "number" || typeof lng !== "number") {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  try {
    const prompt = buildPlaceDetailPrompt({ name, destination, lat, lng });
    const raw = await runClaude(prompt);
    const detail = parseJsonResponse<PlaceDetail>(raw);
    return NextResponse.json({ detail });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load place detail" },
      { status: 500 }
    );
  }
}
