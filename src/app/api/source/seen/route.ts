import "server-only";

import { getCurrentUser } from "@/lib/auth";
import { clearSeen, seenCount } from "@/lib/seen-products";

/**
 * The products "✨ Auto-Suggest Winners" has already shown the seller.
 *   GET    → { count }
 *   DELETE → forgets them all, so they can be suggested again.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  return Response.json({ ok: true, count: await seenCount(user.id) });
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  return Response.json({ ok: true, cleared: await clearSeen(user.id) });
}
