import "server-only";

import { getMarketPrice } from "@/lib/ebay/market-price";
import type { ListingDefaults } from "@/lib/listing-defaults";
import {
  MARKET_MATCH_MAX_ABOVE,
  MIN_PROFIT,
  type MarketSource,
  marketMatchPrice,
  rulePriceFor,
  withProfitFloor,
} from "@/lib/pricing";

export type ListingPrice = {
  listPrice: number;
  /**
   * "market": priced by Market Match (free shipping); "default": the seller's
   * normal rule; "low": must not be listed: the Safety Margin Cap left under
   * the minimum profit, or the price that keeps the minimum profit is more than 20% above the
   * eBay market average (see resolveListingPrice).
   */
  rule: "market" | "default" | "low";
  freeShipping: boolean;
  /** eBay price compared against (sold median, else active lower quartile), when one was found. */
  market: number | null;
  /** "sold": from the last 90 days' sales; "active": from listings up now. */
  marketSource: MarketSource | null;
  /** Cheapest active eBay listing, and whether the Safety Margin Cap cut the price to it + 5%. */
  lowest: number | null;
  capped: boolean;
  /** The rule's price kept under the minimum profit, so it was raised to the price that keeps the minimum profit. */
  floorRaised: boolean;
  /** Why Market Match fell back to the default rule, why the price was raised, or why it's "low". */
  reason?: string;
};

const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * The price (and shipping) a catalog product lists at under the seller's
 * pricing rule, from its true landed cost: supplier cost + its real CJ
 * shipping (product.shippingCost, quoted on import) + eBay's fees.
 *  - Every rule ends at or above the profit floor: a price that keeps
 *    less is raised to the one that keeps exactly MIN_PROFIT (withProfitFloor).
 *  - A raised price more than 20% above the eBay market average is "low":
 *    buyers won't pay it (and the Market Guard would block it), so it must
 *    not be listed. The market is only looked up when the price was raised,
 *    or for "Match eBay Market Price", which always needs it.
 *  - "Match eBay Market Price" applies marketMatchPrice (and its Safety
 *    Margin Cap, which can also return "low").
 */
export async function resolveListingPrice(
  defaults: ListingDefaults,
  product: { title: string; supplierPrice: number; shippingCost: number; suggestedPrice: number },
): Promise<ListingPrice> {
  const cost = product.supplierPrice;
  const shipping = product.shippingCost;
  const base = { market: null, marketSource: null, lowest: null, capped: false } as const;

  if (defaults.pricingMode !== "market") {
    const rulePrice = rulePriceFor(defaults, cost, shipping, product.suggestedPrice);
    const floored = withProfitFloor(rulePrice, cost, shipping, defaults.adRatePct);
    if (!floored.raised) {
      return { ...base, listPrice: floored.price, rule: "default", freeShipping: false, floorRaised: false };
    }
    const lookup = await getMarketPrice(product.title);
    const average = lookup.ok ? (lookup.market?.average ?? null) : null;
    const raisedReason = `raised from ${money(rulePrice)} to ${money(floored.price)} to keep ${money(MIN_PROFIT)} profit`;
    if (average != null && floored.price > average * (1 + MARKET_MATCH_MAX_ABOVE)) {
      return {
        ...base,
        listPrice: floored.price,
        rule: "low",
        freeShipping: false,
        floorRaised: true,
        market: average,
        marketSource: "active",
        reason: `it needs ${money(floored.price)} to keep ${money(MIN_PROFIT)} profit, more than 20% above the eBay average (${money(average)})`,
      };
    }
    return {
      ...base,
      listPrice: floored.price,
      rule: "default",
      freeShipping: false,
      floorRaised: true,
      market: average,
      marketSource: average != null ? "active" : null,
      reason: raisedReason,
    };
  }

  const lookup = await getMarketPrice(product.title);
  const market = lookup.ok ? lookup.market : null;
  const match = marketMatchPrice({
    cost,
    shipping,
    suggested: product.suggestedPrice,
    market: market?.reference ?? null,
    source: market?.referenceSource,
    guardAverage: market?.average,
    lowest: market?.lowest,
    adRatePct: defaults.adRatePct,
  });
  const safety = { lowest: match.safety?.lowest ?? null, capped: match.safety?.capped ?? false };
  if (match.rule === "market") {
    return {
      listPrice: match.listPrice,
      rule: "market",
      freeShipping: true,
      market: match.market,
      marketSource: match.source,
      ...safety,
      floorRaised: false,
    };
  }
  if (match.rule === "low") {
    return {
      listPrice: match.listPrice,
      rule: "low",
      freeShipping: true,
      market: match.market,
      marketSource: match.source,
      ...safety,
      floorRaised: false,
      reason: match.reason,
    };
  }
  // The fallback is the suggested price raised to the profit floor (see marketMatchPrice).
  const floorRaised = match.listPrice > product.suggestedPrice;
  const average = market?.average ?? null;
  if (average != null && match.listPrice > average * (1 + MARKET_MATCH_MAX_ABOVE)) {
    return {
      listPrice: match.listPrice,
      rule: "low",
      freeShipping: false,
      market: match.market,
      marketSource: match.source,
      ...safety,
      floorRaised,
      reason: `it needs ${money(match.listPrice)} to keep ${money(MIN_PROFIT)} profit, more than 20% above the eBay average (${money(average)})`,
    };
  }
  return {
    listPrice: match.listPrice,
    rule: "default",
    freeShipping: false,
    market: match.market,
    marketSource: match.source,
    ...safety,
    floorRaised,
    reason: lookup.ok ? match.reason : "eBay market lookup failed",
  };
}
