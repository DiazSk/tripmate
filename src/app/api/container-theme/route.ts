import { NextRequest, NextResponse } from "next/server";
import { runClaude, parseJsonResponse } from "@/lib/claude";
import { buildContainerThemePrompt } from "@/lib/containerThemePrompt";
import {
  CONTAINER_TYPES,
  LID_TYPES,
  ContainerTheme,
  DEFAULT_CONTAINER_THEME,
} from "@/lib/types";

function isContainerTheme(value: unknown): value is ContainerTheme {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.themeTitle === "string" &&
    typeof v.primaryColor === "string" &&
    /^#[0-9a-fA-F]{3,6}$/.test(v.primaryColor) &&
    typeof v.stampOrIcon === "string" &&
    (CONTAINER_TYPES as readonly string[]).includes(v.containerType as string) &&
    (LID_TYPES as readonly string[]).includes(v.lidType as string)
  );
}

// Decorative only — this powers the unboxing container's look, never the
// itinerary itself, so any failure (timeout, malformed JSON, empty
// destination) just falls back to the default theme instead of erroring out.
export async function GET(req: NextRequest) {
  const destination = req.nextUrl.searchParams.get("destination")?.trim();
  if (!destination) {
    return NextResponse.json({ theme: DEFAULT_CONTAINER_THEME });
  }

  try {
    const prompt = buildContainerThemePrompt(destination);
    const { result: raw } = await runClaude(prompt, "container-theme");
    const parsed = parseJsonResponse<unknown>(raw);
    if (isContainerTheme(parsed)) {
      return NextResponse.json({ theme: parsed });
    }
    return NextResponse.json({ theme: DEFAULT_CONTAINER_THEME });
  } catch {
    return NextResponse.json({ theme: DEFAULT_CONTAINER_THEME });
  }
}
