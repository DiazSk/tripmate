import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";
import { accountOwnerId, deleteAccountData } from "@/lib/db";
import { analyticsIdFor } from "@/lib/analytics/ids";
import { requestDeletion } from "@/lib/analytics/server";

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
  if (evt.type === "user.deleted" && evt.data.id) {
    // Read before the account row is deleted: it is the only thing that says which analytics id was theirs.
    const owner = accountOwnerId(evt.data.id);
    deleteAccountData(evt.data.id);
    const secret = process.env.ANALYTICS_ID_SECRET;
    // Fail-soft inside; the deletion of their data here has already happened and the webhook must still answer 200.
    if (owner && secret) await requestDeletion(analyticsIdFor(owner, secret));
  }
  return new Response("ok", { status: 200 });
}
