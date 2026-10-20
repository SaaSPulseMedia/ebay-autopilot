import "server-only";

import { getMarketPrice } from "@/lib/ebay/market-price";
import type { ListingDefaults } from "@/lib/listing-defaults";
import { type MarketSource, listPriceFor, marketMatchPrice } from "@/lib/pricing";

export type ListingPrice = {
  listPrice: number;
  /** "market": priced by Market Match (free shipping); "default": the seller's normal rule. */
  rule: "market" | "default";
  freeShipping: boolean;
  /** eBay price compared against (sold median, else active lower quartile), when one was found. */
  market: number | null;
  /** "sold": from the last 90 days' sales; "active": from listings up now. */
  marketSource: MarketSource | null;
  /** Why Market Match fell back to the default rule (only when it did). */
  reason?: string;
};

/**
 * The price (and shipping) a catalog product lists at under the seller's
 * pricing rule. Only "Match eBay Market Price (Free Shipping)" needs eBay: it
 * looks up the eBay price (recent sold price, else the competitive end of
 * active listings; cached, rate-limited, see market-price.ts) and applies
 * marketMatchPrice, falling back to AutoPilot's suggested price.
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
      marketSource: null,
    };
  }

  const lookup = await getMarketPrice(product.title);
  const market = lookup.ok ? lookup.market : null;
  const match = marketMatchPrice({
    cost: product.supplierPrice,
    shipping: product.shippingCost,
    suggested: product.suggestedPrice,
    market: market?.reference ?? null,
    source: market?.referenceSource,
    guardAverage: market?.average,
    adRatePct: defaults.adRatePct,
  });
  if (match.rule === "market") {
    return {
      listPrice: match.listPrice,
      rule: "market",
      freeShipping: true,
      market: match.market,
      marketSource: match.source,
    };
  }
  return {
    listPrice: match.listPrice,
    rule: "default",
    freeShipping: false,
    market: match.market,
    marketSource: match.source,
    reason: lookup.ok ? match.reason : "eBay market lookup failed",
  };
}
