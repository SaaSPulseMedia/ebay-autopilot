import "server-only";

import { getCurrentUser } from "@/lib/auth";
import { findNiche } from "@/lib/niches";
import { clearSeen, dismissProduct, seenCount } from "@/lib/seen-products";

/**
 * The products "✨ Auto-Suggest Winners" has already shown the seller.
 *   GET    → { count }
 *   POST   { pid, niche? } → dismisses a product: it never shows on the
 *            Winning page (feed or Auto-Suggest) again
 *   DELETE → forgets the shown ones, so they can be suggested again
 *            (dismissed products stay hidden).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  return Response.json({ ok: true, count: await seenCount(user.id) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { pid?: unknown; niche?: unknown } | null;
  const pid = typeof body?.pid === "string" ? body.pid.trim() : "";
  if (!pid || pid.length > 100) return Response.json({ ok: false, error: "No product given." }, { status: 400 });
  const niche = typeof body?.niche === "string" ? (findNiche(body.niche)?.name ?? "") : "";
  await dismissProduct(user.id, pid, niche);
  return Response.json({ ok: true });
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  return Response.json({ ok: true, cleared: await clearSeen(user.id) });
}
