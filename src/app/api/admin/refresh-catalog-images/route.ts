import { db } from "@/db";
import { backfillStarterImages } from "@/db/backfill-images";
import { hasAdminToken } from "@/lib/admin-token";

/**
 * Admin one-off: replaces the old picsum.photos placeholders (and missing
 * images) on the 24 starter catalog rows in the production database with the
 * current keyword images. Rows with any other image URL are left alone.
 * Needs the `x-admin-token: <CRON_SECRET>` header.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!hasAdminToken(request)) return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const result = await backfillStarterImages(db);
    console.log("[catalog-images] refresh:", JSON.stringify(result));
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Refresh failed." },
      { status: 500 },
    );
  }
}
