import { NextResponse } from "next/server";
import { listTraces } from "@/lib/db";

export async function GET() {
  const traces = listTraces().map((t) => ({
    id: t.id,
    type: t.type,
    status: t.status,
    model: t.model,
    durationMs: t.duration_ms,
    createdAt: t.created_at,
  }));
  return NextResponse.json({ traces });
}
