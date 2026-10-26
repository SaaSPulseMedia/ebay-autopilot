import { syncCjOrders } from "@/lib/auto-fulfillment";
import { getCurrentUser } from "@/lib/auth";

/** POST /api/fulfillment/sync — "Check CJ now": status and tracking of the seller's open CJ orders. */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const records = await syncCjOrders(user.id);
  return Response.json({ ok: true, records });
}
