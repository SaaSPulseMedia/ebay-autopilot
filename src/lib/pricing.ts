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

/** Every listing must keep at least this much per sale after supplier cost, real shipping and every eBay fee. */
export const MIN_PROFIT = 3;
/** MIN_PROFIT as shown to sellers, e.g. "$3.00". */
export const MIN_PROFIT_LABEL = `$${MIN_PROFIT.toFixed(2)}`;

/**
 * The lowest list price that keeps `minProfit` after cost, shipping, the final
 * value fee, the $0.40 order fee and the ad rate, rounded up to the cent.
 */
export function priceForMinProfit(cost: number, shipping: number, adRatePct = 0, minProfit = MIN_PROFIT) {
  const keep = 1 - EBAY_FINAL_VALUE_FEE - adRatePct / 100;
  let price = Math.ceil(((minProfit + EBAY_FIXED_FEE + cost + shipping) / keep) * 100) / 100;
  // Fees are rounded to the cent per line; step up until the floor really holds.
  while (netProfitFor(price, cost, shipping, adRatePct) < minProfit) price = cents(price + 0.01);
  return price;
}

/** The MIN_PROFIT hard floor: `price` if it already keeps MIN_PROFIT, else the price that does. */
export function withProfitFloor(price: number, cost: number, shipping: number, adRatePct = 0) {
  if (netProfitFor(price, cost, shipping, adRatePct) >= MIN_PROFIT) return { price: cents(price), raised: false };
  return { price: priceForMinProfit(cost, shipping, adRatePct), raised: true };
}

/**
 * The price a rule gives before the floor: AutoPilot's suggested price, or the
 * seller's markup on the true landed cost (supplier cost + real shipping +
 * eBay's $0.40 order fee). "market" needs an eBay lookup (see
 * resolveListingPrice in src/lib/market-pricing.ts); here it is its fallback,
 * the suggested price.
 */
export function rulePriceFor(
  rule: { pricingMode: "suggested" | "markup" | "market"; markupPct: number },
  cost: number,
  shipping: number,
  suggested: number,
) {
  return rule.pricingMode === "markup" ? priceFromMarkup(cost + shipping + EBAY_FIXED_FEE, rule.markupPct) : suggested;
}

/** The seller's pricing rule (rulePriceFor), raised to the MIN_PROFIT floor when it falls short. */
export function listPriceFor(
  rule: { pricingMode: "suggested" | "markup" | "market"; markupPct: number; adRatePct?: number },
  cost: number,
  shipping: number,
  suggested: number,
) {
  return withProfitFloor(rulePriceFor(rule, cost, shipping, suggested), cost, shipping, rule.adRatePct ?? 0).price;
}

/** List price from a markup on supplier cost, e.g. 40% markup on $10 → $14.00. */
export function priceFromMarkup(cost: number, markupPct: number) {
  return Math.round(cost * (1 + markupPct / 100) * 100) / 100;
}

/**
 * AutoPilot's suggested eBay price for a supplier item: about 23% net margin
 * after fees on its true landed cost, supplier cost + `shipping` (the real
 * CJ quote; see getCjShipping) + the $0.40 order fee. Never below the $5.00
 * profit floor (before any ad rate, which listPriceFor adds on).
 */
export function priceForEbay(cost: number, shipping: number) {
  const target = (cost + shipping + EBAY_FIXED_FEE) / (1 - EBAY_FINAL_VALUE_FEE - 0.23);
  return Math.max(cents(target), priceForMinProfit(cost, shipping));
}

/** "Match eBay Market Price (Free Shipping)": profit per sale needed at the eBay price, and the buffer added on top. */
export const MARKET_MATCH_MIN_PROFIT = MIN_PROFIT;
export const MARKET_MATCH_BUFFER = 0.5;
/** Must match the Market Guard's limit (src/lib/ebay/market-price.ts), or every match would be blocked. */
export const MARKET_MATCH_MAX_ABOVE = 0.2;

/**
 * Safety Margin Cap: a price more than SAFETY_CAP_TRIGGER above the cheapest
 * active eBay listing is cut to that listing + SAFETY_CAP_ABOVE_LOWEST.
 */
export const SAFETY_CAP_TRIGGER = 0.15;
export const SAFETY_CAP_ABOVE_LOWEST = 0.05;

/** Where the eBay price came from: recent sales, or the competitive end of active listings. */
export type MarketSource = "sold" | "active";

/** The Safety Margin Cap's verdict, when the cheapest active listing was known. */
export type SafetyCap = { lowest: number; capped: boolean };

export type MarketMatch =
  | {
      rule: "market";
      listPrice: number;
      market: number;
      source: MarketSource;
      profitAtMarket: number;
      safety: SafetyCap | null;
    }
  | {
      rule: "default";
      listPrice: number;
      market: number | null;
      source: MarketSource | null;
      profitAtMarket: number | null;
      reason: string;
      safety: SafetyCap | null;
    }
  | {
      /** The Safety Margin Cap left under the minimum profit: shown as "Low" and never listed. */
      rule: "low";
      listPrice: number;
      market: number | null;
      source: MarketSource | null;
      profitAtMarket: number;
      reason: string;
      safety: SafetyCap;
    };

