import { timingSafeEqual } from "node:crypto";

import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { listings } from "@/db/schema";
import type { ListingDraft } from "@/lib/ebay/types";
import { DRIP_PER_RUN } from "@/lib/limits";
import { connectedAccessToken, parseEngine, publishWithFallback, storedStatus } from "@/lib/listing-pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Most scheduled listings looked at in one run (across all accounts). */
const SCAN_LIMIT = 1000;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Drip-posting release job. Called about once an hour by
 * .github/workflows/drip-release.yml (Vercel's free plan only allows daily crons).
 * Releases the oldest scheduled listings, at most DRIP_PER_RUN per account per run.
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return Response.json({ ok: false, error: "Drip posting is not switched on: CRON_SECRET is not set." }, { status: 503 });
  }
  if (!authorized(request)) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const due = await db
    .select({ id: listings.id, userId: listings.userId, payload: listings.payload })
    .from(listings)
    .where(eq(listings.status, "scheduled"))
    .orderBy(asc(listings.createdAt))
    .limit(SCAN_LIMIT);

  const perUser = new Map<number, typeof due>();
  for (const row of due) {
    const batch = perUser.get(row.userId) ?? [];
    if (batch.length < DRIP_PER_RUN) perUser.set(row.userId, [...batch, row]);
  }

  let released = 0;
  let failed = 0;
  for (const [userId, rows] of perUser) {
    const accessToken = await connectedAccessToken(userId);
    for (const row of rows) {
      const payload = (row.payload ?? {}) as Partial<ListingDraft> & { requestedEngine?: unknown };
      if (!payload.title) {
        failed += 1;
        await db.update(listings).set({ status: "draft" }).where(eq(listings.id, row.id));
        continue;
      }
      const draft: ListingDraft = {
        title: payload.title,
        description: payload.description ?? "",
        listPrice: Number(payload.listPrice ?? 0),
        supplierPrice: Number(payload.supplierPrice ?? 0),
        sourceUrl: payload.sourceUrl ?? null,
        imageUrl: payload.imageUrl ?? null,
        quantity: Number(payload.quantity ?? 1),
      };
      const result = await publishWithFallback(draft, parseEngine(payload.requestedEngine), accessToken);
      await db
        .update(listings)
        .set({ status: storedStatus(result), engine: result.engine, ebayItemId: result.itemId })
        .where(eq(listings.id, row.id));
      released += 1;
    }
  }

  return Response.json({
    ok: true,
    released,
    failed,
    accounts: perUser.size,
    stillScheduled: Math.max(0, due.length - released - failed),
  });
}
