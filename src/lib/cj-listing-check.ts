import "server-only";

import { and, desc, eq, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { listings } from "@/db/schema";
import { getCjShipping } from "@/lib/cj/catalog";
import { getEbayItemStatus } from "@/lib/ebay/item-status";
import { charmUp, raiseListingPrice } from "@/lib/ebay/reprice";
import { type ListingDefaults, landedCost, realProfit, saleFeePct } from "@/lib/listing-defaults";
import { MIN_PROFIT, priceForMinProfit } from "@/lib/pricing";
import { getCatalogProduct } from "@/lib/suppliers";

/**
 * "CJ listing check": each live listing AutoPilot made from a CJ product,
 * re-costed with what a sale really costs today: CJ's price, CJ's real
 * shipping from a warehouse that has the item (getCjShipping leaves out the
 * US warehouse when it is empty), the seller's currency conversion and their
 * real eBay fee rate. Says whether the live eBay price still keeps
 * MIN_PROFIT, and the item price that would. Read only: nothing is changed.
 */

export type CjListingVerdict = "ok" | "thin" | "losing" | "ended" | "error";

export type CjListingCheck = {
  listingId: number;
  itemId: string;
  title: string;
  verdict: CjListingVerdict;
  /** Live eBay item price (the cheapest variation's) and what the buyer pays for shipping. */
  price: number | null;
  shipping: number | null;
  /** CJ's price for the cheapest variant, and CJ's cheapest shipping that can actually go out. */
  cjCost: number | null;
  cjShipping: number | null;
  cjFrom: "CN" | "US" | null;
  /** Units of the quoted variant in CJ's US warehouses (null: CJ didn't say). */
  usStock: number | null;
  /** What one sale leaves the seller now. */
  profit: number | null;
  /** Item price (buyer shipping unchanged) that keeps MIN_PROFIT; only when the current one doesn't. */
  neededPrice: number | null;
  note: string;
};

const money = (n: number) => `$${n.toFixed(2)}`;
const cents = (n: number) => Math.round(n * 100) / 100;

type Payload = { externalId?: unknown; sku?: unknown; variants?: Array<{ sku?: unknown }> };

/** The seller's live listings made from CJ products, newest first. */
export async function cjListings(userId: number) {
  const rows = await db
    .select({ id: listings.id, title: listings.title, ebayItemId: listings.ebayItemId, payload: listings.payload })
    .from(listings)
    .where(and(eq(listings.userId, userId), eq(listings.status, "active"), isNotNull(listings.ebayItemId)))
    .orderBy(desc(listings.createdAt))
    .limit(1000);
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      const externalId = (row.payload as Payload | null)?.externalId;
      if (typeof externalId !== "string" || !externalId.startsWith("cj-") || !row.ebayItemId || seen.has(row.ebayItemId)) return false;
      seen.add(row.ebayItemId);
      return true;
    })
    .map((row) => ({ listingId: row.id, itemId: row.ebayItemId as string, title: row.title }));
}