/**
 * The market-match pricing rule. `market` is the eBay price to compete at:
 * the median sold price over the last 90 days when eBay gives one, otherwise
 * the lower quartile of active listings (see getMarketPrice). With free
 * shipping the seller pays shipping, so profit at that price = price − eBay
 * fees (13.55% + $0.40 + the Promoted Listings ad rate) − CJ cost − shipping.
 * At least $5 → list at the price + $0.50 with free shipping, capped at the
 * Market Guard's limit (20% above the active average, `guardAverage`) so the
 * guard never blocks its own price. Otherwise, or without an eBay price, fall
 * back to AutoPilot's suggested price (cost + ~23% margin) and the seller's
 * normal shipping.
 */
function marketMatchCore(input: {
  cost: number;
  shipping: number;
  suggested: number;
  market: number | null;
  source?: MarketSource;
  /** Active listings' average, which the Market Guard checks against (defaults to `market`). */
  guardAverage?: number | null;
  /** Promoted Listings ad rate (%), charged on each sale like the final value fee. */
  adRatePct?: number;
}): Exclude<MarketMatch, { rule: "low" }> {
  const source = input.market != null ? (input.source ?? "active") : null;
  const label = source === "sold" ? "eBay sold price" : "eBay market price";
  const fallback = (reason: string, profitAtMarket: number | null): Exclude<MarketMatch, { rule: "low" }> => ({
    rule: "default",
    // The seller's normal price, raised to the profit floor when the suggested price falls short.
    listPrice: withProfitFloor(input.suggested, input.cost, input.shipping, input.adRatePct ?? 0).price,
    market: input.market,
    source,
    profitAtMarket,
    reason,
    safety: null,
  });
  if (input.market == null || !(input.market > 0) || !source) return fallback("no eBay market price found", null);

  const guard = input.guardAverage && input.guardAverage > 0 ? input.guardAverage : input.market;
  const ceiling = Math.floor(guard * (1 + MARKET_MATCH_MAX_ABOVE) * 100) / 100;
  // A sold price far above today's listings is capped; profit is judged on what it can actually list at.
  const competeAt = Math.min(input.market, ceiling);
  const profitAtMarket = cents(competeAt - ebayFees(competeAt, input.adRatePct ?? 0) - input.cost - input.shipping);
  if (profitAtMarket < MARKET_MATCH_MIN_PROFIT) {
    const atMarket =
      profitAtMarket < 0 ? `a $${Math.abs(profitAtMarket).toFixed(2)} loss` : `only $${profitAtMarket.toFixed(2)} profit`;
    return fallback(`${atMarket} at the ${label}`, profitAtMarket);
  }
  const listPrice = cents(Math.min(input.market + MARKET_MATCH_BUFFER, ceiling));
  return { rule: "market", listPrice, market: input.market, source, profitAtMarket, safety: null };
}

/**
 * The market-match pricing rule (marketMatchCore) plus the Safety Margin Cap.
 * With `lowest`, the cheapest active eBay listing (item + shipping): a price
 * more than 15% above it — the match price, or the suggested price it fell
 * back to — is cut to lowest + 5% with free shipping. If that cut leaves under
 * the minimum profit the result is rule "low": shown as Low and never listed.
 */
export function marketMatchPrice(
  input: Parameters<typeof marketMatchCore>[0] & {
    /** Cheapest active eBay listing (item + shipping); null/undefined skips the cap. */
    lowest?: number | null;
  },
): MarketMatch {
  const match = marketMatchCore(input);
  if (input.lowest == null || !(input.lowest > 0)) return match;
  const lowest = cents(input.lowest);
  if (match.listPrice <= lowest * (1 + SAFETY_CAP_TRIGGER)) return { ...match, safety: { lowest, capped: false } };

  const listPrice = Math.floor(lowest * (1 + SAFETY_CAP_ABOVE_LOWEST) * 100) / 100;
  const profit = netProfitFor(listPrice, input.cost, input.shipping, input.adRatePct ?? 0);
  const safety = { lowest, capped: true };
  if (profit < MARKET_MATCH_MIN_PROFIT) {
    const atCap = profit < 0 ? `a $${Math.abs(profit).toFixed(2)} loss` : `only $${profit.toFixed(2)} profit`;
    return {
      rule: "low",
      listPrice,
      market: match.market,
      source: match.source,
      profitAtMarket: profit,
      reason: `${atCap} at $${listPrice.toFixed(2)}, 5% above the cheapest eBay listing ($${lowest.toFixed(2)})`,
      safety,
    };
  }
  // Capped prices are compared with eBay's item + shipping, so they always ship free.
  return {
    rule: "market",
    listPrice,
    market: match.market ?? lowest,
    source: match.source ?? "active",
    profitAtMarket: profit,
    safety,
  };
}

export function competitionFor(sales: number): "low" | "medium" | "high" {
  if (sales > 900) return "high";
  if (sales > 350) return "medium";
  return "low";
}
