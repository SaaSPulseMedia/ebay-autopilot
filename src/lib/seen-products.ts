import "server-only";

import { and, desc, eq, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import { seenProducts } from "@/db/schema";

/** Every CJ product ID Auto-Suggest has already shown this seller, dropped for them, or they dismissed. */
export async function seenPids(userId: number): Promise<Set<string>> {
  const rows = await db.select({ pid: seenProducts.pid }).from(seenProducts).where(eq(seenProducts.userId, userId));
  return new Set(rows.map((r) => r.pid));
}

/** Keywords already used for a niche, most recent first, so Claude can be asked for different ones. */
export async function usedKeywords(userId: number, niche: string, limit = 40): Promise<string[]> {
  const rows = await db
    .select({ keyword: seenProducts.keyword, last: sql<Date>`max(${seenProducts.seenAt})` })
    .from(seenProducts)
    .where(and(eq(seenProducts.userId, userId), eq(seenProducts.niche, niche)))
    .groupBy(seenProducts.keyword)
    .orderBy(desc(sql`max(${seenProducts.seenAt})`))
    .limit(limit);
  return rows.map((r) => r.keyword).filter(Boolean);
}

export type SeenRow = { pid: string; keyword: string; outcome: "shown" | "rejected" };

/** Products the seller dismissed on the Winning page: hidden from the feed and Auto-Suggest for good. */
export async function dismissedPids(userId: number): Promise<Set<string>> {
  const rows = await db
    .select({ pid: seenProducts.pid })
    .from(seenProducts)
    .where(and(eq(seenProducts.userId, userId), eq(seenProducts.outcome, "dismissed")));
  return new Set(rows.map((r) => r.pid));
}

/** Dismisses a product (the Winning page's "Dismiss"), whether or not it was seen before. */
export async function dismissProduct(userId: number, pid: string, niche = "") {
  await db
    .insert(seenProducts)
    .values({ userId, pid, niche, outcome: "dismissed" })
    .onConflictDoUpdate({ target: [seenProducts.userId, seenProducts.pid], set: { outcome: "dismissed" } });
}

/** Records products as seen; ones already recorded keep their first sighting. */
export async function markSeen(userId: number, niche: string, rows: SeenRow[]) {
  if (!rows.length) return;
  await db
    .insert(seenProducts)
    .values(rows.map((r) => ({ userId, niche, pid: r.pid, keyword: r.keyword, outcome: r.outcome })))
    .onConflictDoNothing();
}

/** Forgets everything Auto-Suggest has shown this seller, so it can come up again. Dismissed products stay hidden. */
export async function clearSeen(userId: number) {
  const deleted = await db
    .delete(seenProducts)
    .where(and(eq(seenProducts.userId, userId), ne(seenProducts.outcome, "dismissed")))
    .returning({ pid: seenProducts.pid });
  return deleted.length;
}

/** Products Auto-Suggest has shown (or dropped), not counting dismissed ones, which a reset keeps. */
export async function seenCount(userId: number) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(seenProducts)
    .where(and(eq(seenProducts.userId, userId), ne(seenProducts.outcome, "dismissed")));
  return row?.n ?? 0;
}