export async function checkCjListing(
  userId: number,
  token: string,
  defaults: ListingDefaults,
  listingId: number,
): Promise<CjListingCheck | null> {
  const [row] = await db
    .select({ id: listings.id, title: listings.title, ebayItemId: listings.ebayItemId, payload: listings.payload })
    .from(listings)
    .where(and(eq(listings.id, listingId), eq(listings.userId, userId)))
    .limit(1);
  const externalId = (row?.payload as Payload | null)?.externalId;
  if (!row?.ebayItemId || typeof externalId !== "string") return null;

  const base = {
    listingId: row.id,
    itemId: row.ebayItemId,
    title: row.title,
    price: null,
    shipping: null,
    cjCost: null,
    cjShipping: null,
    cjFrom: null,
    usStock: null,
    profit: null,
    neededPrice: null,
  };
  const status = await getEbayItemStatus(row.ebayItemId, token);
  if (status.state === "ended") return { ...base, verdict: "ended", note: "This listing has ended on eBay." };
  if (status.state === "unknown" || status.price == null) {
    return { ...base, verdict: "error", note: `eBay didn't give this listing's price${status.state === "unknown" ? ` (${status.error})` : ""}. Try again later.` };
  }
  const price = status.price;
  const buyerShipping = status.shipping ?? 0;
  const live = { ...base, price, shipping: status.shipping };

  const product = await getCatalogProduct(userId, externalId);
  if (!product) return { ...live, verdict: "error", note: "The CJ product behind this listing is no longer in your catalog." };
  const cheapest = [...(product.variants ?? [])].filter((v) => v.price > 0).sort((a, b) => a.price - b.price)[0];
  const quote = await getCjShipping(externalId.replace(/^cj-/, ""), cheapest?.sku ?? null);
  if (!quote.ok) return { ...live, cjCost: product.supplierPrice, verdict: "error", note: `CJ couldn't quote shipping: ${quote.error}` };
  const method = quote.data.options[0];
  if (!method) {
    return { ...live, cjCost: product.supplierPrice, usStock: quote.data.usStock, verdict: "losing", note: "CJ can't ship this to the US right now: end it or pause it." };
  }

  const cjCost = cheapest?.price ?? product.supplierPrice;
  const profit = cents(realProfit(defaults, price + buyerShipping, cjCost, method.price));
  const neededTotal = priceForMinProfit(landedCost(defaults, cjCost), landedCost(defaults, method.price), saleFeePct(defaults));
  const neededPrice = cents(Math.max(0.99, neededTotal - buyerShipping));
  const checked = { ...live, cjCost, cjShipping: method.price, cjFrom: method.from, usStock: quote.data.usStock, profit };
  const from = method.from === "US" ? "CJ's US warehouse" : quote.data.usStock === 0 ? "China (CJ's US warehouse has none)" : "China";
  const cost = `CJ ${money(cjCost)} + ${money(method.price)} shipping from ${from}`;

  if (profit >= MIN_PROFIT) return { ...checked, verdict: "ok", note: `${cost}: you keep ${money(profit)} per sale.` };
  return {
    ...checked,
    verdict: profit < 0 ? "losing" : "thin",
    neededPrice,
    note: `${cost}: you ${profit < 0 ? `lose ${money(-profit)}` : `keep only ${money(profit)}`} per sale. An item price of ${money(neededPrice)} keeps ${money(MIN_PROFIT)}.`,
  };
}

export type CjPriceFix = { listingId: number; ok: boolean; note: string; from?: number; to?: number };

/**
 * "Raise the price": re-checks the listing (so the price is never based on
 * stale numbers) and, when it is losing money or under MIN_PROFIT, raises
 * every variation on eBay so the cheapest reaches the needed price (to .99).
 */
export async function fixCjListingPrice(userId: number, token: string, defaults: ListingDefaults, listingId: number): Promise<CjPriceFix> {
  const check = await checkCjListing(userId, token, defaults, listingId);
  if (!check) return { listingId, ok: false, note: "Listing not found." };
  if (check.verdict === "ok") return { listingId, ok: true, note: `Already fine: you keep ${money(check.profit ?? 0)} per sale.` };
  if (check.neededPrice == null) return { listingId, ok: false, note: check.note };

  const [row] = await db.select({ payload: listings.payload }).from(listings).where(eq(listings.id, listingId)).limit(1);
  const payload = (row?.payload ?? {}) as Payload;
  const variantSkus = (payload.variants ?? []).map((v) => v.sku).filter((s): s is string => typeof s === "string" && s.length > 0);
  const skus = variantSkus.length > 1 ? variantSkus : typeof payload.sku === "string" ? [payload.sku] : [];
  if (!skus.length) return { listingId, ok: false, note: "AutoPilot doesn't know this listing's SKUs: change the price in eBay Seller Hub." };

  const raised = await raiseListingPrice(token, check.itemId, skus, charmUp(check.neededPrice));
  if (!raised.ok) return { listingId, ok: false, note: raised.error };
  await db.update(listings).set({ listPrice: raised.to.toFixed(2) }).where(eq(listings.id, listingId));
  const variations = raised.variations > 1 ? ` (all ${raised.variations} variations raised in step)` : "";
  return { listingId, ok: true, from: raised.from, to: raised.to, note: `Raised from ${money(raised.from)} to ${money(raised.to)}${variations}.` };
}
