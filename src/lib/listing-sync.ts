import "server-only";

import { and, asc, eq, gt } from "drizzle-orm";

import { db } from "@/db";
import { listings } from "@/db/schema";
import { getAccessTokenForUser } from "@/lib/ebay/client";
import { getEbayItemStatus } from "@/lib/ebay/item-status";

/**
 * Brings a seller's "active" listings in line with eBay: each one is looked
 * up with GetItem (1 call per second) and marked ended when eBay says it has
 * ended or doesn't exist. Rows that never reached eBay (no real item id) are
 * ended too. Only `status` ever changes; nothing is deleted. Rows eBay
 * couldn't answer for are left as they are and reported.
 *
 * Runs in pages: it stops starting lookups after `budgetMs` and returns
 * `nextAfterId`; call again with that as `afterId` to carry on.
 */

export type SyncedListing = { id: number; title: string; ebayItemId: string | null; reason: string };

export type SyncResult =
  | {
      ok: true;
      checked: number;
      ended: number;
      still_active: number;
      errors: number;
      ended_listings: SyncedListing[];
      error_listings: SyncedListing[];
      /** Set when active listings are left to check: pass it back as afterId. */
      next_after_id?: number;
      remaining?: number;
    }
  | { ok: false; notConnected?: boolean; error: string };

/** A real eBay item id is all digits; demo listings carry "DEMO-…" or nothing. */
const isEbayItemId = (id: string | null): id is string => Boolean(id && /^\d{6,20}$/.test(id));

const REASONS: Record<string, string> = {
  NotFound: "eBay has no such listing (deleted, or not on this store)",
  Completed: "Ended on eBay (sold out or completed)",
  Ended: "Ended on eBay",
};

export async function syncListingStatuses(
  userId: number,
  options: { afterId?: number; budgetMs?: number } = {},
): Promise<SyncResult> {
  const started = Date.now();
  const budgetMs = options.budgetMs ?? 50_000;

  const accessToken = await getAccessTokenForUser(userId);
  if (!accessToken) {
    return { ok: false, notConnected: true, error: "No eBay store connected. Connect your store in Settings first." };
  }

  const rows = await db
    .select({ id: listings.id, title: listings.title, ebayItemId: listings.ebayItemId })
    .from(listings)
    .where(
      and(eq(listings.userId, userId), eq(listings.status, "active"), gt(listings.id, options.afterId ?? 0)),
    )
    .orderBy(asc(listings.id));

  const ended: SyncedListing[] = [];
  const failed: SyncedListing[] = [];
  let stillActive = 0;
  let index = 0;

  const markEnded = async (row: (typeof rows)[number], reason: string) => {
    // Only flips a row that is still active, so a concurrent change isn't overwritten.
    const updated = await db
      .update(listings)
      .set({ status: "ended" })
      .where(and(eq(listings.id, row.id), eq(listings.userId, userId), eq(listings.status, "active")))
      .returning({ id: listings.id });
    if (updated.length) ended.push({ ...row, reason });
  };

  for (; index < rows.length; index += 1) {
    if (Date.now() - started > budgetMs) break;
    const row = rows[index];
    if (!isEbayItemId(row.ebayItemId)) {
      await markEnded(row, "Never published to eBay (no eBay item id)");
      continue;
    }
    const status = await getEbayItemStatus(row.ebayItemId, accessToken);
    if (status.state === "active") stillActive += 1;
    else if (status.state === "ended") await markEnded(row, REASONS[status.listingStatus] ?? `eBay status: ${status.listingStatus}`);
    else failed.push({ ...row, reason: status.error });
  }

  const checked = index;
  console.log(
    `[listing-sync] user ${userId}: checked=${checked} ended=${ended.length} active=${stillActive} errors=${failed.length} left=${rows.length - index}`,
  );
  return {
    ok: true,
    checked,
    ended: ended.length,
    still_active: stillActive,
    errors: failed.length,
    ended_listings: ended,
    error_listings: failed,
    ...(index < rows.length ? { next_after_id: rows[index - 1]?.id ?? options.afterId ?? 0, remaining: rows.length - index } : {}),
  };
}
