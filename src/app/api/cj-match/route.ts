import { getCurrentUser } from "@/lib/auth";
import { findOnCj } from "@/lib/cj-match";
import { getListingDefaults } from "@/lib/seller-settings";

/**
 * POST /api/cj-match { title, total? } — "Find on CJ" on the Price check page:
 * CJ products matching an eBay listing's title, with CJ's real shipping,
 * delivery time and the profit at the listing's current eBay total.
 */
export const dynamic = "force-dynamic";
// Up to 4 CJ search calls plus 3 × 3 shipping calls, ~1.1 s apart.
export const maxDuration = 60;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { title?: unknown; total?: unknown } | null;
  const title = typeof body?.title === "string" ? body.title.trim().slice(0, 200) : "";
  if (!title) return Response.json({ ok: false, error: "No title to search for." }, { status: 400 });
  const total = typeof body?.total === "number" && Number.isFinite(body.total) && body.total > 0 ? body.total : null;
  const { adRatePct } = await getListingDefaults(user.id);
  const result = await findOnCj(user.id, title, total, adRatePct);
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
