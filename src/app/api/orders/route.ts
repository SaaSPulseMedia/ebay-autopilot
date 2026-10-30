import "server-only";

import { getCjOrderRecords } from "@/lib/auto-fulfillment";
import { getCurrentUser } from "@/lib/auth";
import { fetchEbayOrders } from "@/lib/ebay/orders";
import { matchSkusToCj } from "@/lib/order-fulfillment";

/**
 * GET /api/orders?show=awaiting|all — the signed-in seller's eBay orders
 * (last 90 days), each line matched to the CJ product to buy when possible.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });

  const awaitingOnly = new URL(request.url).searchParams.get("show") !== "all";
  const result = await fetchEbayOrders(user.id, { awaitingOnly });
  if (!result.ok) {
    return Response.json(result, { status: result.notConnected ? 404 : 502 });
  }

  let cj: Awaited<ReturnType<typeof matchSkusToCj>> = {};
  try {
    cj = await matchSkusToCj(
      user.id,
      result.orders.flatMap((order) => order.lines.map((line) => line.sku)),
    );
  } catch (error) {
    // Orders still show; only the CJ matches are missing.
    console.error("[orders] CJ matching failed:", error instanceof Error ? error.message : error);
  }
  // The CJ orders AutoPilot created for these eBay orders (status and tracking).
  const fulfillment: Record<string, { status: string; trackingNumber: string | null; sandbox: boolean; error: string | null; note: string | null; auto: boolean }> = {};
  try {
    for (const r of await getCjOrderRecords(user.id, result.orders.map((o) => o.orderId))) {
      fulfillment[r.ebayOrderId] = { status: r.status, trackingNumber: r.trackingNumber, sandbox: r.sandbox, error: r.error, note: r.note, auto: r.auto };
    }
  } catch (error) {
    console.error("[orders] CJ order records failed:", error instanceof Error ? error.message : error);
  }
  return Response.json({ ok: true, orders: result.orders, total: result.total, cj, fulfillment });
}
