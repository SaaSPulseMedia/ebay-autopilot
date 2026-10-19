import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { catalogProducts } from "@/db/schema";
import { hasAdminToken } from "@/lib/admin-token";
import { importCjProduct } from "@/lib/cj/catalog";

/**
 * POST /api/admin/refresh-all-cj-products — re-imports every CJ product in
 * catalog_products (source = 'cj') with the same logic as /api/source/import,
 * so old imports pick up all images, variants and product facts. Each row is
 * refreshed in place for the seller who owns it.
 *
 * CJ calls are queued at least 1.1 s apart (see src/lib/cj/catalog.ts), which
 * is the delay between imports. A run stops starting new imports after
 * TIME_BUDGET_MS so it finishes inside the function limit; when products are
 * left, the response has `nextOffset` — call again with ?offset=<nextOffset>.
 * Needs `x-admin-token: <CRON_SECRET>`.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TIME_BUDGET_MS = 50_000;

export async function POST(request: Request) {
  if (!hasAdminToken(request)) return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const offset = Math.max(0, Math.floor(Number(new URL(request.url).searchParams.get("offset")) || 0));
  const started = Date.now();

  try {
    const rows = await db
      .select({ externalId: catalogProducts.externalId, userId: catalogProducts.userId })
      .from(catalogProducts)
      .where(eq(catalogProducts.source, "cj"))
      .orderBy(asc(catalogProducts.id));

    let refreshed = 0;
    const errors: Array<{ externalId: string; error: string }> = [];
    let index = offset;
    for (; index < rows.length; index += 1) {
      if (Date.now() - started > TIME_BUDGET_MS) break;
      const { externalId, userId } = rows[index];
      const pid = externalId.replace(/^cj-/, "");
      try {
        const result = await importCjProduct(pid, userId);
        if (result.ok) refreshed += 1;
        else errors.push({ externalId, error: result.error });
      } catch (error) {
        errors.push({ externalId, error: error instanceof Error ? error.message : "Import failed." });
      }
    }

    const done = index >= rows.length;
    console.log(`[admin] refresh-all-cj-products offset=${offset} refreshed=${refreshed} failed=${errors.length} done=${done}`);
    return Response.json({
      ok: true,
      total: rows.length,
      refreshed,
      failed: errors.length,
      errors,
      ...(done ? {} : { nextOffset: index, remaining: rows.length - index }),
    });
  } catch (error) {
    console.error("[admin] refresh-all-cj-products failed:", error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Refresh failed." }, { status: 500 });
  }
}
