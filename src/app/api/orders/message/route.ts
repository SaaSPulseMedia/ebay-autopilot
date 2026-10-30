import { getCurrentUser } from "@/lib/auth";
import { sendThankYouNow } from "@/lib/buyer-messages";

/** POST /api/orders/message { orderId } — "Send message": the seller's thank-you message to this buyer now (once per order). */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { orderId?: unknown } | null;
  const orderId = typeof body?.orderId === "string" ? body.orderId.trim() : "";
  if (!orderId) return Response.json({ ok: false, error: "No order given." }, { status: 400 });
  const sent = await sendThankYouNow(user.id, orderId);
  return Response.json(sent, { status: sent.ok ? 200 : 502 });
}
