import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { ebayAccounts } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { listBusinessPolicies } from "@/lib/ebay/account";

/**
 * POST /api/ebay/policies/select { fulfillmentPolicyId, paymentPolicyId, returnPolicyId }
 * Saves which eBay business policies AutoPilot puts on new offers. Each ID
 * must be one of the seller's own policies; null clears that choice.
 */
export const dynamic = "force-dynamic";

type Body = { fulfillmentPolicyId?: unknown; paymentPolicyId?: unknown; returnPolicyId?: unknown };

const asId = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body || typeof body !== "object") return Response.json({ ok: false, error: "Body must be JSON." }, { status: 400 });
  const choice = {
    fulfillmentPolicyId: asId(body.fulfillmentPolicyId),
    paymentPolicyId: asId(body.paymentPolicyId),
    returnPolicyId: asId(body.returnPolicyId),
  };

  try {
    const lists = await listBusinessPolicies(user.id);
    if (!lists.ok) return Response.json({ ok: false, error: lists.error }, { status: lists.notConnected ? 404 : 502 });
    const owns = (list: { id: string }[], id: string | null) => id === null || list.some((p) => p.id === id);
    if (
      !owns(lists.fulfillment, choice.fulfillmentPolicyId) ||
      !owns(lists.payment, choice.paymentPolicyId) ||
      !owns(lists.returns, choice.returnPolicyId)
    ) {
      return Response.json({ ok: false, error: "That policy isn't one of your eBay policies. Reload and try again." }, { status: 400 });
    }

    const updated = await db
      .update(ebayAccounts)
      .set(choice)
      .where(and(eq(ebayAccounts.userId, user.id), eq(ebayAccounts.mode, "oauth")))
      .returning({ id: ebayAccounts.id });
    if (!updated.length) return Response.json({ ok: false, error: "No eBay store connected." }, { status: 404 });

    console.log(`[ebay-policies] user ${user.id} selected policies ${JSON.stringify(choice)}`);
    return Response.json({ ok: true, ...choice });
  } catch (error) {
    console.error("[ebay-policies] save failed:", error instanceof Error ? error.message : error);
    return Response.json({ ok: false, error: "Couldn't save your policy choice." }, { status: 500 });
  }
}
