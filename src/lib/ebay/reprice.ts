import "server-only";

import { type EbayError, ebayErrorMessage, ebayFetch } from "@/lib/ebay/client";

/**
 * Raises the price of a live listing AutoPilot published with the Inventory
 * API (listings made there can't be revised with the Trading API). Every
 * variation is scaled by the same factor, so the cheapest reaches `lowest` and
 * dearer ones (priced in proportion to their supplier cost) keep their lead.
 * Prices only go up and end in .99.
 */

type Offer = { offerId: string; sku: string; price: number };
type OfferRow = { offerId?: string; sku?: string; status?: string; pricingSummary?: { price?: { value?: string } }; listing?: { listingId?: string } };

/** eBay's limit per bulk_update_price_quantity request. */
const BULK = 25;

/** Up to the next .99: 38.59 → 38.99, 38.99 → 38.99, 39.00 → 39.99. */
export function charmUp(price: number) {
  return Math.ceil(price + 0.01) - 0.01;
}

async function liveOffer(token: string, sku: string, listingId: string): Promise<Offer | null> {
  const res = await ebayFetch<{ offers?: OfferRow[] }>(`/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=EBAY_US`, token);
  const offer = res.offers?.find((o) => o.offerId && o.status === "PUBLISHED" && o.listing?.listingId === listingId);
  const price = Number(offer?.pricingSummary?.price?.value);
  return offer?.offerId && price > 0 ? { offerId: offer.offerId, sku, price } : null;
}

export type RaiseResult =
  | { ok: true; from: number; to: number; variations: number }
  | { ok: false; error: string };

export async function raiseListingPrice(token: string, listingId: string, skus: string[], lowest: number): Promise<RaiseResult> {
  const offers: Offer[] = [];
  for (let i = 0; i < skus.length; i += 5) {
    const found = await Promise.all(skus.slice(i, i + 5).map((sku) => liveOffer(token, sku, listingId)));
    offers.push(...found.filter((o): o is Offer => o !== null));
  }
  if (!offers.length) return { ok: false, error: "eBay didn't find this listing's prices (it may have been changed outside AutoPilot)." };

  const from = Math.min(...offers.map((o) => o.price));
  const factor = lowest / from;
  if (factor <= 1) return { ok: true, from, to: from, variations: 0 };
  const updates = offers.map((o) => ({ ...o, newPrice: Math.max(o.price, charmUp(o.price * factor)) }));

  for (let i = 0; i < updates.length; i += BULK) {
    const res = await ebayFetch<{ responses?: Array<{ statusCode?: number; sku?: string; errors?: EbayError[] }> }>(
      "/sell/inventory/v1/bulk_update_price_quantity",
      token,
      {
        method: "POST",
        body: JSON.stringify({
          requests: updates.slice(i, i + BULK).map((u) => ({
            sku: u.sku,
            offers: [{ offerId: u.offerId, price: { value: u.newPrice.toFixed(2), currency: "USD" } }],
          })),
        }),
      },
    );
    const failed = res.responses?.find((r) => (r.statusCode ?? 0) >= 300 || r.errors?.length);
    if (!res.responses?.length || failed) {
      console.error(`[reprice] listing ${listingId}: price update failed:`, JSON.stringify(failed?.errors ?? res.errors ?? res));
      const error = failed ? ebayErrorMessage(failed, "eBay rejected the new price.") : ebayErrorMessage(res, "eBay rejected the new price.");
      return { ok: false, error: i ? `Only some variations were raised: ${error}` : error };
    }
  }
  return { ok: true, from, to: Math.min(...updates.map((u) => u.newPrice)), variations: updates.length };
}
