import "server-only";

import { getCurrentUser } from "@/lib/auth";
import { importCjProduct } from "@/lib/cj/catalog";

/**
 * POST /api/source/import { pid } — copies a CJ product into catalog_products
 * (supplier "cj"). Importing the same pid again refreshes that row. Signed-in users only.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { pid?: unknown } | null;
  const pid = typeof body?.pid === "string" ? body.pid.trim() : "";
  if (!pid || pid.length > 100) return Response.json({ ok: false, error: "Missing product id." }, { status: 400 });

  try {
    const result = await importCjProduct(pid);
    if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: result.status });
    console.log(`[source] import pid=${pid} id=${result.data.id} created=${result.data.created}`);
    return Response.json({ ok: true, ...result.data });
  } catch (error) {
    console.error("[source] import failed:", error instanceof Error ? error.message : error);
    return Response.json({ ok: false, error: "Import failed. Try again in a moment." }, { status: 500 });
  }
}
