import { db } from "@/db";
import { backfillStarterImages } from "@/db/backfill-images";
import { hasAdminToken } from "@/lib/admin-token";

/**
 * Admin one-off: fills missing image URLs on the 24 starter catalog rows in the
 * production database (only rows with no image; nothing else changes).
 * Needs the `x-admin-token: <CRON_SECRET>` header.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!hasAdminToken(request)) return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const result = await backfillStarterImages(db);
    console.log("[catalog-images] backfill:", JSON.stringify(result));
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Backfill failed." },
      { status: 500 },
    );
  }
}
