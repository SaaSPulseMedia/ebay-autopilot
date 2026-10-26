import { placeCjOrder, prepareCjOrder } from "@/lib/auto-fulfillment";
import { getCurrentUser } from "@/lib/auth";

/**
 * GET  /api/fulfillment?orderId=… — what "Order on CJ" needs for one eBay
 *      order: its lines matched to CJ variants, CJ's shipping methods, and the
 *      CJ order already created for it, if any.
 * POST /api/fulfillment { ebayOrderId, skus, logisticName, fromCountryCode, sandbox }
 *      — creates the CJ order (unpaid: the seller pays it in CJ).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const orderId = new URL(request.url).searchParams.get("orderId")?.trim() ?? "";
  if (!orderId) return Response.json({ ok: false, error: "Which order?" }, { status: 400 });
  const prepared = await prepareCjOrder(user.id, orderId);
  if (!prepared.ok) return Response.json(prepared, { status: 502 });
  const { lines, shipping, shippingError, record } = prepared.data;
  return Response.json({ ok: true, lines, shipping, shippingError, record });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const skus: Record<string, string> = {};
  if (body?.skus && typeof body.skus === "object") {
    for (const [lineItemId, sku] of Object.entries(body.skus as Record<string, unknown>)) if (text(sku)) skus[lineItemId] = text(sku);
  }
  const input = {
    ebayOrderId: text(body?.ebayOrderId),
    skus,
    logisticName: text(body?.logisticName),
    fromCountryCode: text(body?.fromCountryCode).toUpperCase(),
    sandbox: body?.sandbox === true,
  };
  if (!input.ebayOrderId || !input.logisticName || !input.fromCountryCode) {
    return Response.json({ ok: false, error: "Pick a shipping method first." }, { status: 400 });
  }
  const result = await placeCjOrder(user.id, input);
  return Response.json(result, { status: result.ok ? 200 : 422 });
}
