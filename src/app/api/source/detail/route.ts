import "server-only";

import { getCurrentUser } from "@/lib/auth";
import { getCjProductDetail } from "@/lib/cj/catalog";

/**
 * GET /api/source/detail?pid=<cj-pid> — one CJ product with all images and
 * variants, for the sourcing modal. The description comes back sanitized.
 * Signed-in users only.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });

  const pid = new URL(request.url).searchParams.get("pid")?.trim() ?? "";
  if (!pid || pid.length > 100) return Response.json({ ok: false, error: "Missing product id." }, { status: 400 });

  try {
    const result = await getCjProductDetail(pid);
    if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: result.status });
    return Response.json({ ok: true, product: result.data });
  } catch (error) {
    console.error("[source] detail failed:", error instanceof Error ? error.message : error);
    return Response.json({ ok: false, error: "Couldn't load this product. Try again in a moment." }, { status: 500 });
  }
}
