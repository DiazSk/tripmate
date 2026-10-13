import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";
import { deleteAccountData } from "@/lib/db";

/**
 * Clerk → us. Only `user.deleted` is acted on: deleting a user in the Clerk dashboard deletes
 * everything they own here (`deleteAccountData`). Verified with `CLERK_WEBHOOK_SIGNING_SECRET`;
 * an unverifiable request gets 400, and anything that is not a 2xx is retried by Clerk.
 */
export async function POST(req: NextRequest) {
  let evt;
  try {
    evt = await verifyWebhook(req);
  } catch {
    return new Response("Error verifying webhook", { status: 400 });
  }
  if (evt.type === "user.deleted" && evt.data.id) deleteAccountData(evt.data.id);
  return new Response("ok", { status: 200 });
}
