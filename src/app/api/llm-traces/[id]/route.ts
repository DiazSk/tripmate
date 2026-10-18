import { NextRequest, NextResponse } from "next/server";
import { getTrace } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Second lock: src/proxy.ts also 404s this, but a route must not depend on its proxy.
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { id } = await params;
  const trace = getTrace(id);
  if (!trace) {
    return NextResponse.json({ error: "Trace not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: trace.id,
    type: trace.type,
    status: trace.status,
    model: trace.model,
    durationMs: trace.duration_ms,
    createdAt: trace.created_at,
    prompt: trace.prompt,
    rawResponse: trace.raw_response,
    errorMessage: trace.error_message,
  });
}
