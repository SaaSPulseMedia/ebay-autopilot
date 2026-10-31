import { getCurrentUser } from "@/lib/auth";
import { sendThankYouNow } from "@/lib/buyer-messages";
import { fetchEbayOrder, markEbayShipped } from "@/lib/ebay/orders";

/**
 * POST /api/orders/ship { orderId, trackingNumber, carrier, sendMessage? } —
 * "Mark shipped" for an order fulfilled outside AutoPilot (e.g. AliExpress):
 * puts the tracking number on the eBay order, which marks it shipped, and
 * optionally sends the seller's thank-you message.
 */
export const dynamic = "force-dynamic";

const CARRIERS = new Set(["USPS", "UPS", "FedEx", "DHL", "Other"]);

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const orderId = typeof body?.orderId === "string" ? body.orderId.trim() : "";
  const trackingNumber = typeof body?.trackingNumber === "string" ? body.trackingNumber.replace(/\s+/g, "").slice(0, 60) : "";
  const carrier = typeof body?.carrier === "string" && CARRIERS.has(body.carrier) ? body.carrier : "";
  if (!orderId || !trackingNumber || !carrier) {
    return Response.json({ ok: false, error: "Enter the tracking number and choose the carrier." }, { status: 400 });
  }

  const order = await fetchEbayOrder(user.id, orderId);
  if (!order) return Response.json({ ok: false, error: "eBay didn't return this order. Refresh and try again." }, { status: 404 });
  if (order.fulfillmentStatus === "FULFILLED") return Response.json({ ok: false, error: "eBay already has this order as shipped." }, { status: 409 });
  const shipped = await markEbayShipped(user.id, orderId, {
    lineItems: order.lines.map((line) => ({ lineItemId: line.lineItemId, quantity: line.quantity })),
    trackingNumber,
    carrier,
  });
  if (!shipped.ok) return Response.json({ ok: false, error: `eBay didn't take it: ${shipped.error}` }, { status: 502 });

  const message =
    body?.sendMessage === true
      ? await sendThankYouNow(user.id, orderId, typeof body?.messageBody === "string" ? body.messageBody : undefined)
      : null;
  return Response.json({ ok: true, messageSent: message?.ok ?? false, messageError: message && !message.ok ? message.error : null });
}
