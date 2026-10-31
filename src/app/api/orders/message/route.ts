import { getCurrentUser } from "@/lib/auth";
import { previewThankYou, sendThankYouNow } from "@/lib/buyer-messages";

/**
 * GET  /api/orders/message?orderId= — the thank-you message as this buyer would get it (a preview, nothing sent).
 * POST /api/orders/message { orderId, body? } — sends it (the checked or edited `body`), once per order.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const orderId = new URL(request.url).searchParams.get("orderId")?.trim() ?? "";
  if (!orderId) return Response.json({ ok: false, error: "No order given." }, { status: 400 });
  const preview = await previewThankYou(user.id, orderId);
  return Response.json(preview, { status: preview.ok ? 200 : 502 });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { orderId?: unknown; body?: unknown } | null;
  const orderId = typeof body?.orderId === "string" ? body.orderId.trim() : "";
  if (!orderId) return Response.json({ ok: false, error: "No order given." }, { status: 400 });
  const sent = await sendThankYouNow(user.id, orderId, typeof body?.body === "string" ? body.body : undefined);
  return Response.json(sent, { status: sent.ok ? 200 : 502 });
}
