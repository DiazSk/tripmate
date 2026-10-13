import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { currentAccount } from "@/lib/ownerRequest";

/** The signed-in account for the phone's Profile and Trips, which have no server render to read it in. */
export async function GET() {
  const account = await currentAccount();
  if (!account) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json(account);
}

/** The welcome's name step, on both clients. Clerk owns the name; this is the one place it is written. */
export async function PATCH(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = ((await req.json().catch(() => null)) ?? {}) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 40) : "";
  if (!name) return NextResponse.json({ error: "Enter a name." }, { status: 400 });
  const client = await clerkClient();
  await client.users.updateUser(userId, { firstName: name });
  return NextResponse.json({ ok: true });
}
