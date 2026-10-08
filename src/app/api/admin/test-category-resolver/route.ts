import { hasAdminToken } from "@/lib/admin-token";
import { getCurrentUser } from "@/lib/auth";
import { resolveCategory } from "@/lib/ebay/taxonomy";

/**
 * Admin diagnostic: runs resolveCategory for ?q=<product title>.
 * Needs the `x-admin-token: <CRON_SECRET>` header and a session cookie.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!hasAdminToken(request)) return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Not signed in" }, { status: 401 });

  const q = new URL(request.url).searchParams.get("q")?.trim();
  if (!q) return Response.json({ ok: false, error: "Missing q parameter." }, { status: 400 });

  return Response.json(await resolveCategory(user.id, q));
}
