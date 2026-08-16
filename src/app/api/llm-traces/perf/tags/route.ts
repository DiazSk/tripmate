import { NextResponse } from "next/server";
import { listBatchTags } from "@/lib/db";

export async function GET() {
  return NextResponse.json({ tags: listBatchTags() });
}
