import { timingSafeEqual } from "node:crypto";

import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { listings } from "@/db/schema";
import type { ListingDraft } from "@/lib/ebay/types";
import { DRIP_PER_RUN } from "@/lib/limits";
import { connectedAccessToken, parseEngine, publishWithFallback, storedStatus } from "@/lib/listing-pipeline";
import { productSku } from "@/lib/variants";

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

async function releaseScheduled() {
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
      const payload = (row.payload ?? {}) as Partial<ListingDraft> & { requestedEngine?: unknown; sku?: unknown };
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
      const sku = typeof payload.sku === "string" && payload.sku ? payload.sku : productSku(draft.title);
      const result = await publishWithFallback(draft, parseEngine(payload.requestedEngine), accessToken, { userId, sku });
      await db
        .update(listings)
        .set({ status: storedStatus(result), engine: result.engine, ebayItemId: result.itemId })
        .where(eq(listings.id, row.id));
      released += 1;
    }
  }

  return {
    ok: true,
    released,
    failed,
    accounts: perUser.size,
    stillScheduled: Math.max(0, due.length - released - failed),
  };
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

  // One retry covers a database waking from idle (Neon's free tier sleeps after
  // a few minutes). Any remaining failure is reported in the response so it
  // shows up in the GitHub Actions log instead of an empty 500.
  try {
    return Response.json(await releaseScheduled());
  } catch (first) {
    console.error("[cron/release] first attempt failed", first);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    try {
      return Response.json(await releaseScheduled());
    } catch (error) {
      console.error("[cron/release] retry failed", error);
      // Drizzle wraps driver errors; the underlying cause is the useful part.
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : null;
      const message = cause ?? (error instanceof Error ? error.message.split("\n")[0] : String(error));
      return Response.json({ ok: false, error: `Release failed: ${message}` }, { status: 500 });
    }
  }
}
