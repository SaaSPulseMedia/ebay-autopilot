import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { hasAdminToken } from "@/lib/admin-token";
import { getCurrentUser } from "@/lib/auth";
import { syncListingStatuses } from "@/lib/listing-sync";

/**
 * POST /api/admin/sync-listings — checks a seller's "active" listings against
 * eBay (GetItem, 1 call per second) and marks the ones eBay has ended or
 * doesn't have as ended. Never deletes rows.
 *
 * Who it runs for:
 *   - With `x-admin-token: <CRON_SECRET>`: the seller named by ?email= or ?userId=.
 *   - Without it: the signed-in seller (the Listings page's "Sync from eBay" button).
 *
 * A run stops starting lookups after ~50 s. If listings are left, the
 * response has `next_after_id`; call again with ?afterId=<next_after_id>.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const params = new URL(request.url).searchParams;
  let userId: number | null = null;

  if (hasAdminToken(request)) {
    const email = params.get("email")?.trim().toLowerCase();
    const id = Number(params.get("userId"));
    if (email) {
      const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (!user) return Response.json({ ok: false, error: "No user with that email." }, { status: 404 });
      userId = user.id;
    } else if (Number.isInteger(id) && id > 0) {
      userId = id;
    } else {
      return Response.json({ ok: false, error: "Pass ?email= or ?userId= for the seller to sync." }, { status: 400 });
    }
  } else {
    const user = await getCurrentUser();
    if (!user) return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
    userId = user.id;
  }

  const afterId = Math.max(0, Math.floor(Number(params.get("afterId")) || 0));
  try {
    const result = await syncListingStatuses(userId, { afterId });
    if (!result.ok) return Response.json(result, { status: result.notConnected ? 400 : 502 });
    return Response.json(result);
  } catch (error) {
    console.error("[listing-sync] failed:", error instanceof Error ? error.message : error);
    return Response.json({ ok: false, error: "Sync failed. Try again in a moment." }, { status: 500 });
  }
}
