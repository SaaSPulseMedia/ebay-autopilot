import { db } from "@/db";
import { ensureAddedColumns } from "@/db/ensure-columns";
import { hasAdminToken } from "@/lib/admin-token";

/**
 * Admin fallback: adds catalog_products.user_id, swaps the global external_id
 * unique index for the per-seller ones, and assigns pre-existing CJ products
 * to their owner. The app already does this on startup (src/instrumentation.ts);
 * this is for running it by hand. Idempotent. Needs `x-admin-token: <CRON_SECRET>`.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!hasAdminToken(request)) return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const result = await ensureAddedColumns(db);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("[schema] migrate-catalog-owners failed:", error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Migration failed." }, { status: 500 });
  }
}
