import "server-only";

import { getCurrentUser } from "@/lib/auth";
import { getCjShipping } from "@/lib/cj/catalog";

/**
 * GET /api/source/shipping?pid=…&sku=… — CJ's real shipping options to the
 * US for one unit of a CJ product (cheapest first), from CJ's freight
 * calculator; `sku` picks the variant quoted. Used by the Product Control
 * Center. Signed-in users only.
 */
export const dynamic = "force-dynamic";
// Three CJ calls spaced 1.1 s apart, behind any other queued CJ calls.
export const maxDuration = 30;

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const pid = params.get("pid")?.trim() ?? "";
  const sku = params.get("sku")?.trim() || null;
  if (!pid || pid.length > 100) return Response.json({ ok: false, error: "No CJ product given." }, { status: 400 });

  try {
    const result = await getCjShipping(pid, sku);
    if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: result.status });
    return Response.json({ ok: true, ...result.data });
  } catch (error) {
    console.error("[source] shipping quote failed:", error instanceof Error ? error.message : error);
    return Response.json({ ok: false, error: "Couldn't get CJ's shipping price. Try again in a moment." }, { status: 500 });
  }
}
