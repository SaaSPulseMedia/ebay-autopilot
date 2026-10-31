import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { autoOrderSettings, restockedLines } from "@/db/schema";
import { ebayErrorMessage, ebayFetch, getAccessTokenForUser } from "@/lib/ebay/client";
import { fetchEbayOrders } from "@/lib/ebay/orders";
import { getListingDefaults } from "@/lib/seller-settings";

/**
 * Restock after a sale: each sold variant of a listing AutoPilot published
 * (an Inventory API SKU) goes back to the seller's quantity per variant, so a
 * size or colour never shows sold out on eBay while the supplier has it.
 * Runs hourly (the fulfillment job), once per sold order line
 * (restocked_lines). Listings made outside AutoPilot (no inventory item for
 * the SKU) are left alone.
 */

/** Orders older than this are not looked at. */
const LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;

export async function getRestockSetting(userId: number) {
  const [row] = await db.select({ restock: autoOrderSettings.restock }).from(autoOrderSettings).where(eq(autoOrderSettings.userId, userId)).limit(1);
  return row?.restock ?? false;
}

export async function saveRestockSetting(userId: number, restock: boolean) {
  await db
    .insert(autoOrderSettings)
    .values({ userId, restock })
    .onConflictDoUpdate({ target: autoOrderSettings.userId, set: { restock, updatedAt: new Date() } });
  return restock;
}

export async function sellersWithRestock() {
  const rows = await db.select({ userId: autoOrderSettings.userId }).from(autoOrderSettings).where(eq(autoOrderSettings.restock, true));
  return rows.map((r) => r.userId);
}

type InventoryItem = { availability?: { shipToLocationAvailability?: { quantity?: number } } };
type Offers = { offers?: Array<{ offerId?: string; status?: string; availableQuantity?: number }> };

/** Puts one SKU back to `quantity` (inventory item and its published offer). "skipped": not an AutoPilot listing, or already stocked. */
async function restockSku(token: string, sku: string, quantity: number): Promise<"restocked" | "skipped" | { error: string }> {
  const item = await ebayFetch<InventoryItem>(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, token);
  if (item.errors?.length) return "skipped";
  const offers = await ebayFetch<Offers>(`/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=EBAY_US`, token);
  const offer = offers.offers?.find((o) => o.offerId && o.status === "PUBLISHED");
  const now = item.availability?.shipToLocationAvailability?.quantity ?? 0;
  if (now >= quantity && (offer?.availableQuantity ?? quantity) >= quantity) return "skipped";
  const res = await ebayFetch<{ responses?: Array<{ statusCode?: number; errors?: Array<{ message?: string; longMessage?: string }> }> }>(
    "/sell/inventory/v1/bulk_update_price_quantity",
    token,
    {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            sku,
            shipToLocationAvailability: { quantity },
            ...(offer?.offerId ? { offers: [{ offerId: offer.offerId, availableQuantity: quantity }] } : {}),
          },
        ],
      }),
    },
  );
  const failed = res.responses?.find((r) => (r.statusCode ?? 0) >= 300 || r.errors?.length);
  if (!res.responses?.length || failed) return { error: failed ? ebayErrorMessage(failed, "eBay refused the quantity.") : ebayErrorMessage(res, "eBay refused the quantity.") };
  return "restocked";
}

export type RestockRun = { restocked: number; skipped: number; failed: number };

/** Restocks the variants sold in the seller's recent orders, until `deadline`. */
export async function runRestock(userId: number, deadline: number): Promise<RestockRun> {
  const run: RestockRun = { restocked: 0, skipped: 0, failed: 0 };
  if (!(await getRestockSetting(userId))) return run;
  const [orders, token, defaults] = await Promise.all([
    fetchEbayOrders(userId, { awaitingOnly: false }),
    getAccessTokenForUser(userId),
    getListingDefaults(userId),
  ]);
  if (!orders.ok || !token) return run;

  const since = Date.now() - LOOKBACK_MS;
  for (const order of orders.orders) {
    if (order.paymentStatus !== "PAID" || new Date(order.createdAt).getTime() < since) continue;
    for (const line of order.lines) {
      if (Date.now() > deadline) return run;
      if (!line.sku || !line.lineItemId) continue;
      // Claim the line first: it is restocked once, even when two runs overlap.
      const claimed = await db
        .insert(restockedLines)
        .values({ userId, lineItemId: line.lineItemId, sku: line.sku })
        .onConflictDoNothing()
        .returning({ id: restockedLines.lineItemId });
      if (!claimed.length) continue;
      const result = await restockSku(token, line.sku, defaults.quantityPerVariant);
      const outcome = typeof result === "string" ? result : "error";
      if (typeof result !== "string") console.warn(`[restock] user ${userId} sku ${line.sku}: ${result.error}`);
      run[outcome === "restocked" ? "restocked" : outcome === "skipped" ? "skipped" : "failed"]++;
      await db
        .update(restockedLines)
        .set({ result: outcome })
        .where(and(eq(restockedLines.userId, userId), eq(restockedLines.lineItemId, line.lineItemId)));
    }
  }
  if (run.restocked || run.failed) console.log(`[restock] user ${userId}: ${JSON.stringify(run)}`);
  return run;
}
