import "server-only";

import { getMarketPrice } from "@/lib/ebay/market-price";
import type { ListingDefaults } from "@/lib/listing-defaults";
import { listPriceFor, marketMatchPrice } from "@/lib/pricing";

export type ListingPrice = {
  listPrice: number;
  /** "market": priced by Market Match (free shipping); "default": the seller's normal rule. */
  rule: "market" | "default";
  freeShipping: boolean;
  /** eBay market average used, when one was looked up and found. */
  market: number | null;
  /** Why Market Match fell back to the default rule (only when it did). */
  reason?: string;
};

/**
 * The price (and shipping) a catalog product lists at under the seller's
 * pricing rule. Only "Match eBay Market Price (Free Shipping)" needs eBay: it
 * looks up the market average (cached, rate-limited; see market-price.ts) and
 * applies marketMatchPrice, falling back to AutoPilot's suggested price.
 */
export async function resolveListingPrice(
  defaults: ListingDefaults,
  product: { title: string; supplierPrice: number; shippingCost: number; suggestedPrice: number },
): Promise<ListingPrice> {
  if (defaults.pricingMode !== "market") {
    return {
      listPrice: listPriceFor(defaults, product.supplierPrice, product.shippingCost, product.suggestedPrice),
      rule: "default",
      freeShipping: false,
      market: null,
    };
  }

  const lookup = await getMarketPrice(product.title);
  const market = lookup.ok ? (lookup.market?.average ?? null) : null;
  const match = marketMatchPrice({
    cost: product.supplierPrice,
    shipping: product.shippingCost,
    suggested: product.suggestedPrice,
    market,
    adRatePct: defaults.adRatePct,
  });
  if (match.rule === "market") {
    return { listPrice: match.listPrice, rule: "market", freeShipping: true, market: match.market };
  }
  return {
    listPrice: match.listPrice,
    rule: "default",
    freeShipping: false,
    market: match.market,
    reason: lookup.ok ? match.reason : "eBay market lookup failed",
  };
}
