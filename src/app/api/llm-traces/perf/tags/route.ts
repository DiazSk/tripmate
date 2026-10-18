import { NextResponse } from "next/server";
import { listBatchTags } from "@/lib/db";

export async function GET() {
  // Second lock: src/proxy.ts also 404s this, but a route must not depend on its proxy.
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ tags: listBatchTags() });
}
