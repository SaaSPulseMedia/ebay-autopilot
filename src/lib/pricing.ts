/**
 * Pure pricing helpers shared by the app and the seed script.
 * No database or server-only imports, so `tsx src/db/seed.ts` can use them.
 */

/** eBay US final value fee (most categories) and fixed per-order fee. */
export const EBAY_FINAL_VALUE_FEE = 0.1355;
export const EBAY_FIXED_FEE = 0.4;

/** eBay fees on one sale: final value fee + fixed fee + optional promoted-listing ad rate. */
export function ebayFees(listPrice: number, adRatePct = 0) {
  return listPrice * (EBAY_FINAL_VALUE_FEE + adRatePct / 100) + EBAY_FIXED_FEE;
}

export type PriceBreakdown = {
  listPrice: number;
  cost: number;
  shipping: number;
  finalValueFee: number;
  fixedFee: number;
  adFee: number;
  profit: number;
  marginPct: number;
};

const cents = (value: number) => Math.round(value * 100) / 100;

/** Every line between the list price and what the seller keeps — shown as "Why this price". */
export function priceBreakdown(listPrice: number, cost: number, shipping = 0, adRatePct = 0): PriceBreakdown {
  const finalValueFee = cents(listPrice * EBAY_FINAL_VALUE_FEE);
  const adFee = cents((listPrice * adRatePct) / 100);
  const profit = cents(listPrice - cost - shipping - finalValueFee - EBAY_FIXED_FEE - adFee);
  return {
    listPrice: cents(listPrice),
    cost: cents(cost),
    shipping: cents(shipping),
    finalValueFee,
    fixedFee: EBAY_FIXED_FEE,
    adFee,
    profit,
    marginPct: listPrice > 0 ? Math.round((profit / listPrice) * 1000) / 10 : 0,
  };
}

/** What is left after supplier cost, shipping, and eBay fees. */
export function netProfitFor(listPrice: number, cost: number, shipping = 0, adRatePct = 0) {
  return priceBreakdown(listPrice, cost, shipping, adRatePct).profit;
}

/**
 * Seller's pricing rule: AutoPilot's suggested price, or their own markup on
 * cost + shipping. "market" needs an eBay lookup (see resolveListingPrice in
 * src/lib/market-pricing.ts); here it gives its fallback, the suggested price.
 */
export function listPriceFor(
  rule: { pricingMode: "suggested" | "markup" | "market"; markupPct: number },
  cost: number,
  shipping: number,
  suggested: number,
) {
  return rule.pricingMode === "markup" ? priceFromMarkup(cost + shipping, rule.markupPct) : suggested;
}

/** List price from a markup on supplier cost, e.g. 40% markup on $10 → $14.00. */
export function priceFromMarkup(cost: number, markupPct: number) {
  return Math.round(cost * (1 + markupPct / 100) * 100) / 100;
}

/** Price a supplier item for eBay so the net margin lands near 23% after fees. */
export function priceForEbay(cost: number) {
  const shipping = cost < 25 ? 4.25 : 0;
  const target = (cost + shipping + EBAY_FIXED_FEE) / (1 - EBAY_FINAL_VALUE_FEE - 0.23);
  const suggested = Math.max(cost + 6, Math.round(target * 100) / 100);
  return { shipping, suggested: Math.round(suggested * 100) / 100 };
}

/** "Match eBay Market Price (Free Shipping)": profit per sale needed at market price, and the buffer added on top. */
export const MARKET_MATCH_MIN_PROFIT = 3;
export const MARKET_MATCH_BUFFER = 3;
/** Must match the Market Guard's limit (src/lib/ebay/market-price.ts), or every match would be blocked. */
export const MARKET_MATCH_MAX_ABOVE = 0.2;

export type MarketMatch =
  | { rule: "market"; listPrice: number; market: number; profitAtMarket: number }
  | { rule: "default"; listPrice: number; market: number | null; profitAtMarket: number | null; reason: string };

/**
 * The market-match pricing rule. With free shipping the seller pays shipping,
 * so profit at market = market − eBay fees (13.55% + $0.40) − CJ cost −
 * shipping. At least $3 → list at market + $3 (capped at the Market Guard's
 * 20% above market, so the guard never blocks its own price) with free
 * shipping. Otherwise, or without a market price, fall back to AutoPilot's
 * suggested price (cost + ~23% margin) and the seller's normal shipping.
 */
export function marketMatchPrice(input: { cost: number; shipping: number; suggested: number; market: number | null }): MarketMatch {
  const fallback = (reason: string, profitAtMarket: number | null): MarketMatch => ({
    rule: "default",
    listPrice: input.suggested,
    market: input.market,
    profitAtMarket,
    reason,
  });
  if (input.market == null || !(input.market > 0)) return fallback("no eBay market price found", null);

  const profitAtMarket = cents(input.market - ebayFees(input.market) - input.cost - input.shipping);
  if (profitAtMarket < MARKET_MATCH_MIN_PROFIT) {
    const atMarket =
      profitAtMarket < 0 ? `a $${Math.abs(profitAtMarket).toFixed(2)} loss` : `only $${profitAtMarket.toFixed(2)} profit`;
    return fallback(`${atMarket} at the eBay market price`, profitAtMarket);
  }
  const ceiling = Math.floor(input.market * (1 + MARKET_MATCH_MAX_ABOVE) * 100) / 100;
  const listPrice = cents(Math.min(input.market + MARKET_MATCH_BUFFER, ceiling));
  return { rule: "market", listPrice, market: input.market, profitAtMarket };
}

export function competitionFor(sales: number): "low" | "medium" | "high" {
  if (sales > 900) return "high";
  if (sales > 350) return "medium";
  return "low";
}
