import "server-only";

import { getCurrentUser } from "@/lib/auth";
import { getSavedPolicyIds, listBusinessPolicies } from "@/lib/ebay/account";

/**
 * GET /api/ebay/policies — the seller's eBay shipping, payment and return
 * policies (EBAY_US), plus the ones they saved for AutoPilot (null = not picked).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });

  try {
    const [lists, selected] = await Promise.all([listBusinessPolicies(user.id), getSavedPolicyIds(user.id)]);
    if (!lists.ok) return Response.json({ ok: false, error: lists.error }, { status: lists.notConnected ? 404 : 502 });
    const { fulfillment, payment, returns } = lists;
    return Response.json({ ok: true, fulfillment, payment, returns, selected });
  } catch (error) {
    console.error("[ebay-policies] list failed:", error instanceof Error ? error.message : error);
    return Response.json({ ok: false, error: "Couldn't load your eBay policies." }, { status: 500 });
  }
}
